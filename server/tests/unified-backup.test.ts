import type { RichTextDocument } from '../../shared/contracts/novels.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { UnifiedBackupService } from '../src/modules/backups/unified.js'
function fixture(){const dir=mkdtempSync(join(tmpdir(),'sf-unified-test-')),db=openDatabase(dir),studio=openStudioDatabase(dir),backups=new BackupService(db,join(dir,'backups')),store=new StudioStore(studio),novels=new NovelStore(db);return{db,studio,store,novels,service:new UnifiedBackupService(db,studio,backups),close(){if(studio.isOpen)studio.close();if(db.isOpen)db.close();rmSync(dir,{recursive:true,force:true})}}}
test('unified WAL snapshot and selective restore creates copies; modules remain independent and repeated restore is rejected',()=>{
 const f=fixture();try{
 const n=f.novels.create('原小说','世界'),m=f.store.create({kind:'music',title:'原音乐'}),v=f.store.create({kind:'video',title:'原视频'})
 f.store.save(m.id,{...m,content:'歌词',settings:{}});f.store.addAsset(m.id,{name:'audio.wav',mime:'audio/wav',data:'YWJj'})
 const archive=f.service.create([]),beforeMusic=f.store.export(m.id),beforeVideo=f.store.export(v.id),beforeNovel=f.novels.list()
 const preview=f.service.prepare(archive)
 f.service.restore(archive,preview.token,['music'],'恢复为新副本')
 assert.equal(f.store.list('music').length,2);assert.deepEqual(f.store.export(m.id),beforeMusic);assert.deepEqual(f.store.export(v.id),beforeVideo);assert.deepEqual(f.novels.list(),beforeNovel)
 const again=f.service.prepare(archive);assert.throws(()=>f.service.restore(archive,again.token,['music'],'恢复为新副本'),/已从此备份恢复/)
 const story=f.service.prepare(archive),result=f.service.restore(archive,story.token,['story'],'恢复为新副本')
 assert.notEqual(result.idMap[n.id],n.id);assert.equal(f.novels.list().length,2)
 assert.equal(f.db.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal');assert.equal(f.studio.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal')
 }finally{f.close()}
})
test('full restore failure rolls back both SQLite files, success restores all modules and history',()=>{
 const f=fixture();try{
 f.novels.create('小说','');let m=f.store.create({kind:'music',title:'音乐'});m=f.store.save(m.id,{...m,content:'第二版',settings:{}});f.store.create({kind:'video',title:'视频'})
 const archive=f.service.create([]),preview=f.service.prepare(archive)
 assert.throws(()=>f.service.restore(archive,preview.token,['story','music','video'],'恢复为新副本',()=>{throw new Error('database interrupted')}),/interrupted/)
 assert.equal(f.novels.list().length,1);assert.equal(f.store.list('music').length,1);assert.equal(f.store.list('video').length,1);assert.equal(f.studio.prepare('SELECT count(*) n FROM unified_restores').get()!.n,0)
 const retry=f.service.prepare(archive),result=f.service.restore(archive,retry.token,['story','music','video'],'恢复为新副本')
 assert.equal(f.novels.list().length,2);assert.equal(f.store.history(result.idMap[m.id]).length,2)
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(f.studio.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.close()}
})
test('corrupt backup and missing assets never alter original data; preview is bound to archive',()=>{
 const f=fixture();try{
 const p=f.store.create({kind:'video',title:'视频'}),archive=f.service.create([]),bad=structuredClone(archive)
 bad.studio.studio_projects[0].title='tampered';assert.throws(()=>f.service.prepare(bad),/完整性/)
 const preview=f.service.prepare(archive);assert.throws(()=>f.service.restore(archive,preview.token,['video'],'yes'),/完整性/)
 assert.equal(f.store.project(p.id).title,'视频');assert.equal(f.store.list('video').length,1)
 }finally{f.close()}
})

test('malformed relational data with recomputed checksum is rejected, draft inbox is isolated and selective',()=>{
 const f=fixture();try{
 const p=f.store.create({kind:'music',title:'关联素材'});f.store.addAsset(p.id,{name:'audio.wav',mime:'audio/wav',data:'YWJj'})
 f.studio.prepare("INSERT INTO studio_tasks VALUES('task',?,'mock','completed',100,'mock',?,NULL,?)").run(p.id,f.store.assets(p.id)[0].id,p.createdAt)
 const archive=f.service.create([{module:'story',value:{content:'独立草稿'}}]),bad=structuredClone(archive)
 bad.studio.studio_assets=[]
 const {sha256,...payload}=bad;void sha256
 bad.sha256=createHash('sha256').update(JSON.stringify(payload)).digest('hex')
 assert.throws(()=>f.service.prepare(bad));assert.equal(f.store.assets(p.id).length,1)
 const preview=f.service.prepare(archive);f.service.restore(archive,preview.token,['music'],'恢复为新副本');assert.equal(f.service.recoveredDrafts().length,0)
 const draft=f.service.prepare(archive);f.service.restore(archive,draft.token,['drafts'],'恢复为新副本');assert.equal(f.service.recoveredDrafts().length,1)
 }finally{f.close()}
})
test('large unified archive retains exact media bytes and 100 historical revisions',()=>{
 const f=fixture();try{
 let p=f.store.create({kind:'video',title:'大型工程'})
 for(let i=1;i<100;i++)p=f.store.save(p.id,{...p,content:'剧本'.repeat(1000),settings:{}})
 for(let i=0;i<20;i++)f.store.addAsset(p.id,{name:`part${i}.webm`,mime:'video/webm',data:Buffer.alloc(600000,i).toString('base64')})
 const archive=f.service.create([]),preview=f.service.prepare(archive),r=f.service.restore(archive,preview.token,['video'],'恢复为新副本')
 assert.equal(f.store.history(r.idMap[p.id]).length,100)
 assert.deepEqual(f.store.export(r.idMap[p.id]).assets.map(x=>x.data).sort(),f.store.export(p.id).assets.map(x=>x.data).sort())
 }finally{f.close()}
})
test('process interruption before cross-file commit recovers both files without partial works or receipts',()=>{
 const f=fixture();try{
 f.novels.create('原小说','');f.store.create({kind:'music',title:'原音乐'})
 const archive=f.service.create([]),dir=mkdtempSync(join(tmpdir(),'sf-interrupt-')),file=join(dir,'archive.json')
 try{
 writeFileSync(file,JSON.stringify(archive))
 const storyFile=String(f.db.prepare('PRAGMA database_list').get()!.file),studioFile=String(f.studio.prepare('PRAGMA database_list').get()!.file)
 const script=`import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {BackupService} from './server/src/modules/backups/service.ts';import {UnifiedBackupService} from './server/src/modules/backups/unified.ts';const db=new DatabaseSync(process.argv[1]);const studio=new DatabaseSync(process.argv[2]);db.exec('PRAGMA foreign_keys=ON');studio.exec('PRAGMA foreign_keys=ON');const s=new UnifiedBackupService(db,studio,new BackupService(db,process.argv[3]));const a=JSON.parse(readFileSync(process.argv[4],'utf8'));s.restore(a,s.prepare(a).token,['story','music'],'恢复为新副本',()=>process.exit(77));`
 f.db.close();f.studio.close()
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script,storyFile,studioFile,join(dir,'backups'),file],{env:{...process.env,TMPDIR:dir},encoding:'utf8'})
 assert.equal(result.status,77,result.stderr)
 const check=new DatabaseSync(storyFile),media=new DatabaseSync(studioFile)
 try{assert.equal(check.prepare('SELECT count(*) n FROM novels').get()!.n,1);assert.equal(media.prepare('SELECT count(*) n FROM studio_projects').get()!.n,1);assert.equal(media.prepare('SELECT count(*) n FROM unified_restores').get()!.n,0)
 assert.equal(check.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(media.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok')}finally{check.close();media.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
 }finally{f.close()}
})
test('concurrent external SQLite writer blocks recovery safely and WAL mode is retained',()=>{
 const f=fixture();let other:DatabaseSync|undefined;try{
 f.novels.create('原作','');f.store.create({kind:'music',title:'原音乐'})
 const a=f.service.create([]),preview=f.service.prepare(a)
 other=new DatabaseSync(String(f.studio.prepare('PRAGMA database_list').get()!.file));other.exec('BEGIN IMMEDIATE')
 f.studio.exec('PRAGMA busy_timeout=20');f.db.exec('PRAGMA busy_timeout=20')
 assert.throws(()=>f.service.restore(a,preview.token,['story','music'],'恢复为新副本'))
 other.exec('ROLLBACK');assert.equal(f.novels.list().length,1);assert.equal(f.store.list('music').length,1)
 assert.equal(f.db.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal');assert.equal(f.studio.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal')
 }finally{other?.close();f.close()}
})
test('story graph restores chapters, world, character links, outlines and prose with remapped references',()=>{
 const f=fixture();try{
 const n=f.novels.create('关联小说','说明'),chapter=f.novels.createChapter(n.id,n.version,'第一章').chapter
 f.novels.saveChapter(chapter.id,chapter.version,'第一章',{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'完整正文'}]}]})
 const bible=new StoryBibleStore(f.db),world=bible.saveWorld(n.id,{...newWorld(),name:'港口'}),character=bible.saveCharacter(n.id,{...newCharacter(),name:'主角',worldIds:[world.id]})
 const plan=new PlanningStore(f.db),data=emptyPlanning();data.outlines=[{id:'outline',title:'章节纲要',content:'关联港口',kind:'chapter',parentId:null,chapterIds:[chapter.id],characterIds:[character.id],worldIds:[world.id]}];plan.save(n.id,0,data)
 const a=f.service.create([]),result=f.service.restore(a,f.service.prepare(a).token,['story'],'恢复为新副本'),copy=result.idMap[n.id]
 assert.equal(f.novels.chapter(result.idMap[chapter.id]).content.content![0].content![0].text,'完整正文')
 const materials=bible.list(copy);assert.deepEqual(materials.characters[0].worldIds,[result.idMap[world.id]])
 const planning=plan.read(copy);assert.deepEqual(planning.outlines[0].chapterIds,[result.idMap[chapter.id]]);assert.deepEqual(planning.outlines[0].characterIds,[result.idMap[character.id]])
 assert.equal(f.novels.chapter(chapter.id).content.content![0].content![0].text,'完整正文')
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.close()}
})

