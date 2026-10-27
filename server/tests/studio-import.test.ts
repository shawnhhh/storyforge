import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
function fixture() { const dir = mkdtempSync(join(tmpdir(),'sf-import-')); const db = openStudioDatabase(dir); const store = new StudioStore(db); return { db, store, importer: store.importer(), close() { db.close(); rmSync(dir,{recursive:true,force:true}) } } }
for (const kind of ['music','video'] as const) test(`${kind} roundtrip restores history and assets as new IDs; duplicate and interrupted restore preserve original`, () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind, title: '作品' })
    const saved = f.store.save(p.id,{ ...p,content:'正文',settings:{} })
    f.store.addAsset(p.id,{name:'song.wav',mime:'audio/wav',data:'YWJj'})
    const archive = f.store.export(p.id), before = JSON.stringify(archive), preview = f.importer.prepare(archive)
    const result = f.importer.restore(archive,preview.token,'作为新项目导入')
    assert.notEqual(result.id,p.id); assert.equal(f.store.project(result.id).content,saved.content)
    assert.equal(f.store.history(result.id).length,2); assert.equal(f.store.export(result.id).assets[0].data,'YWJj')
    assert.notEqual(f.store.assets(result.id)[0].id,archive.assets[0].id)
    assert.equal(JSON.stringify(f.store.export(p.id)),before)
    assert.throws(()=>f.importer.prepare(archive),/已导入/)
    assert.throws(()=>f.importer.restore(archive,preview.token,'作为新项目导入'),/预览/)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
  } finally { f.close() }
})
test('corrupt/version/path/missing asset/history validation never changes database', () => {
 const f=fixture(); try {
 const p=f.store.create({kind:'music',title:'原作'}); const original=f.store.export(p.id)
 const broken=structuredClone(original); broken.project.content='tampered'; assert.throws(()=>f.importer.prepare(broken),/SHA/)
 for(const mutate of [
 (a: typeof original)=>{a.schema=99},
 (a: typeof original)=>{a.history=[]},
 (a: typeof original)=>{a.assets=[{id:'asset',projectId:p.id,name:'../evil.wav',mime:'audio/wav',bytes:3,data:'YWJj',createdAt:p.createdAt}]},
 (a: typeof original)=>{a.tasks=[{id:'task',projectId:p.id,provider:'mock',status:'completed',progress:100,prompt:'x',assetId:'missing',error:null,createdAt:p.createdAt}]}
 ]) { const a=structuredClone(original); mutate(a); const {sha256,...legacy}=a; void sha256; assert.throws(()=>f.importer.prepare(legacy)) }
 assert.deepEqual(f.store.export(p.id),original); assert.equal(f.store.list('music').length,1)
 } finally { f.close() }
})
test('SQLite failure rolls back all imported rows and receipt, retry after new preview succeeds',()=>{
 const f=fixture(); try {
 const p=f.store.create({kind:'video',title:'原作'}); const a=f.store.export(p.id), preview=f.importer.prepare(a)
 f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON studio_imports BEGIN SELECT RAISE(ABORT,'disk interrupted'); END")
 assert.throws(()=>f.importer.restore(a,preview.token,'作为新项目导入'),/disk interrupted/)
 assert.equal(f.store.list('video').length,1); assert.equal(f.db.prepare('SELECT count(*) n FROM studio_versions').get()!.n,1)
 f.db.exec('DROP TRIGGER fail_import'); const retry=f.importer.prepare(a); f.importer.restore(a,retry.token,'作为新项目导入')
 assert.equal(f.store.list('video').length,2)
 } finally { f.close() }
})
test('large project with 100 versions and 12MB media recovers exactly',()=>{
 const f=fixture(); try {
 let p=f.store.create({kind:'music',title:'大型项目'})
 for(let i=1;i<100;i++) p=f.store.save(p.id,{...p,content:'歌词'.repeat(1000)})
 for(let i=0;i<20;i++) f.store.addAsset(p.id,{name:`audio${i}.wav`,mime:'audio/wav',data:Buffer.alloc(600000,i).toString('base64')})
 const a=f.store.export(p.id), preview=f.importer.prepare(a), r=f.importer.restore(a,preview.token,'作为新项目导入')
 assert.equal(f.store.history(r.id).length,100); assert.deepEqual(f.store.export(r.id).assets.map(x=>x.data).sort(),a.assets.map(x=>x.data).sort())
 } finally { f.close() }
})
