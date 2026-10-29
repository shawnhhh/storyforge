import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, truncateSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { HttpError } from '../novels/store.js'

export const mediaLimit = 2 * 1024 ** 3
export const chunkLimit = 512 * 1024
const hashPattern = /^[a-f0-9]{64}$/
const mimes = ['audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm','video/mp4','video/webm','image/png','image/jpeg','image/webp']
export async function fileHash(path: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
export function checkContainer(mime: string, bytes: Uint8Array) {
  const b = Buffer.from(bytes), text = b.toString('ascii')
  const valid = mime === 'audio/wav' ? text.startsWith('RIFF') && text.slice(8,12) === 'WAVE' : mime.endsWith('/webm') ? b.subarray(0,4).equals(Buffer.from([26,69,223,163])) : mime.endsWith('/mp4') ? text.slice(4,8) === 'ftyp' : mime === 'audio/ogg' ? text.startsWith('OggS') : mime === 'audio/mpeg' ? text.startsWith('ID3') || (b[0] === 255 && (b[1] & 224) === 224) : mime === 'image/png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255 : mime === 'image/webp' ? text.startsWith('RIFF') && text.slice(8,12) === 'WEBP' : false
  if (!valid) throw new HttpError(400,'文件头与媒体类型不匹配')
}
interface Upload { id: string; projectId: string; name: string; mime: string; bytes: number; digest: string; offset: number; result: string | null; kind: string }
export class MediaStore {
  readonly root: string
  constructor(readonly db: DatabaseSync, directory?: string) {
    this.root = resolve(directory ?? join(dirname(String(db.prepare('PRAGMA database_list').get()!.file)), 'media'))
    for (const path of [this.root, join(this.root,'objects'),join(this.root,'pending'),join(this.root,'archives')]) { mkdirSync(path,{recursive:true,mode:0o700}); if (lstatSync(path).isSymbolicLink()) throw new Error('媒体目录不能是符号链接') }
  }
  objectPath(digest: string) { if (!hashPattern.test(digest)) throw new HttpError(400,'文件哈希无效'); return join(this.root,'objects',digest) }
  pendingPath(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400,'上传标识无效'); return join(this.root,'pending',id) }
  safe(path: string) { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new HttpError(400,'媒体文件路径不安全'); return path }
  private atomic<T>(fn:()=>T) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result } catch(e) { this.db.exec('ROLLBACK'); throw e } }
  start(projectId: string, body: Record<string,unknown>, kind='media') {
    if (!this.db.prepare('SELECT 1 FROM studio_projects WHERE id=?').get(projectId)) throw new HttpError(404,'项目不存在')
    const {name,mime,bytes,digest}=body
    if (typeof name !== 'string' || !/^[^\\/:]{1,200}$/.test(name) || [...name].some(c=>c.charCodeAt(0)<32) || name==='.' || name==='..' || typeof mime !== 'string' || (kind==='media' && !mimes.includes(mime)) || !Number.isSafeInteger(bytes) || Number(bytes)<12 || Number(bytes)>(kind==='backup'?32*1024**3:mediaLimit) || typeof digest!=='string' || !hashPattern.test(digest)) throw new HttpError(400,'上传参数无效（上限2GiB）')
    const id=randomUUID()
    const fd=openSync(this.pendingPath(id),'wx',0o600);closeSync(fd)
    try { this.db.prepare('INSERT INTO studio_uploads(id,projectId,name,mime,bytes,digest,offset,kind,createdAt) VALUES(?,?,?,?,?,?,0,?,?)').run(id,projectId,name,mime,Number(bytes),digest,kind,Date.now()) } catch(e) {rmSync(this.pendingPath(id),{force:true});throw e}
    return this.upload(id)
  }
  upload(id: string): Upload { const row=this.db.prepare('SELECT * FROM studio_uploads WHERE id=?').get(id); if(!row)throw new HttpError(404,'上传不存在');return row as unknown as Upload }
  chunk(id: string, body: Record<string,unknown>) {
    return this.atomic(()=>{
      const u=this.upload(id)
      if(u.result) return u
      if(typeof body.data!=='string' || body.data.length>chunkLimit*1.4 || !Number.isSafeInteger(body.offset))throw new HttpError(400,'分块参数无效')
      const bytes=Buffer.from(body.data,'base64'), offset=Number(body.offset)
      if(!bytes.length || bytes.length>chunkLimit || bytes.toString('base64')!==body.data || offset<0 || offset+bytes.length>u.bytes)throw new HttpError(400,'分块大小或编码无效')
      const path=this.safe(this.pendingPath(id)), fd=openSync(path,'r+')
      try {
        // Bytes written before a crashed SQL commit are truncated back to the committed offset.
        if(statSync(path).size<u.offset)throw new HttpError(409,'上传文件损坏，请重新上传')
        if(offset<u.offset) { const old=Buffer.alloc(bytes.length);readSync(fd,old,0,old.length,offset);if(offset+bytes.length<=u.offset && old.equals(bytes))return u;throw new HttpError(409,'重复分块内容不一致') }
        if(offset!==u.offset)throw new HttpError(409,'分块位置不匹配，请查询已保存偏移')
        truncateSync(path,u.offset)
        let written=0;while(written<bytes.length)written+=writeSync(fd,bytes,written,bytes.length-written,u.offset+written)
        fsyncSync(fd)
        this.db.prepare('UPDATE studio_uploads SET offset=offset+? WHERE id=?').run(bytes.length,id)
        return this.upload(id)
      } finally {closeSync(fd)}
    })
  }
  async verifyUpload(id: string) {
    const u=this.upload(id)
    if(u.offset!==u.bytes)throw new HttpError(409,'上传未完成')
    const path=this.safe(existsSync(this.pendingPath(id))?this.pendingPath(id):this.objectPath(u.digest))
    if(statSync(path).size!==u.bytes || await fileHash(path)!==u.digest)throw new HttpError(400,'文件完整性校验失败')
    if(u.kind==='media') {const fd=openSync(path,'r'),head=Buffer.alloc(32);try {readSync(fd,head,0,32,0);checkContainer(u.mime,head)}finally{closeSync(fd)}}
    return {u,path}
  }
  async prepare(id: string) {
    const {u,path}=await this.verifyUpload(id)
    if(u.kind!=='media')throw new HttpError(400,'不是媒体上传')
    const destination=this.objectPath(u.digest)
    if(existsSync(destination))await this.verify(u.digest);else renameSync(path,destination)
    return id
  }
  publishPrepared(id:string) {
    const u=this.upload(id);if(u.result)return this.ref(u.result)
    if(u.kind!=='media'||u.offset!==u.bytes||statSync(this.safe(this.objectPath(u.digest))).size!==u.bytes)throw new HttpError(400,'媒体尚未校验发布')
    this.db.prepare('INSERT OR IGNORE INTO studio_media_objects(digest,bytes,createdAt) VALUES(?,?,?)').run(u.digest,u.bytes,Date.now())
    const ref=randomUUID()
    this.db.prepare('INSERT INTO studio_media_refs VALUES(?,?,?,?,?,?)').run(ref,u.projectId,u.name,u.mime,u.digest,new Date().toISOString())
    this.db.prepare('UPDATE studio_uploads SET result=? WHERE id=?').run(ref,id)
    return this.ref(ref)
  }
  async complete(id: string) {
    const old=this.upload(id);if(old.result)return this.ref(old.result)
    await this.prepare(id)
    return this.atomic(()=>this.publishPrepared(id))
  }
  list(projectId: string) {return this.db.prepare('SELECT r.*,o.bytes FROM studio_media_refs r JOIN studio_media_objects o USING(digest) WHERE projectId=? ORDER BY createdAt,id').all(projectId)}
  ref(id: string) { const r=this.db.prepare('SELECT r.*,o.bytes FROM studio_media_refs r JOIN studio_media_objects o USING(digest) WHERE r.id=?').get(id);if(!r)throw new HttpError(404,'素材不存在');return r }
  references(digest: string) {return Number(this.db.prepare('SELECT COUNT(*) n FROM studio_media_refs WHERE digest=?').get(digest)!.n)}
  unlink(id: string) {
    for(const p of this.db.prepare("SELECT settings FROM studio_projects WHERE kind='video' UNION ALL SELECT settings FROM studio_versions").all()){const s=JSON.parse(String(p.settings));if(s.composition){const c=JSON.parse(String(s.composition));const direct=c.tracks.some((t:{clips:{source?:{kind:string;id:string}}[]})=>t.clips.some(x=>x.source?.kind==='media'&&x.source.id===id));const task=this.db.prepare('SELECT taskId FROM studio_task_media WHERE mediaId=?').all(id).map(r=>String(r.taskId));if(direct||c.tracks.some((t:{clips:{source?:{kind:string;id:string}}[]})=>t.clips.some(x=>x.source?.kind==='task'&&task.includes(x.source.id)))||c.shots.some((s:{taskIds:string[]})=>s.taskIds.some(id=>task.includes(id))))throw new HttpError(409,'素材被时间线、分镜任务或历史版本引用，不能解除')} }
    this.db.prepare('DELETE FROM studio_media_refs WHERE id=?').run(id)}
  async verify(digest: string) { const path=this.safe(this.objectPath(digest));if(await fileHash(path)!==digest)throw new HttpError(400,'媒体对象校验失败');return path }
  gc(now=Date.now()) {
    // Conservative grace period: active backups and interrupted publications can finish first.
    return this.atomic(()=>{let removed=0
      for(const name of readdirSync(join(this.root,'objects'))) {
        if(!hashPattern.test(name))continue
        const path=this.safe(this.objectPath(name))
        if(!this.references(name) && statSync(path).mtimeMs<now-86400000) {rmSync(path);this.db.prepare('DELETE FROM studio_media_objects WHERE digest=?').run(name);removed++}
      }
      for(const name of readdirSync(join(this.root,'archives')))if(/^[a-f0-9-]{36}(\.pending)?$/.test(name)){const path=this.safe(join(this.root,'archives',name));if(statSync(path).mtimeMs<now-7*86400000)rmSync(path)}
      for(const row of this.db.prepare('SELECT id FROM studio_uploads WHERE createdAt<?').all(now-7*86400000)) {rmSync(this.pendingPath(String(row.id)),{force:true});this.db.prepare('DELETE FROM studio_uploads WHERE id=?').run(row.id)}
      return {removed}
    })
  }
}
