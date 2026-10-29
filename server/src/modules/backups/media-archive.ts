import { randomUUID, createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, fsyncSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { HttpError } from '../novels/store.js'
import { MediaStore, checkContainer, fileHash } from '../studio/media.js'
import type { UnifiedBackupService } from './unified.js'
const magic=Buffer.from('SFMEDIA2\n')
export class MediaArchive {
  private previews=new Map<string,{archive:unknown;unifiedToken:string;expires:number;digests:string[]}>()
  constructor(private media:MediaStore,private unified:UnifiedBackupService) {}
  path(id:string) {if(!/^[a-f0-9-]{36}$/.test(id))throw new HttpError(400,'备份标识无效');return join(this.media.root,'archives',id)}
  async create(drafts:unknown) {
    const archive=this.unified.create(drafts,true)
    const objects=archive.studio.studio_media_objects.map(o=>({digest:String(o.digest),bytes:Number(o.bytes)}))
    const header=Buffer.from(JSON.stringify({archive,objects})),size=Buffer.alloc(4);size.writeUInt32BE(header.length)
    const id=randomUUID(),pending=this.path(id)+'.pending',stream=createWriteStream(pending,{flags:'wx',mode:0o600})
    let error:unknown;stream.on('error',e=>{error=e})
    const write=async(chunk:Uint8Array)=>{if(error)throw error;if(!stream.write(chunk))await once(stream,'drain')}
    try {
      await write(magic);await write(size);await write(header)
      for(const object of objects) {
        const path=await this.media.verify(object.digest)
        if(statSync(path).size!==object.bytes)throw new HttpError(400,'备份媒体大小不匹配')
        for await(const chunk of createReadStream(path))await write(chunk)
      }
      stream.end();await once(stream,'finish')
      const fd=openSync(pending,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
      renameSync(pending,this.path(id));return {id,bytes:statSync(this.path(id)).size,sha256:await fileHash(this.path(id)),format:'storyforge-media-v2'}
    }catch(e){stream.destroy();rmSync(pending,{force:true});throw e}
  }
  async preview(uploadId:string) {
    const {u,path}=await this.media.verifyUpload(uploadId)
    if(u.kind!=='backup')throw new HttpError(400,'不是备份上传')
    const fd=openSync(path,'r'),read=(n:number,position:number)=>{const b=Buffer.alloc(n);if(readSync(fd,b,0,n,position)!==n)throw new HttpError(400,'备份不完整');return b}
    const pending:string[]=[]
    try {
      if(!read(magic.length,0).equals(magic))throw new HttpError(400,'备份格式无效')
      const length=read(4,magic.length).readUInt32BE();if(length>129*1024**2)throw new HttpError(413,'备份元数据过大')
      const header=JSON.parse(read(length,magic.length+4).toString())
      if(!header || !Array.isArray(header.objects) || header.objects.length>10000)throw new HttpError(400,'备份清单无效')
      const expected=header.archive?.studio?.studio_media_objects
      if(!Array.isArray(expected) || expected.length!==header.objects.length || new Set(header.objects.map((o:{digest:string})=>o.digest)).size!==expected.length)throw new HttpError(400,'备份对象清单不一致')
      // Stage validates all relational data before any files are published or works inserted.
      const preview=this.unified.prepare(header.archive,true)
      let position=magic.length+4+length
      for(const object of header.objects) {
        if(!Number.isSafeInteger(object.bytes) || object.bytes<12 || object.bytes>2*1024**3 || !expected.some((o:{digest:string;bytes:number})=>o.digest===object.digest && o.bytes===object.bytes))throw new HttpError(400,'备份对象无效')
        const destination=this.media.objectPath(object.digest),temp=destination+'.'+randomUUID()+'.pending';pending.push(temp)
        const out=openSync(temp,'wx',0o600),hash=createHash('sha256'),head=read(Math.min(32,object.bytes),position)
        try {for(let offset=0;offset<object.bytes;) {const b=read(Math.min(65536,object.bytes-offset),position+offset);hash.update(b);let written=0;while(written<b.length)written+=writeSync(out,b,written,b.length-written);offset+=b.length}fsyncSync(out)}finally{closeSync(out)}
        if(hash.digest('hex')!==object.digest)throw new HttpError(400,'备份媒体哈希不匹配')
        for(const ref of header.archive.studio.studio_media_refs.filter((r:{digest:string})=>r.digest===object.digest))checkContainer(ref.mime,head)
        position+=object.bytes
      }
      if(position!==u.bytes)throw new HttpError(400,'备份尾部或长度无效')
      // Validated objects are immutable; failed DB restore leaves only safe, unreferenced files.
      for(let i=0;i<header.objects.length;i++) {
        const destination=this.media.objectPath(header.objects[i].digest)
        if(existsSync(destination)) {await this.media.verify(header.objects[i].digest);rmSync(pending[i])} else renameSync(pending[i],destination)
      }
      for(const [token,p]of this.previews)if(p.expires<Date.now())this.previews.delete(token)
      if(this.previews.size>=20)throw new HttpError(429,'待确认备份过多')
      const token=randomUUID();this.previews.set(token,{archive:header.archive,unifiedToken:preview.token,expires:Date.now()+300000,digests:header.objects.map((o:{digest:string})=>o.digest)})
      return {...preview,token,media:header.objects.length}
    }finally{closeSync(fd);for(const file of pending)rmSync(file,{force:true})}
  }
  async restore(token:unknown,modules:unknown,confirmation:unknown) {
    const preview=typeof token==='string'?this.previews.get(token):undefined
    if(!preview || preview.expires<Date.now())throw new HttpError(400,'请重新预览备份')
    for(const digest of preview.digests)await this.media.verify(digest)
    const result=this.unified.restore(preview.archive,preview.unifiedToken,modules,confirmation,undefined,true)
    this.previews.delete(String(token));return result
  }
}
