import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { openDatabase } from '../../db/database.js'
import { openStudioDatabase } from '../studio/database.js'
import { StudioStore } from '../studio/store.js'
import { HttpError } from '../novels/store.js'
import type { BackupService } from './service.js'

type Row = Record<string, string | number | null | { base64: string }>
type Tables = Record<string, Row[]>
type Module = 'story' | 'music' | 'video' | 'drafts'
type Payload = { format: 'storyforge-unified'; version: 1; createdAt: string; story: Tables; studio: Tables; drafts: unknown[] }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (): never => { throw new HttpError(400, '统一备份格式、版本或完整性校验失败，原始数据未更改') }
const quote = (v: string) => '"' + v.replaceAll('"','""') + '"'
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name))
function capture(db: DatabaseSync): Tables {
  return Object.fromEntries(tables(db).map(t => [t, db.prepare(`SELECT * FROM ${quote(t)}`).all().map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v instanceof Uint8Array ? { base64: Buffer.from(v).toString('base64') } : v])))])) as Tables
}
function values(row: Row): SQLInputValue[] { return Object.values(row).map(v => v && typeof v === 'object' ? Buffer.from(v.base64,'base64') : v) }
function load(db: DatabaseSync, source: Tables) {
  if (!source || typeof source !== 'object' || JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(tables(db).sort())) fail()
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON')
  try {
    for (const table of tables(db)) db.exec(`DELETE FROM ${quote(table)}`)
    for (const [table, rows] of Object.entries(source)) {
      if (!Array.isArray(rows) || rows.length > 100000) fail()
      const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(r => String(r.name))
      for (const row of rows) {
        if (!row || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...columns].sort())) fail()
        for (const [key,v] of Object.entries(row)) {
          if (v !== null && typeof v !== 'string' && typeof v !== 'number' && !(table === 'studio_assets' && key === 'data' && typeof v === 'object' && typeof v.base64 === 'string' && Buffer.from(v.base64,'base64').toString('base64') === v.base64)) fail()
        }
        db.prepare(`INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...values(row))
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) fail()
    db.exec('COMMIT')
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
}
function remap(value: unknown, ids: Map<string,string>): unknown {
  if (typeof value === 'string') {
    if (ids.has(value)) return ids.get(value)!
    if ((value.startsWith('[') || value.startsWith('{'))) { try { return JSON.stringify(remap(JSON.parse(value),ids)) } catch { return value } }
    return value
  }
  if (Array.isArray(value)) return value.map(v=>remap(v,ids))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,ids)]))
  return value
}
export class UnifiedBackupService {
  private previews = new Map<string,{ digest: string; expires: number }>()
  constructor(private story: DatabaseSync, private studio: DatabaseSync, private backups: BackupService) {}
  create(drafts: unknown = [], externalFiles = false) {
    if (!externalFiles && this.studio.prepare('SELECT 1 FROM studio_media_refs LIMIT 1').get()) throw new HttpError(413,'存在大型媒体，请使用统一媒体备份 v2')
    if (this.backups.busy) throw new HttpError(423,'备份或恢复正在进行')
    if (!Array.isArray(drafts) || Buffer.byteLength(JSON.stringify(drafts)) > 16*1024*1024) fail()
    this.backups.busy = true
    // Synchronous read under two reserved writer locks: no awaited gap for API,
    // timers or provider completions; external writers are excluded as well.
    try {
      this.story.exec('BEGIN IMMEDIATE')
      try {
        this.studio.exec('BEGIN IMMEDIATE')
        try {
          const payload: Payload = { format:'storyforge-unified',version:1,createdAt:new Date().toISOString(),story:capture(this.story),studio:capture(this.studio),drafts: drafts as unknown[] }
          // Upload sessions and executable remote jobs are never replayed by a restored copy.
          payload.studio.studio_uploads=[]
          payload.studio.studio_media_objects=payload.studio.studio_media_objects.filter(o=>payload.studio.studio_media_refs.some(r=>r.digest===o.digest))
          if(Buffer.byteLength(JSON.stringify(payload)) > 128*1024*1024) throw new HttpError(413,'备份超过128MiB，请拆分项目后导出')
          return { ...payload,sha256:digest(payload) }
        } finally { this.studio.exec('ROLLBACK') }
      } finally { this.story.exec('ROLLBACK') }
    } finally { this.backups.busy=false }
  }
  private stage(input: unknown) {
    if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input)) > 128*1024*1024) fail()
    const {sha256,...a} = input as Payload & {sha256:string}
    if (a.format !== 'storyforge-unified' || a.version !== 1 || !Number.isFinite(Date.parse(a.createdAt)) || !Array.isArray(a.drafts) || sha256 !== digest(a)) fail()
    const dir=mkdtempSync(join(tmpdir(),'sf-unified-')), story=openDatabase(dir), studio=openStudioDatabase(dir)
    try {
      load(story,a.story)
      const compatible={...a.studio}
      for(const t of ['studio_jobs','studio_job_events','studio_uploads','studio_media_objects','studio_media_refs']) compatible[t]??=[]
      load(studio,compatible)
      // Validate against the exact frozen novel schema and rich-text validators.
      story.exec('PRAGMA journal_mode=DELETE')
      this.backups.validateDatabase(join(dir,'storyforge.sqlite'))
      const store=new StudioStore(studio)
      for(const kind of ['music','video'] as const) for(const p of store.list(kind)) store.importer().validate(store.export(p.id,true))
      return {payload:a as Payload,digest:sha256,dir,story,studio,close(){story.close();studio.close();rmSync(dir,{recursive:true,force:true})}}
    } catch(error) { story.close();studio.close();rmSync(dir,{recursive:true,force:true}); throw error }
  }
  recoveredDrafts() { return this.studio.prepare('SELECT * FROM unified_drafts ORDER BY id').all() }
  prepare(input: unknown, externalFiles = false) {
    if (!externalFiles && (input as Payload)?.studio?.studio_media_refs?.length) throw new HttpError(400,'大媒体需要 v2 文件校验预览')
    const stage=this.stage(input)
    try {
      for(const [token,p] of this.previews) if(p.expires<Date.now()) this.previews.delete(token)
      if(this.previews.size>=20) throw new HttpError(429,'待确认备份过多')
      const token=randomUUID();this.previews.set(token,{digest:stage.digest,expires:Date.now()+300000})
      return {token,createdAt:stage.payload.createdAt,story:stage.payload.story.novels.length,music:stage.payload.studio.studio_projects.filter(p=>p.kind==='music').length,video:stage.payload.studio.studio_projects.filter(p=>p.kind==='video').length,drafts:stage.payload.drafts.length,policy:'所选模块均恢复为新副本，不覆盖现有作品'}
    } finally {stage.close()}
  }
  restore(input: unknown, token: unknown, selection: unknown, confirmation: unknown, beforeCommit?:()=>void, externalFiles = false) {
    if (!externalFiles && (input as Payload)?.studio?.studio_media_refs?.length) throw new HttpError(400,'大媒体需要 v2 文件校验恢复')
    if(this.backups.busy) throw new HttpError(423,'备份或恢复正在进行')
    if(!Array.isArray(selection) || !selection.length || selection.some(x=>!['story','music','video','drafts'].includes(x)) || new Set(selection).size!==selection.length || confirmation!=='恢复为新副本') fail()
    const selected=selection as Module[], preview=typeof token==='string'?this.previews.get(token):undefined, stage=this.stage(input)
    try {
      if(!preview || preview.expires<Date.now() || preview.digest!==stage.digest) throw new HttpError(400,'请重新预览并确认恢复')
      this.previews.delete(String(token));this.backups.busy=true
      const ids=new Map<string,string>()
      for(const source of [stage.payload.story,stage.payload.studio]) for(const rows of Object.values(source)) for(const row of rows) if(typeof row.id==='string') ids.set(row.id,randomUUID())
      const studioPath=String(this.studio.prepare('PRAGMA database_list').get()!.file)
      if(!studioPath || !String(this.story.prepare('PRAGMA database_list').get()!.file)) throw new Error('恢复要求持久 SQLite 测试库或本机库')
      // SQLite super-journal guarantees an atomic commit across attached files
      // only with rollback journals, not WAL. Never copy/delete live db/WAL files.
      let attached=false
      try {
        this.story.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL')
        this.studio.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL')
        if(this.story.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete' || this.studio.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete') throw new HttpError(423,'数据库仍被其他连接占用，无法安全恢复')
        this.story.prepare('ATTACH DATABASE ? AS studio_restore').run(studioPath);attached=true
        this.story.exec('PRAGMA studio_restore.synchronous=FULL; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON')
        try {
          for(const module of selected) {
            if(this.story.prepare('SELECT 1 FROM studio_restore.unified_restores WHERE digest=? AND module=?').get(stage.digest,module)) throw new HttpError(409,'所选模块已从此备份恢复')
            this.story.prepare('INSERT INTO studio_restore.unified_restores VALUES(?,?)').run(stage.digest,module)
          }
          const insert=(schema:string,table:string,rows:Row[])=>{for(const original of rows){
            const row=remap(original,ids) as Row
            if(table==='novels' || table==='studio_projects') row.title=String(row.title).slice(0,160)+'（恢复副本 '+String(row.id).slice(0,8)+'）'
            this.story.prepare(`INSERT INTO ${schema}.${quote(table)} (${Object.keys(row).map(quote).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...values(row))
          }}
          if(selected.includes('story')) for(const [table,rows] of Object.entries(stage.payload.story)) {
            // Global preferences and aggregated counters remain in the archive;
            // restoring works must not overwrite the current installation's settings.
            if(['schema_migrations','planning_migrations','writing_settings','writing_days'].includes(table)) continue
            insert('main',table,rows)
          }
          const projectIds=new Set(stage.payload.studio.studio_projects.filter(p=>selected.includes(p.kind as Module)).map(p=>p.id))
          for(const table of ['studio_projects','studio_versions','studio_assets','studio_tasks']) {
            const rows=stage.payload.studio[table].filter(r=>projectIds.has(table==='studio_projects'?r.id:r.projectId)).map(r=>({...r}))
            if(table==='studio_versions') for(const r of rows) { delete r.id; const p=stage.payload.studio.studio_projects.find(p=>p.id===r.projectId); if(p?.version===r.version) r.title=String(r.title).slice(0,160)+'（恢复副本 '+ids.get(String(r.projectId))!.slice(0,8)+'）' }
            if(table==='studio_tasks') for(const r of rows) if(['queued','running'].includes(String(r.status))) {r.status='failed';r.progress=0;r.error='备份时任务未完成，请重新生成'}
            insert('studio_restore',table,rows)
          }
          const mediaRefs=(stage.payload.studio.studio_media_refs??[]).filter(r=>projectIds.has(r.projectId))
          for(const row of stage.payload.studio.studio_media_objects??[]) if(mediaRefs.some(r=>r.digest===row.digest)) this.story.prepare('INSERT OR IGNORE INTO studio_restore.studio_media_objects(digest,bytes,createdAt) VALUES(?,?,?)').run(String(row.digest),Number(row.bytes),Number(row.createdAt))
          insert('studio_restore','studio_media_refs',mediaRefs)
          if(this.story.prepare('PRAGMA main.foreign_key_check').all().length || this.story.prepare('PRAGMA studio_restore.foreign_key_check').all().length) fail()
          if(selected.includes('drafts')) {
            for (const draft of stage.payload.drafts) this.story.prepare('INSERT INTO studio_restore.unified_drafts VALUES(?,?)').run(randomUUID(),JSON.stringify(remap(draft,ids)))
            for (const row of stage.payload.studio.unified_drafts) this.story.prepare('INSERT INTO studio_restore.unified_drafts VALUES(?,?)').run(randomUUID(),String(remap(row.payload,ids)))
          }
          beforeCommit?.()
          this.story.exec('COMMIT')
          return {idMap:Object.fromEntries(ids),drafts:stage.payload.drafts,modules:selected}
        } catch(error) {if(this.story.isTransaction)this.story.exec('ROLLBACK');throw error}
      } finally {
        if(attached)this.story.exec('DETACH DATABASE studio_restore')
        this.story.exec('PRAGMA journal_mode=WAL');this.studio.exec('PRAGMA journal_mode=WAL')
      }
    } finally {this.backups.busy=false;stage.close()}
  }
}
