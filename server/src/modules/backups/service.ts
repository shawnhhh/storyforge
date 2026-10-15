import { migratePlanning } from '../../db/planning-migrate.js'
import { PlanningStore } from '../planning/store.js'
import { planningInput } from '../planning/validation.js'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants, chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backup, DatabaseSync } from 'node:sqlite'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { BackupEntry, BackupHistory, BackupSettings, RestorePreparation } from '../../../../shared/contracts/backups.js'
import { HttpError } from '../novels/store.js'
import { migrate, schemaVersion } from '../../db/migrate.js'
import { characterInput, worldInput } from '../story-bible/validation.js'

const DAY = 24 * 60 * 60 * 1000
const idPattern = /^storyforge-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.sqlite$/
const textSchema = getSchema([StarterKit])
function schemaSignature(db: DatabaseSync) {
  return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())
}
// Accept only exact, supported combinations of base and module schemas.
const schemaKey = (base: number, planning: number) => `${base}:${planning}`
const expectedSchemas = new Map<string, string>()
for (let version = 1; version <= schemaVersion; version++) {
  for (const planning of [0, 1]) {
    const reference = new DatabaseSync(':memory:')
    try {
      migrate(reference, version)
      if (planning) migratePlanning(reference)
      expectedSchemas.set(schemaKey(version, planning), schemaSignature(reference))
    } finally { reference.close() }
  }
}

