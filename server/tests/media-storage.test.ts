import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { openDatabase } from '../src/db/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { UnifiedBackupService } from '../src/modules/backups/unified.js'
import { MediaArchive } from '../src/modules/backups/media-archive.js'
import { createApp } from '../src/app.js'
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const wav=()=>{const b=Buffer.alloc(3*1024**2,7);b.write('RIFF');b.write('WAVE',8);return b}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'sf-media-')),db=openStudioDatabase(dir),story=openDatabase(dir),store=new StudioStore(db),backups=new BackupService(story,join(dir,'backups')),unified=new UnifiedBackupService(story,db,backups);return{dir,db,story,store,backups,unified,archive:new MediaArchive(store.media,unified),close(){store.jobs.stop();db.close();story.close();rmSync(dir,{recursive:true,force:true})}}}
async function upload(f:ReturnType<typeof fixture>,projectId:string,bytes:Buffer,kind='media'){const u=f.store.media.start(projectId,{name:kind==='media'?'large.wav':'backup.sfm',mime:'audio/wav',bytes:bytes.length,digest:hash(bytes)},kind);for(let offset=0;offset<bytes.length;offset+=524288)f.store.media.chunk(u.id,{offset,data:bytes.subarray(offset,offset+524288).toString('base64')});return u.id}
test('large chunk upload resumes from durable offset, rejects changed replay, deduplicates and collects only unreferenced objects',async()=>{
 const f=fixture();try{
 const p=f.store.create({kind:'music',title:'original'}),bytes=wav(),u=f.store.media.start(p.id,{name:'large.wav',mime:'audio/wav',bytes:bytes.length,digest:hash(bytes)})
 const data=bytes.subarray(0,524288).toString('base64');f.store.media.chunk(u.id,{offset:0,data});f.store.media.chunk(u.id,{offset:0,data})
 assert.equal(f.store.media.upload(u.id).offset,524288);assert.throws(()=>f.store.media.chunk(u.id,{offset:0,data:Buffer.alloc(524288).toString('base64')}),/不一致/)
 // Another connection sees the committed offset; extra uncommitted tail bytes are discarded.
 appendFileSync(f.store.media.pendingPath(u.id),Buffer.from('uncommitted tail'));
 const second=openStudioDatabase(f.dir);assert.equal(second.prepare('SELECT offset FROM studio_uploads WHERE id=?').get(u.id)!.offset,524288);second.close()
 for(let offset=524288;offset<bytes.length;offset+=524288)f.store.media.chunk(u.id,{offset,data:bytes.subarray(offset,offset+524288).toString('base64')})
 const a=await f.store.media.complete(u.id);assert.deepEqual(await f.store.media.complete(u.id),a)
 const other=f.store.create({kind:'video',title:'other'}),id=await upload(f,other.id,bytes),b=await f.store.media.complete(id)
 assert.equal(f.store.media.references(hash(bytes)),2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM studio_media_objects').get()!.n,1)
 assert.deepEqual(readFileSync(await f.store.media.verify(hash(bytes))),bytes)
 f.store.media.unlink(String(a.id));f.store.media.gc(Date.now()+2*86400000);assert.equal(existsSync(f.store.media.objectPath(hash(bytes))),true)
 f.store.media.unlink(String(b.id));assert.equal(f.store.media.gc(Date.now()+2*86400000).removed,1);assert.equal(f.store.project(p.id).title,'original')
 }finally{f.close()}
})
test('integrity and container mismatches do not create media references',async()=>{
 const f=fixture();try{const p=f.store.create({kind:'music',title:'safe'}),bytes=wav(),id=await upload(f,p.id,bytes);writeFileSync(f.store.media.pendingPath(id),Buffer.alloc(bytes.length));await assert.rejects(f.store.media.complete(id),/完整性/);assert.equal(f.store.media.list(p.id).length,0)
 const bad=Buffer.alloc(100),other=await upload(f,p.id,bad);await assert.rejects(f.store.media.complete(other),/文件头/)
 assert.throws(()=>f.store.media.start(p.id,{name:'../bad',mime:'audio/wav',bytes:100,digest:hash(bad)}),/参数/)
 }finally{f.close()}
})
test('unified v2 backs up music/video files and restores new copies, validates corruption before writes, preserves legacy JSON',async()=>{
 const f=fixture();try{
 const p=f.store.create({kind:'music',title:'music'}),v=f.store.create({kind:'video',title:'video'}),bytes=wav()
 for(const project of [p,v])await f.store.media.complete(await upload(f,project.id,bytes))
 assert.throws(()=>f.unified.create(),/v2/)
 const backup=await f.archive.create([]),bundle=readFileSync(f.archive.path(backup.id));assert.equal(bundle.length,backup.bytes)
 const id=await upload(f,p.id,bundle,'backup'),preview=await f.archive.preview(id)
 const result=await f.archive.restore(preview.token,['music','video'],'恢复为新副本')
 assert.equal(f.store.media.list(result.idMap[p.id]).length,1);assert.equal(f.store.media.references(hash(bytes)),4)
 assert.equal(f.store.project(p.id).title,p.title);assert.equal(f.store.project(v.id).title,v.title)
 await assert.rejects(f.archive.restore(preview.token,['music'],'恢复为新副本'),/预览/)
 const corrupt=Buffer.from(bundle);corrupt[corrupt.length-1]^=1
 const before=f.store.list('music').length,badId=await upload(f,p.id,corrupt,'backup');await assert.rejects(f.archive.preview(badId),/哈希/);assert.equal(f.store.list('music').length,before)
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.close()}
})
test('media HTTP supports offset queries, reference removal, and exact range download recovery',async()=>{
 const f=fixture(),server=createApp(f.story,undefined,undefined,f.store).listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}/api/studio`
 try{const p=f.store.create({kind:'music',title:'http'}),bytes=wav(),a=await f.store.media.complete(await upload(f,p.id,bytes))
 const r=await fetch(`${base}/media/${a.id}/content`,{headers:{Range:'bytes=500000-999999'}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(500000,1000000));assert.match(r.headers.get('content-range')!,/500000-999999/)
 const check=await fetch(`${base}/media/${a.id}/verify`);assert.equal(((await check.json()) as {references:number}).references,1)
 assert.equal((await fetch(`${base}/media/${a.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'})).status,204)
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.close()}
})

