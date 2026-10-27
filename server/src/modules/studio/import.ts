import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../novels/store.js'
import { settings, string } from './store.js'
import type { StudioProject, StudioVersion, StudioTask, StudioAsset } from '../../../../shared/contracts/studio.js'

export const importLimit = 64 * 1024 * 1024
const fail = (): never => { throw new HttpError(400, '工程格式、版本或关联数据完整性无效') }
const date = (v: unknown) => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) fail() }
const id = (v: unknown) => { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)) fail() }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
type Archive = { schema: number; project: StudioProject; history: StudioVersion[]; tasks: StudioTask[]; assets: (StudioAsset & { data: string })[] }
export class StudioImporter {
  private previews = new Map<string, { digest: string; expires: number }>()
  constructor(private db: DatabaseSync) {}
  validate(input: unknown) {
    if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input)) > importLimit) fail()
    const { sha256, ...payload } = input as Archive & { sha256?: string }
    if (sha256 !== undefined && sha256 !== hash(payload)) throw new HttpError(400, '工程 SHA-256 校验失败')
    const a = payload as Archive
    if (a.schema !== 1 || !a.project || !Array.isArray(a.history) || !Array.isArray(a.assets) || !Array.isArray(a.tasks)) fail()
    const p = a.project
    id(p.id); if (!['music','video'].includes(p.kind)) fail()
    const content = (v: { title: string; content: string; settings: unknown }) => { string(v.title, '标题', 200); string(v.content, '内容', 200000, true); settings(v.settings, p.kind) }
    content(p); date(p.createdAt); date(p.updatedAt)
    if (!Number.isSafeInteger(p.version) || p.version < 1 || a.history.length !== p.version || p.version > 10000 || a.assets.length > 10000 || a.tasks.length > 10000) fail()
    const versions = new Set<number>(), assetIds = new Set<string>(), taskIds = new Set<string>()
    for (const v of a.history) {
      if (!v || v.projectId !== p.id || !Number.isSafeInteger(v.version) || v.version < 1 || v.version > p.version || versions.has(v.version)) fail()
      versions.add(v.version); content(v); date(v.createdAt)
    }
    const latest = a.history.find(v => v.version === p.version)!
    if (latest.title !== p.title || latest.content !== p.content || JSON.stringify(latest.settings) !== JSON.stringify(p.settings)) fail()
    for (const asset of a.assets) {
      id(asset.id); if (assetIds.has(asset.id) || asset.projectId !== p.id) fail(); assetIds.add(asset.id)
      string(asset.name, '素材名称', 200); date(asset.createdAt)
      // Never interpret archive names as paths, nor fetch URLs supplied by an archive.
      if ((/[\\/:]/.test(asset.name) || [...asset.name].some(c => c.charCodeAt(0) < 32)) || asset.name === '.' || asset.name === '..') throw new HttpError(400, '素材路径不安全')
      if (!['audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm','video/mp4','video/webm','image/png','image/jpeg','image/webp'].includes(asset.mime) || typeof asset.data !== 'string') fail()
      const data = Buffer.from(asset.data, 'base64')
      if (!data.length || data.length > 650000 || data.length !== asset.bytes || data.toString('base64') !== asset.data) fail()
    }
    for (const t of a.tasks) {
      id(t.id); if (taskIds.has(t.id) || t.projectId !== p.id || t.provider !== 'mock' || !['queued','running','completed','failed'].includes(t.status)) fail(); taskIds.add(t.id)
      date(t.createdAt); string(t.prompt, '提示词', 10000); if (!Number.isInteger(t.progress) || t.progress < 0 || t.progress > 100 || (t.error !== null && typeof t.error !== 'string') || (t.assetId !== null && !assetIds.has(t.assetId)) || (t.status === 'completed' && !t.assetId)) fail()
    }
    return { archive: a, digest: hash(a), verified: sha256 !== undefined }
  }
  prepare(input: unknown) {
    const { archive: a, digest, verified } = this.validate(input)
    if (this.db.prepare('SELECT 1 FROM studio_imports WHERE digest=?').get(digest)) throw new HttpError(409, '该工程已导入，请打开已有副本')
    for (const [key, value] of this.previews) if (value.expires < Date.now()) this.previews.delete(key)
    if (this.previews.size >= 100) throw new HttpError(429, '待确认导入过多')
    const token = randomUUID(); this.previews.set(token, { digest, expires: Date.now() + 300000 })
    return { token, title: a.project.title, kind: a.project.kind, versions: a.history.length, assets: a.assets.length, bytes: a.assets.reduce((n, x) => n + x.bytes, 0), warning: verified ? '' : '旧格式无校验和，仅完成结构校验', policy: '始终创建新项目，不覆盖现有作品' }
  }
  restore(input: unknown, token: unknown, confirmation: unknown) {
    const { archive: a, digest } = this.validate(input)
    const preview = typeof token === 'string' ? this.previews.get(token) : undefined
    if (!preview || preview.digest !== digest || preview.expires < Date.now() || confirmation !== '作为新项目导入') throw new HttpError(400, '请先预览并确认导入')
    this.previews.delete(String(token))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.db.prepare('SELECT 1 FROM studio_imports WHERE digest=?').get(digest)) throw new HttpError(409, '该工程已导入')
      const p = a.project, projectId = randomUUID(), assets = new Map(a.assets.map(x => [x.id, randomUUID()]))
      // Suffix on every imported name also distinguishes same-name source works.
      const title = p.title.slice(0,170) + '（导入副本 ' + projectId.slice(0,8) + '）'
      this.db.prepare('INSERT INTO studio_projects VALUES(?,?,?,?,?,?,?,?)').run(projectId, p.kind, title, p.content, JSON.stringify(p.settings), p.version, p.createdAt, p.updatedAt)
      for (const v of a.history) this.db.prepare('INSERT INTO studio_versions(projectId,version,title,content,settings,createdAt) VALUES(?,?,?,?,?,?)').run(projectId,v.version,v.version === p.version ? title : v.title,v.content,JSON.stringify(v.settings),v.createdAt)
      for (const x of a.assets) this.db.prepare('INSERT INTO studio_assets VALUES(?,?,?,?,?,?,?)').run(assets.get(x.id)!,projectId,x.name,x.mime,x.bytes,Buffer.from(x.data,'base64'),x.createdAt)
      for (const t of a.tasks) {
        const interrupted = ['queued','running'].includes(t.status)
        this.db.prepare('INSERT INTO studio_tasks VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),projectId,t.provider,interrupted ? 'failed' : t.status,interrupted ? 0 : t.progress,t.prompt,t.assetId ? assets.get(t.assetId)! : null,interrupted ? '导入前任务未完成，请重新生成' : t.error,t.createdAt)
      }
      this.db.prepare('INSERT INTO studio_imports VALUES(?,?)').run(digest,projectId)
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) fail()
      this.db.exec('COMMIT'); return { id: projectId, title, kind: p.kind }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