// Persist metadata atomically with restrictive permissions. SQLite backup files are
// published only after validation; an interrupted pending file is never restorable.
function atomicJson(path: string, value: unknown) {
  const pending = `${path}.${randomUUID()}.pending`
  try {
    writeFileSync(pending, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
    const fd = openSync(pending, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(pending, path)
  } finally { rmSync(pending, { force: true }) }
}
function digest(path: string) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    let count: number
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
function finalizeSnapshot(path: string) {
  const snapshot = new DatabaseSync(path)
  try { snapshot.exec('PRAGMA journal_mode=DELETE') } finally { snapshot.close() }
  chmodSync(path, 0o600)
}

export class BackupService {
  readonly directory: string
  busy = false
  generation = randomUUID()
  private settings: BackupSettings
  private timer?: ReturnType<typeof setInterval>
  private preparations = new Map<string, { id: string; sha256: string; generation: string; expires: number }>()
  lastAutomaticError: string | null = null
  constructor(private db: DatabaseSync, directory: string, private now = () => Date.now()) {
    this.directory = resolve(directory)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    if (lstatSync(this.directory).isSymbolicLink()) throw new Error('备份目录不能包含符号链接')
    this.directory = realpathSync(this.directory)
    const projectRelative = relative(realpathSync(fileURLToPath(new URL('../../../../', import.meta.url))), this.directory)
    if (projectRelative === '' || (projectRelative.split(sep)[0] !== '..' && !isAbsolute(projectRelative))) throw new Error('备份目录必须位于项目代码之外')
    chmodSync(this.directory, 0o700)
    const settingsPath = join(this.directory, 'settings.json')
    this.settings = existsSync(settingsPath) ? this.validateSettings(JSON.parse(readFileSync(this.safeFile('settings.json'), 'utf8'))) : { enabled: true, retention: 14 }
  }
  private validateSettings(value: unknown): BackupSettings {
    if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean' || !('retention' in value) || typeof value.retention !== 'number' || !Number.isInteger(value.retention) || value.retention < 1 || value.retention > 365) throw new HttpError(400, '保留数量须为 1–365，自动备份开关须为布尔值')
    return { enabled: value.enabled, retention: value.retention }
  }
  // All externally selected files must be regular files directly inside this directory.
  private safeFile(name: string): string {
    if (name !== 'settings.json' && !idPattern.test(name) && !(name.endsWith('.json') && idPattern.test(name.slice(0, -5)))) throw new HttpError(400, '备份标识无效')
    const path = join(this.directory, name)
    try {
      const info = lstatSync(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || realpathSync(path) !== path) throw new Error('Unsafe path')
      return path
    } catch { throw new HttpError(400, '备份文件不存在或路径不安全') }
  }
  history(): BackupHistory {
    const entries: BackupEntry[] = []
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json') || !idPattern.test(name.slice(0, -5))) continue
      try {
        const entry = JSON.parse(readFileSync(this.safeFile(name), 'utf8')) as BackupEntry
        if (entry.id !== name.slice(0, -5) || !['manual', 'automatic', 'before-restore'].includes(entry.kind) || !Number.isFinite(Date.parse(entry.createdAt)) || !Number.isSafeInteger(entry.size) || entry.size < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !expectedSchemas.has(schemaKey(entry.schemaVersion, entry.planningVersion ?? 0))) throw new Error('Invalid metadata')
        entries.push(entry)
      } catch { /* Invalid metadata is never selectable for restore. */ }
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return { entries, settings: { ...this.settings }, directory: this.directory, lastAutomaticError: this.lastAutomaticError, busy: this.busy }
  }
  configure(value: unknown) {
    if (this.busy) throw new HttpError(423, '备份或恢复正在进行')
    const settings = this.validateSettings(value)
    atomicJson(join(this.directory, 'settings.json'), settings)
    this.settings = settings
    return this.history()
  }
  private validateDatabase(path: string, expectedVersion?: number, expectedPlanning?: number) {
    const header = Buffer.alloc(100), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { readSync(fd, header, 0, header.length, 0) } finally { closeSync(fd) }
    if (!header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new HttpError(400, '不是有效的 SQLite 数据库')
    if (header[18] !== 1 || header[19] !== 1 || ['-wal', '-shm', '-journal'].some(suffix => existsSync(path + suffix))) throw new HttpError(400, '备份不是独立快照，或存在未校验的 SQLite 日志文件')
    const candidate = new DatabaseSync(path, { readOnly: true })
    try {
      if (candidate.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new Error('Integrity check failed')
      if (candidate.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign keys invalid')
      const versions = candidate.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      const current = versions.length
      const hasPlanning = !!candidate.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='planning_migrations'").get()
      const planningVersion = hasPlanning ? 1 : 0
      if ((expectedVersion !== undefined && current !== expectedVersion) || (expectedPlanning !== undefined && planningVersion !== expectedPlanning) || versions.some((row, index) => row.version !== index + 1) || schemaSignature(candidate) !== expectedSchemas.get(schemaKey(current, planningVersion)) || candidate.prepare('PRAGMA user_version').get()?.user_version !== 0 || candidate.prepare('PRAGMA application_id').get()?.application_id !== 0) throw new Error('Incompatible schema')
      if (hasPlanning) {
        const modules = candidate.prepare('SELECT name FROM planning_migrations').all()
        if (modules.length !== 1 || modules[0].name !== 'planning/001') throw new Error('Incompatible planning schema')
        if (candidate.prepare('SELECT 1 FROM planning_chapter_links l JOIN chapters c ON c.id=l.chapter_id WHERE l.novel_id<>c.novel_id LIMIT 1').get()) throw new Error('Invalid chapter scope')
        const store = new PlanningStore(candidate)
        for (const row of candidate.prepare('SELECT id FROM novels').all()) planningInput(store.read(String(row.id)))
      }
      for (const row of candidate.prepare('SELECT content,content_schema_version FROM chapters').iterate()) {
        if (row.content_schema_version !== 1) throw new Error('Incompatible content schema')
        const doc = JSON.parse(String(row.content))
        if (doc.type !== 'doc') throw new Error('Invalid content')
        textSchema.nodeFromJSON(doc).check()
      }
      if (current >= 2) {
        for (const row of candidate.prepare('SELECT * FROM characters').iterate()) {
          characterInput({ ...row, tags: JSON.parse(String(row.tags)), fields: JSON.parse(String(row.fields)), relations: [], worldIds: [] })
        }
        for (const row of candidate.prepare('SELECT * FROM world_entries').iterate()) {
          worldInput({ ...row, tags: JSON.parse(String(row.tags)), timeText: row.time_text, sortOrder: row.sort_order, onTimeline: row.on_timeline === 1 })
        }
      }
    } catch { throw new HttpError(400, '备份完整性、数据库版本或正文格式检查失败，当前数据未更改') }
    finally { candidate.close() }
  }
  verify(id: string) {
    if (!idPattern.test(id)) throw new HttpError(400, '备份标识无效')
    const entry = this.history().entries.find(item => item.id === id)
    if (!entry) throw new HttpError(404, '备份不在可信历史列表中')
    const path = this.safeFile(id)
    if (statSync(path).size !== entry.size || digest(path) !== entry.sha256) throw new HttpError(400, '备份大小或 SHA-256 校验失败，当前数据未更改')
    this.validateDatabase(path, entry.schemaVersion, entry.planningVersion ?? 0)
    return entry
  }
  private async snapshot(kind: BackupEntry['kind']) {
    const createdAt = new Date(this.now()).toISOString()
    const id = `storyforge-${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`
    const pending = join(this.directory, `${id}.pending`), destination = join(this.directory, id)
    try {
      // node:sqlite backup wraps sqlite3_backup_init/step/finish, including WAL.
      await backup(this.db, pending)
      finalizeSnapshot(pending)
      this.validateDatabase(pending, schemaVersion, 1)
      const fd = openSync(pending, constants.O_RDONLY)
      try { fsyncSync(fd) } finally { closeSync(fd) }
      const entry: BackupEntry = { id, createdAt, size: statSync(pending).size, sha256: digest(pending), schemaVersion, planningVersion: 1, kind }
      renameSync(pending, destination)
      atomicJson(`${destination}.json`, entry)
      return entry
    } finally { rmSync(pending, { force: true }) }
  }
  private prune() {
    // Retention applies only to automatic backups. Manual and safety snapshots
    // are never silently removed, especially the immediate pre-restore snapshot.
    for (const entry of this.history().entries.filter(item => item.kind === 'automatic').slice(this.settings.retention)) {
      rmSync(this.safeFile(entry.id)); rmSync(this.safeFile(`${entry.id}.json`))
    }
  }
  async create(kind: 'manual' | 'automatic' = 'manual') {
    if (this.busy) throw new HttpError(423, '备份或恢复正在进行')
    this.busy = true
    try { const entry = await this.snapshot(kind); if (kind === 'automatic') this.prune(); return entry }
    finally { this.busy = false }
  }
  prepare(id: string): RestorePreparation {
    if (this.busy) throw new HttpError(423, '备份或恢复正在进行')
    const entry = this.verify(id), token = randomUUID(), expires = this.now() + 5 * 60_000
    for (const [key, value] of this.preparations) if (value.expires <= this.now()) this.preparations.delete(key)
    this.preparations.set(token, { id, sha256: entry.sha256, generation: this.generation, expires })
    return { token, backup: entry, expiresAt: new Date(expires).toISOString() }
  }
  async restore(id: string, token: unknown, confirmation: unknown, beforeCommit?: () => void) {
    if (this.busy) throw new HttpError(423, '备份或恢复正在进行')
    const prepared = typeof token === 'string' ? this.preparations.get(token) : undefined
    if (!prepared || prepared.id !== id || prepared.expires <= this.now() || prepared.generation !== this.generation || confirmation !== '替换当前全部数据') throw new HttpError(400, '请重新检查备份并确认替换当前全部数据')
    this.preparations.delete(String(token))
    this.busy = true
    const stage = join(this.directory, `restore-${randomUUID()}.pending`)
    try {
      const entry = this.verify(id)
      if (!timingSafeEqual(Buffer.from(entry.sha256), Buffer.from(prepared.sha256))) throw new HttpError(400, '备份已变化，请重新确认')
      // Take a private, validated SQLite snapshot of the selected history entry.
      // Restore never attaches a user-controlled live path after validation.
      const source = new DatabaseSync(this.safeFile(id), { readOnly: true })
      try { await backup(source, stage) } finally { source.close() }
      finalizeSnapshot(stage)
      this.verify(id)
      this.validateDatabase(stage)
      // Upgrade only the private stage. Never migrate or rewrite the original
      // history file, and never downgrade the live schema when restoring v1.
      const staged = new DatabaseSync(stage)
      try { migrate(staged); migratePlanning(staged) } finally { staged.close() }
      finalizeSnapshot(stage)
      this.validateDatabase(stage, schemaVersion, 1)
      const safety = await this.snapshot('before-restore')
      this.db.prepare('ATTACH DATABASE ? AS restore_source').run(stage)
      try {
        this.db.exec('BEGIN IMMEDIATE')
        try {
          // Every application table in schema v2 is restored atomically. No live
          // file copying, connection replacement, or WAL/SHM removal is involved.
          this.db.exec(`DELETE FROM planning_workspaces; DELETE FROM planning_migrations; DELETE FROM character_relations; DELETE FROM character_world_links;
            DELETE FROM characters; DELETE FROM world_entries;
            DELETE FROM chapters; DELETE FROM novels; DELETE FROM schema_migrations;
            INSERT INTO novels SELECT * FROM restore_source.novels;
            INSERT INTO chapters SELECT * FROM restore_source.chapters;
            INSERT INTO characters SELECT * FROM restore_source.characters;
            INSERT INTO world_entries SELECT * FROM restore_source.world_entries;
            INSERT INTO character_relations SELECT * FROM restore_source.character_relations;
            INSERT INTO character_world_links SELECT * FROM restore_source.character_world_links;
            INSERT INTO schema_migrations SELECT * FROM restore_source.schema_migrations;
            INSERT INTO planning_migrations SELECT * FROM restore_source.planning_migrations;
            INSERT INTO planning_workspaces SELECT * FROM restore_source.planning_workspaces;
            INSERT INTO planning_records SELECT * FROM restore_source.planning_records;
            INSERT INTO planning_chapter_links SELECT * FROM restore_source.planning_chapter_links;`)
          if (this.db.prepare('PRAGMA main.foreign_key_check').all().length) throw new Error('Restore foreign keys invalid')
          beforeCommit?.() // Fault injection is available to unit tests, never HTTP.
          this.db.exec('COMMIT')
          this.generation = randomUUID()
          this.preparations.clear()
        } catch (error) { this.db.exec('ROLLBACK'); throw error }
      } finally { this.db.exec('DETACH DATABASE restore_source') }
      return { safety, generation: this.generation }
    } finally {
      this.busy = false
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { rmSync(stage + suffix, { force: true }) }
        catch (error) { console.error('Restore staging cleanup failed:', error) }
      }
    }
  }
  async checkAutomatic() {
    if (!this.settings.enabled || this.busy) return
    const last = this.history().entries.find(item => item.kind === 'automatic')
    if (last && this.now() - Date.parse(last.createdAt) < DAY) return
    try { await this.create('automatic'); this.lastAutomaticError = null }
    catch (error) { this.lastAutomaticError = error instanceof Error ? error.message : '自动备份失败'; console.error('StoryForge automatic backup failed:', this.lastAutomaticError) }
  }
  start() {
    if (this.timer) return
    void this.checkAutomatic()
    this.timer = setInterval(() => { void this.checkAutomatic() }, 60_000)
    this.timer.unref()
  }
  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    // Do not close the SQLite connection while sqlite3_backup is stepping.
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 10))
  }
}
