import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { MediaStore } from '../src/modules/studio/media.js'
import { defaultPolicy } from '../src/modules/studio/costs.js'
import { Music3Provider, music3Request, localMusic3Transport, type Music3Transport } from '../src/modules/studio/music/music3.js'
import { openDatabase } from '../src/db/database.js'
import { BackupService } from '../src/modules/backups/service.js'
import { UnifiedBackupService } from '../src/modules/backups/unified.js'
import { MediaArchive } from '../src/modules/backups/media-archive.js'
import { verifyMusic3Wave } from '../src/modules/studio/music/wave.js'
function wav(){const b=Buffer.alloc(800044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b}
function fixture(send:Music3Transport){const dir=mkdtempSync(join(tmpdir(),'sf-music3-')),db=openStudioDatabase(dir),media=new MediaStore(db),provider=new Music3Provider(db,media,send),store=new StudioStore(db,undefined,[provider],{...defaultPolicy,models:[...defaultPolicy.models,{id:'minimax_ttm',provider:provider.id,rateMicrosPerSecond:1,maxSeconds:300,maxPrompt:10000,billingSeconds:300,kinds:['music'],virtual:true}]});const p=store.create({kind:'music',title:'fixture'});const project=store.save(p.id,{...p,content:'[Verse]\n测试歌词',settings:{genre:'jazz',mood:'calm',tempo:90}});return{dir,db,media,provider,store,project,close(){store.jobs.stop();db.close();rmSync(dir,{recursive:true,force:true})}}}
async function finish(f:ReturnType<typeof fixture>){for(let i=0;i<100;i++){f.db.prepare('UPDATE studio_jobs SET due=0').run();await f.store.jobs.tick();if(['completed','failed'].includes(f.store.tasks(f.project.id)[0].status))return;await new Promise(r=>setTimeout(r,10))}assert.fail('task did not finish')}
test('official request maps lyrics and style, instrumental prompt control and unsupported parameters explicitly',()=>{const f=fixture(async()=>{throw Error('unused')});try{const request=music3Request({project:f.project,prompt:'song'});assert.equal(request.model,'minimax_ttm');assert.equal(request.input,f.project.content);assert.equal(request.stream,false);assert.equal(request.response_format,'wav');assert.match(request.instructions,/jazz/);assert.equal(request.max_new_tokens,9000);assert.equal(music3Request({project:{...f.project,content:'',settings:{instrumental:true}},prompt:'piano'}).input,'[Instrumental]');assert.throws(()=>music3Request({project:{...f.project,settings:{durationSeconds:30}},prompt:'x'}),/时长/);assert.throws(()=>music3Request({project:{...f.project,settings:{instrumental:true}},prompt:'x'}),/清空歌词/);assert.throws(()=>localMusic3Transport('https://evil.example/v1/audio/speech'));assert.deepEqual(f.provider.capabilities,{remoteQuery:false,remoteCancel:false,remoteIdempotency:false,webhook:false,localCancellation:true})}finally{f.close()}})
test('durable wrapper dispatches once, imports large WAV, settles once and backs up result links as copies',async()=>{let calls=0;const f=fixture(async body=>{calls++;assert.equal(body.stream,false);return{status:200,mime:'audio/wav',body:(async function*(){yield wav()})()}});try{const input={project:f.project,prompt:'song'},quote=f.store.costs.quote(input,f.provider.id,'minimax_ttm'),body={version:f.project.version,prompt:'song',provider:f.provider.id,model:'minimax_ttm',confirmation:quote.token,idempotencyKey:'music3-contract-123'};const task=await f.store.generate(f.project.id,body);assert.equal((await f.store.generate(f.project.id,body)).id,task.id);await finish(f);assert.equal(calls,1);const done=f.store.tasks(f.project.id)[0];assert.equal(done.status,'completed');assert.ok(done.mediaId);assert.equal(done.assetId,null);const asset=f.media.ref(done.mediaId!);assert.deepEqual(readFileSync(await f.media.verify(String(asset.digest))),wav());assert.equal(f.store.costs.month().reservedMicros,300);assert.equal(f.store.costs.month().spentMicros,300);assert.equal(f.store.project(f.project.id).content,f.project.content)
 const story=openDatabase(f.dir),backup=new BackupService(story,join(f.dir,'backups')),archives=new MediaArchive(f.media,new UnifiedBackupService(story,f.db,backup));try{const bundle=await archives.create([]),b=readFileSync(archives.path(bundle.id)),hash=(await import('node:crypto')).createHash('sha256').update(b).digest('hex'),u=f.media.start(f.project.id,{name:'backup.sfm',mime:'application/octet-stream',bytes:b.length,digest:hash},'backup');for(let offset=0;offset<b.length;offset+=524288)f.media.chunk(u.id,{offset,data:b.subarray(offset,offset+524288).toString('base64')});const preview=await archives.preview(u.id),restored=await archives.restore(preview.token,['music'],'恢复为新副本');assert.ok(f.store.tasks(restored.idMap[f.project.id])[0].mediaId);assert.equal(calls,1)}finally{story.close()}
 }finally{f.close()}})
test('restart after dispatch is uncertain and never automatically reissues a non-idempotent request',async()=>{let calls=0;const f=fixture(async()=>{calls++;throw Error('connection lost with secret')});try{const input={project:f.project,prompt:'song'},id=await f.provider.submit(input,'minimax_ttm','uncertain-123');f.db.prepare("UPDATE studio_music_calls SET state='dispatched' WHERE key=?").run(id);const recovered=new Music3Provider(f.db,f.media,async()=>{calls++;throw Error('must not call')});assert.equal(await recovered.lookup(id),id);const state=await recovered.poll(id,input);assert.equal(state.status,'failed');assert.equal(calls,0);assert.ok(!JSON.stringify(state).includes('secret'))}finally{f.close()}})
test('local cancellation fences a late WAV without claiming remote cancellation or publishing media',async()=>{let release!:()=>void,started!:()=>void;const began=new Promise<void>(r=>{started=r}),held=new Promise<void>(r=>{release=r});const f=fixture(async()=>{started();await held;return{status:200,mime:'audio/wav',body:(async function*(){yield wav()})()}});try{const input={project:f.project,prompt:'song'},id=await f.provider.submit(input,'minimax_ttm','cancel-123');await f.provider.poll(id,input);await began;await f.provider.cancel(id);release();await new Promise(r=>setTimeout(r,30));assert.equal((await f.provider.poll(id,input)).status,'failed');assert.equal(f.media.list(f.project.id).length,0)}finally{release();f.close()}})
test('upstream failures do not leak secrets, auto retry, or release uncertain reserved cost',async()=>{let calls=0;const f=fixture(async()=>{calls++;throw Error('api_key=fixture-secret')});try{const quote=f.store.costs.quote({project:f.project,prompt:'song'},f.provider.id,'minimax_ttm'),body={version:f.project.version,prompt:'song',provider:f.provider.id,model:'minimax_ttm',confirmation:quote.token,idempotencyKey:'failed-music3-123'},task=await f.store.generate(f.project.id,body);await finish(f);assert.equal(calls,1);assert.equal(f.store.tasks(f.project.id)[0].status,'failed');assert.ok(!JSON.stringify(f.store.tasks(f.project.id)).includes('fixture-secret'));assert.equal((await f.store.generate(f.project.id,body)).id,task.id);assert.equal(calls,1);assert.equal(f.store.costs.month().reservedMicros,300);assert.equal(f.store.costs.month().spentMicros,0)}finally{f.close()}})

test('Music3 WAV validates chunk boundaries, padding and PCM frames without reading the payload',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sf-wave-')),path=join(dir,'result.wav')
 try{
  const original=wav(),withMetadata=Buffer.concat([original.subarray(0,36),Buffer.from('JUNK'),Buffer.from([1,0,0,0,42,0]),original.subarray(36)])
  withMetadata.writeUInt32LE(withMetadata.length-8,4)
  writeFileSync(path,withMetadata);assert.doesNotThrow(()=>verifyMusic3Wave(path))
  const stereo=Buffer.from(original);stereo.writeUInt16LE(2,22);stereo.writeUInt32LE(32000,24);stereo.writeUInt32LE(128000,28);stereo.writeUInt16LE(4,32)
  writeFileSync(path,stereo);assert.doesNotThrow(()=>verifyMusic3Wave(path))
  const malformed=[original.subarray(0,44),original.subarray(0,original.length-1)]
  const chunk=Buffer.from(original);chunk.writeUInt32LE(0xffffffff,40);malformed.push(chunk)
  const frame=Buffer.from(original);frame.writeUInt16LE(3,32);malformed.push(frame)
  const codec=Buffer.from(original);codec.writeUInt16LE(3,20);malformed.push(codec)
  const noData=Buffer.from(original);noData.write('JUNK',36);malformed.push(noData)
  const trailing=Buffer.concat([original,Buffer.from([0])]);trailing.writeUInt32LE(trailing.length-8,4);malformed.push(trailing)
  const tinyChunks=Buffer.alloc(4097*8);for(let i=0;i<4097;i++)tinyChunks.write('JUNK',i*8)
  const excessive=Buffer.concat([original,tinyChunks]);excessive.writeUInt32LE(excessive.length-8,4);malformed.push(excessive)
  for(const bytes of malformed){writeFileSync(path,bytes);assert.throws(()=>verifyMusic3Wave(path),/invalid-music3-wave/)}
 }finally{rmSync(dir,{recursive:true,force:true})}
})