test('restore remaps semantic references while preserving enum and prose values equal to record IDs',()=>{
 const f=fixture();try{
 const plan=new PlanningStore(f.db),originals:{novelId:string;chapterId:string;prose:RichTextDocument}[]=[]
 for(let i=0;i<2;i++){
  const n=f.novels.create('main','subplot'),c=f.novels.createChapter(n.id,n.version,'main').chapter
  const prose={type:'doc' as const,content:[{type:'paragraph',content:[{type:'text',text:'main'}]},{type:'paragraph',content:[{type:'text',text:'{"id":"main","kind":"subplot"}'}]}]}
  f.novels.saveChapter(c.id,c.version,'main',prose)
  const data=emptyPlanning()
  data.plotlines=[{id:'main',title:'subplot',content:'main',kind:'main'},{id:'subplot',title:'main',content:'subplot',kind:'subplot'}]
  data.cards=[{id:'card-'+i,title:'main',content:'{"id":"main"}',summary:'subplot',status:'planned',plotlineId:'main',storyTime:'main',timeOrder:1,chapterIds:[c.id]}]
  plan.save(n.id,0,data);originals.push({novelId:n.id,chapterId:c.id,prose})
 }
 const music=f.store.create({kind:'music',title:'main'}),savedMusic=f.store.save(music.id,{...music,content:'main',settings:{style:'main',prompt:'{"id":"main"}'}})
 const recoveredPayload={module:'story',value:{novelId:originals[0].novelId,chapterId:originals[0].chapterId,content:'main',note:'{"id":"main"}'}}
 f.studio.prepare('INSERT INTO unified_drafts VALUES(?,?)').run('draft-reference',JSON.stringify(recoveredPayload))
 const archive=f.service.create([]),r=f.service.restore(archive,f.service.prepare(archive).token,['story','music','drafts'],'恢复为新副本')
 for(const original of originals){
  const copy=plan.read(r.idMap[original.novelId])
  assert.deepEqual(copy.plotlines.map(line=>line.kind),['main','subplot'])
  assert.deepEqual(copy.plotlines.map(line=>line.content),['main','subplot'])
  assert.deepEqual(copy.plotlines.map(line=>line.title),['subplot','main'])
  assert.equal(copy.cards[0].plotlineId,r.idMap.main)
  assert.deepEqual(copy.cards[0].chapterIds,[r.idMap[original.chapterId]])
  assert.equal(copy.cards[0].content,'{"id":"main"}');assert.equal(copy.cards[0].summary,'subplot');assert.equal(copy.cards[0].storyTime,'main')
  assert.deepEqual(f.novels.chapter(r.idMap[original.chapterId]).content,original.prose)
  assert.deepEqual(f.novels.chapter(original.chapterId).content,original.prose)
 }
 const restoredDraft=f.service.recoveredDrafts().map(row=>JSON.parse(String(row.payload))).find(draft=>draft.value.novelId===r.idMap[originals[0].novelId])
 assert.ok(restoredDraft);assert.equal(restoredDraft.value.chapterId,r.idMap[originals[0].chapterId]);assert.equal(restoredDraft.value.content,'main');assert.equal(restoredDraft.value.note,recoveredPayload.value.note)
 assert.equal(f.store.project(r.idMap[music.id]).content,savedMusic.content)
 assert.deepEqual(f.store.project(r.idMap[music.id]).settings,savedMusic.settings)
 const next=f.service.create([]);assert.doesNotThrow(()=>f.service.prepare(next))
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
 }finally{f.close()}
})
