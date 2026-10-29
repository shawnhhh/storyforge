import {createHash,randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {Router} from 'express'
import type {RichTextNode} from '../../../../shared/contracts/novels.js'
import {parseComposition,type Composition} from '../../../../shared/video/composition.js'
import {HttpError,NovelStore} from '../novels/store.js'
import type {StudioStore} from '../studio/store.js'
import {resolveSource,validateMediaReferences} from './references.js'
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function prose(n:RichTextNode):string{return n.text??(n.type==='hardBreak'?'\n':(n.content??[]).map(prose).join(['doc','bulletList','orderedList'].includes(n.type??'')?'\n':''))}
interface Preview {kind:'chapter'|'shot';digest:string;expires:number;value:unknown;done?:unknown}
export class CompositionService {
 private previews=new Map<string,Preview>();private novels:NovelStore
 constructor(private story:DatabaseSync,private studio:StudioStore){this.novels=new NovelStore(story);studio.checkComposition=(c,old)=>this.checkStory(c,old)}
 private keep(kind:Preview['kind'],digest:string,value:unknown){for(const[k,v]of this.previews)if(v.expires<Date.now())this.previews.delete(k);if(this.previews.size>=100)throw new HttpError(429,'待确认预览过多');const token=randomUUID();this.previews.set(token,{kind,digest,expires:Date.now()+300000,value});return token}
 private token(token:unknown,kind:Preview['kind']){const p=typeof token==='string'?this.previews.get(token):undefined;if(!p||p.kind!==kind||p.expires<Date.now())throw new HttpError(409,'请重新预览后确认');return p}
 private checkStory(c:Composition,old?:Composition){
  const source=this.story.prepare('SELECT novel_id FROM chapters WHERE id=?').get(c.source.chapterId)
  if(!source&&(!old||old.source.chapterId!==c.source.chapterId||old.source.novelId!==c.source.novelId))throw new HttpError(400,'来源章节不存在，不能新建悬空引用')
  if(source&&source.novel_id!==c.source.novelId)throw new HttpError(400,'来源章节不属于该小说')
  const oldIds=new Set(old?[...old.scenes.flatMap(s=>s.characterIds),...old.shots.flatMap(s=>s.characterIds)]:[])
  for(const id of [...c.scenes.flatMap(s=>s.characterIds),...c.shots.flatMap(s=>s.characterIds)]){
   const r=this.story.prepare('SELECT novel_id FROM characters WHERE id=?').get(id)
   if(r?r.novel_id!==c.source.novelId:!oldIds.has(id))throw new HttpError(400,'角色引用必须来自来源小说；已删除的历史引用仅保留追溯')
  }
 }
 sources(){return this.novels.list().map(n=>({...n,chapters:this.novels.detail(n.id).chapters}))}
 characters(novelId:string){return this.story.prepare('SELECT id,name FROM characters WHERE novel_id=? ORDER BY created_at,id').all(novelId)}
 previewChapter(chapterId:string){
  const chapter=this.novels.chapter(chapterId),text=prose(chapter.content).trim(),parts=text.split(/\n+/).filter(Boolean)
  if(!text||text.length>12000||parts.length>20||parts.some(p=>p.length>2000))throw new HttpError(400,'Mock分镜支持1–20段，每段最多2000字，总计12000字；请先拆分章节，不会静默截断')
  const c:Composition={schema:1,source:{novelId:chapter.novelId,chapterId:chapter.id,chapterVersion:chapter.version,title:chapter.title,digest:hash(chapter)},scenes:[],shots:[],tracks:['video','music','voice','subtitle'].map(kind=>({id:randomUUID(),kind:kind as Composition['tracks'][number]['kind'],muted:false,clips:[]}))}
  parts.forEach((description,i)=>{const sceneId=randomUUID(),shotId=randomUUID();c.scenes.push({id:sceneId,title:`场景 ${i+1}`,setting:'',characterIds:[]});c.shots.push({id:shotId,sceneId,description,camera:'固定镜头',durationMs:3000,characterIds:[],taskIds:[]});c.tracks[3].clips.push({id:randomUUID(),shotId,startMs:i*3000,durationMs:3000,offsetMs:0,gain:1,text:description})})
  // Local deterministic Mock: no provider or external request.
  return{token:this.keep('chapter',hash(chapter),{chapterId,c}),composition:c,provider:'mock-local',policy:'确认后创建独立视频工程，不改写章节或已有工程'}
 }
 confirmChapter(token:unknown,confirmation:unknown){const p=this.token(token,'chapter');if(confirmation!=='创建分镜副本')throw new HttpError(400,'请明确确认创建副本');if(p.done)return p.done;const v=p.value as {chapterId:string;c:Composition};if(hash(this.novels.chapter(v.chapterId))!==p.digest)throw new HttpError(409,'来源章节已更改，请重新预览');p.done=this.studio.create({kind:'video',title:`${v.c.source.title.slice(0,160)} · 分镜 ${String(token).slice(0,8)}`,settings:{composition:JSON.stringify(v.c)}});return p.done}
 read(id:string){const p=this.studio.project(id);if(!p.settings.composition)throw new HttpError(400,'项目尚无章节分镜');return{project:p,composition:parseComposition(p.settings.composition)}}
 assets(){const result:({kind:'asset'|'media';id:string;name:string;mime:string;projectId:string})[]=[];for(const kind of ['music','video'] as const)for(const p of this.studio.list(kind)){for(const a of this.studio.assets(p.id))result.push({...a,kind:'asset'});for(const a of this.studio.media.list(p.id))result.push({kind:'media',id:String(a.id),projectId:p.id,name:String(a.name),mime:String(a.mime)})}return result}
 status(id:string){const {composition:c}=this.read(id);const resolved:Record<string,ReturnType<typeof resolveSource>>={};for(const t of c.tracks)for(const clip of t.clips)if(clip.source)try{resolved[clip.source.kind+':'+clip.source.id]=resolveSource(this.studio.backupDatabase,clip.source)}catch{resolved[clip.source.kind+':'+clip.source.id]={url:'',mime:'',status:'missing'}};const chapter=this.story.prepare('SELECT version FROM chapters WHERE id=?').get(c.source.chapterId);return{resolved,sourceStale:!chapter||chapter.version!==c.source.chapterVersion,tasks:c.shots.flatMap(s=>s.taskIds.map(id=>this.studio.jobs.task(id)))}}
 private roleContext(c:Composition,shotId:string){const shot=c.shots.find(s=>s.id===shotId);if(!shot)throw new HttpError(404,'分镜不存在');const scene=c.scenes.find(s=>s.id===shot.sceneId)!;return [...new Set([...scene.characterIds,...shot.characterIds])].sort().map(id=>this.story.prepare('SELECT id,name,version,fields FROM characters WHERE novel_id=? AND id=?').get(c.source.novelId,id))}
 previewShot(id:string,shotId:string){const {project,composition:c}=this.read(id),shot=c.shots.find(s=>s.id===shotId);if(!shot)throw new HttpError(404,'分镜不存在');const scene=c.scenes.find(s=>s.id===shot.sceneId)!;this.checkStory(c)
  const prompt=`单镜头 Mock 视频\n${scene.title}：${scene.setting}\n${shot.description}\n运镜：${shot.camera}\n时长：${shot.durationMs}ms\n角色：${JSON.stringify(this.roleContext(c,shotId))}`
  if(prompt.length>10000)throw new HttpError(400,'分镜与角色上下文超过10000字符，请精简后预览')
  return{token:this.keep('shot',hash([project,this.roleContext(c,shotId)]),{id,shotId,prompt}),prompt,provider:'mock',model:'mock-v1',warning:'仅本地Mock，无真实付费请求；确认后追加任务，不覆盖素材'}
 }
 confirmShot(token:unknown,confirmation:unknown){const p=this.token(token,'shot');if(confirmation!=='追加Mock视频任务')throw new HttpError(400,'请明确确认生成');if(p.done)return p.done;const v=p.value as {id:string;shotId:string;prompt:string},{project,composition:c}=this.read(v.id);if(hash([project,this.roleContext(c,v.shotId)])!==p.digest)throw new HttpError(409,'分镜已更改，请重新预览');this.checkStory(c)
  p.done=this.studio.jobs.submit({project,prompt:v.prompt},{provider:'mock',model:'mock-v1',idempotencyKey:String(token)},taskId=>{
   const shot=c.shots.find(s=>s.id===v.shotId)!;shot.taskIds.push(taskId)
   // Keep all prior results. User chooses when to place a task on the timeline.
   this.studio.save(project.id,{...project,settings:{...project.settings,composition:JSON.stringify(c)}})
  });return p.done
 }
 router(){const r=Router();r.get('/sources',(_q,s)=>s.json(this.sources()));r.get('/characters/:novelId',(q,s)=>s.json(this.characters(q.params.novelId)));r.get('/assets',(_q,s)=>s.json(this.assets()));r.post('/preview',(q,s)=>s.json(this.previewChapter(String(q.body.chapterId))));r.post('/confirm',(q,s)=>s.status(201).json(this.confirmChapter(q.body.token,q.body.confirmation)));r.get('/:id/status',(q,s)=>s.json(this.status(q.params.id)));r.post('/:id/shots/:shotId/preview',(q,s)=>s.json(this.previewShot(q.params.id,q.params.shotId)));r.post('/tasks/confirm',(q,s)=>s.status(202).json(this.confirmShot(q.body.token,q.body.confirmation)));return r}
}
export {validateMediaReferences}