test('publication interrupted before SQL commit resumes from the validated content object',async()=>{
 const f=fixture();try{const p=f.store.create({kind:'music',title:'crash'}),bytes=wav(),id=await upload(f,p.id,bytes);renameSync(f.store.media.pendingPath(id),f.store.media.objectPath(hash(bytes)));const a=await f.store.media.complete(id);assert.equal(a.digest,hash(bytes));assert.equal(f.store.media.list(p.id).length,1)}finally{f.close()}
})
test('v2 restore SQL failure preserves every original project and media reference',async()=>{
 const f=fixture();try{const p=f.store.create({kind:'music',title:'rollback'}),bytes=wav();await f.store.media.complete(await upload(f,p.id,bytes));const backup=await f.archive.create([]),id=await upload(f,p.id,readFileSync(f.archive.path(backup.id)),'backup'),preview=await f.archive.preview(id);const before=f.db.prepare('SELECT * FROM studio_media_refs').all();f.db.exec("CREATE TRIGGER reject_copy BEFORE INSERT ON studio_projects BEGIN SELECT RAISE(ABORT,'injected'); END");await assert.rejects(f.archive.restore(preview.token,['music'],'恢复为新副本'),/injected/);assert.deepEqual(f.db.prepare('SELECT * FROM studio_media_refs').all(),before);assert.equal(f.store.list('music').length,1)}finally{f.close()}
})
