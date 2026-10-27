import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CreativeProvider, StudioAsset, StudioKind, StudioProject, StudioSettings, StudioTask, StudioVersion } from '../../../../shared/contracts/studio.js'
import { HttpError } from '../novels/store.js'
import { StudioImporter } from './import.js'
import { StudioJobs, LocalAsyncProvider, type AsyncCreativeProvider } from './jobs.js'
import { MockCreativeProvider } from './provider.js'

export function string(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new HttpError(400, `${name}无效`)
  return value
}
export function settings(value: unknown, kind: StudioKind): StudioSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 200000) throw new HttpError(400, '配置无效')
  const result = value as StudioSettings
  for (const [key, v] of Object.entries(result)) {
    if (key.length > 100 || !(typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.every(item => typeof item === 'string')))) throw new HttpError(400, '配置类型无效')
  }
  if (kind === 'music') {
    if (result.tempo !== undefined && (typeof result.tempo !== 'number' || result.tempo < 20 || result.tempo > 300)) throw new HttpError(400, '速度范围为20–300')
    for (const key of ['genre', 'mood']) if (result[key] !== undefined) string(result[key], key, 200, true)
    if (result.structure !== undefined && (!Array.isArray(result.structure) || result.structure.length > 30 || result.structure.some(s => s.length > 100))) throw new HttpError(400, '歌曲结构无效')
  } else {
    if (result.aspectRatio !== undefined && !['16:9', '9:16', '1:1'].includes(String(result.aspectRatio))) throw new HttpError(400, '画面比例无效')
    if (result.shots !== undefined) {
      let shots: unknown
      try { shots = JSON.parse(String(result.shots)) } catch { throw new HttpError(400, '分镜JSON无效') }
      if (!Array.isArray(shots) || shots.length > 100) throw new HttpError(400, '分镜数量无效')
      const ids = new Set<string>()
      for (const shot of shots) {
        if (!shot || typeof shot !== 'object') throw new HttpError(400, '分镜无效')
        const s = shot as Record<string, unknown>
        const id = string(s.id, '镜头ID', 100)
        if (ids.has(id)) throw new HttpError(400, '镜头ID重复')
        ids.add(id); string(s.description, '镜头描述', 2000); string(s.camera, '运镜', 100)
        if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration < 1 || s.duration > 60) throw new HttpError(400, '镜头时长无效')
      }
    }
  }
  return result
}
const mapProject = (row: Record<string, unknown>): StudioProject => ({ ...row, settings: JSON.parse(String(row.settings)) }) as unknown as StudioProject
const assetColumns = 'id,projectId,name,mime,bytes,createdAt'
export class StudioStore {
  get backupDatabase() { return this.db }
  importer() { return new StudioImporter(this.db) }
  readonly jobs: StudioJobs
  constructor(private db: DatabaseSync, provider: CreativeProvider = new MockCreativeProvider(), providers?: readonly AsyncCreativeProvider[]) {
    this.jobs = new StudioJobs(db, providers ?? [new LocalAsyncProvider(provider)], (id, output) => {
      if (!output.data.length || output.data.length > 650000 || !['audio/wav','video/webm'].includes(output.mime) || !/^[\w.-]{1,200}$/.test(output.name)) throw new Error('Invalid provider output')
      return this.writeAsset(id, output.name, output.mime, output.data).id
    })
  }
  list(kind: unknown) {
    if (kind !== 'music' && kind !== 'video') throw new HttpError(400, '业务模块无效')
    return this.db.prepare('SELECT * FROM studio_projects WHERE kind=? ORDER BY updatedAt DESC,id').all(kind).map(mapProject)
  }
  project(id: string): StudioProject {
    const row = this.db.prepare('SELECT * FROM studio_projects WHERE id=?').get(id)
    if (!row) throw new HttpError(404, '项目不存在')
    return mapProject(row)
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = action(); this.db.exec('COMMIT'); return value } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  private remember(project: StudioProject) {
    this.db.prepare('INSERT INTO studio_versions(projectId,version,title,content,settings,createdAt) VALUES(?,?,?,?,?,?)').run(project.id, project.version, project.title, project.content, JSON.stringify(project.settings), project.updatedAt)
  }
  create(body: Record<string, unknown>) {
    if (body.kind !== 'music' && body.kind !== 'video') throw new HttpError(400, '业务模块无效')
    const project: StudioProject = { id: randomUUID(), kind: body.kind, title: string(body.title, '项目名称', 200), content: '', settings: {}, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    return this.transaction(() => { this.db.prepare('INSERT INTO studio_projects VALUES(?,?,?,?,?,?,?,?)').run(project.id, project.kind, project.title, '', '{}', 1, project.createdAt, project.updatedAt); this.remember(project); return project })
  }
  save(id: string, body: Record<string, unknown>) {
    return this.transaction(() => {
      const current = this.project(id)
      if (body.version !== current.version) throw new HttpError(409, '项目已更改，请保留本机编辑并重新载入')
      const project = { ...current, title: string(body.title, '项目名称', 200), content: string(body.content, '内容', 200000, true), settings: settings(body.settings, current.kind), version: current.version + 1, updatedAt: new Date().toISOString() }
      this.db.prepare('UPDATE studio_projects SET title=?,content=?,settings=?,version=?,updatedAt=? WHERE id=?').run(project.title, project.content, JSON.stringify(project.settings), project.version, project.updatedAt, id)
      this.remember(project); return project
    })
  }
  history(id: string): StudioVersion[] { this.project(id); return this.db.prepare('SELECT * FROM studio_versions WHERE projectId=? ORDER BY version DESC').all(id).map(row => ({ ...row, settings: JSON.parse(String(row.settings)) })) as unknown as StudioVersion[] }
  assets(id: string): StudioAsset[] { this.project(id); return this.db.prepare(`SELECT ${assetColumns} FROM studio_assets WHERE projectId=? ORDER BY createdAt,id`).all(id) as unknown as StudioAsset[] }
  asset(id: string) { const row = this.db.prepare('SELECT * FROM studio_assets WHERE id=?').get(id); if (!row) throw new HttpError(404, '素材不存在'); return row }
  addAsset(id: string, body: Record<string, unknown>) {
    this.project(id)
    const name = string(body.name, '素材名称', 200), mime = string(body.mime, '素材类型', 100), base64 = string(body.data, '素材数据', 900000)
    if (!['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new HttpError(400, '素材格式不支持')
    const data = Buffer.from(base64, 'base64')
    if (!data.length || data.length > 650000 || data.toString('base64') !== base64) throw new HttpError(400, '素材大小或编码无效（上限650KB）')
    return this.writeAsset(id, name, mime, data)
  }
  private writeAsset(projectId: string, name: string, mime: string, data: Uint8Array): StudioAsset {
    const asset = { id: randomUUID(), projectId, name, mime, bytes: data.byteLength, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO studio_assets VALUES(?,?,?,?,?,?,?)').run(asset.id, projectId, name, mime, asset.bytes, data, asset.createdAt)
    return asset
  }
  tasks(id: string): StudioTask[] { this.project(id); return this.db.prepare('SELECT * FROM studio_tasks WHERE projectId=? ORDER BY createdAt DESC,id').all(id) as unknown as StudioTask[] }
  async generate(id: string, body: Record<string, unknown>) {
    const project = this.project(id)
    if (body.version !== project.version) throw new HttpError(409, '项目已更改，请先保存后生成')
    const prompt = string(body.prompt, '提示词', 10000)
    return this.jobs.submit({ project, prompt }, body)
  }

  export(id: string) {
    const payload = { schema: 1, project: this.project(id), history: this.history(id), tasks: this.tasks(id), assets: this.assets(id).map(asset => ({ ...asset, data: Buffer.from(this.asset(asset.id).data as Uint8Array).toString('base64') })) }
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
  }
}