for(const failure of ['truncated-wave','source-error'] as const)test(`${failure} fails without media publication, settlement, duplicate dispatch or temporary file leaks`,async()=>{
 let calls=0
 const f=fixture(async()=>{calls++;return{status:200,mime:'audio/wav',body:(async function*(){yield wav().subarray(0,44);if(failure==='source-error')throw Error('api_key=fixture-stream-secret')})()}})
 try{
  const quote=f.store.costs.quote({project:f.project,prompt:'song'},f.provider.id,'minimax_ttm')
  const body={version:f.project.version,prompt:'song',provider:f.provider.id,model:'minimax_ttm',confirmation:quote.token,idempotencyKey:`broken-${failure}-123`}
  const task=await f.store.generate(f.project.id,body);await finish(f)
  assert.equal(f.store.jobs.task(task.id).status,'failed')
  assert.ok(!JSON.stringify(f.store.jobs.task(task.id)).includes('fixture-stream-secret'))
  assert.equal(f.media.list(f.project.id).length,0)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM studio_uploads').get()!.n,0)
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM studio_task_media').get()!.n,0)
  assert.deepEqual(readdirSync(join(f.media.root,'pending')),[])
  assert.deepEqual(readdirSync(join(f.media.root,'objects')),[])
  assert.equal(f.store.costs.month().reservedMicros,300);assert.equal(f.store.costs.month().spentMicros,0)
  assert.equal((await f.store.generate(f.project.id,body)).id,task.id);assert.equal(calls,1)
  assert.equal(f.store.project(f.project.id).content,f.project.content)
 }finally{f.close()}
})
