import type {DatabaseSync} from 'node:sqlite'
import {parseComposition,type ClipSource,type Composition} from '../../../../shared/video/composition.js'
import {HttpError} from '../novels/store.js'
/** References are looked up by ID only: no user URLs or filesystem paths are executable. */
export function resolveSource(db:DatabaseSync,s:ClipSource,prefix=''):{url:string;mime:string;status:string} {
 if(s.kind==='task'){
  const t=db.prepare(`SELECT t.*,m.mediaId FROM ${prefix}studio_tasks t LEFT JOIN ${prefix}studio_task_media m ON t.id=m.taskId WHERE t.id=?`).get(s.id)
  if(!t)throw new HttpError(400,'时间线生成任务不存在')
  if(t.assetId)return resolveSource(db,{kind:'asset',id:String(t.assetId)},prefix)
  if(t.mediaId)return resolveSource(db,{kind:'media',id:String(t.mediaId)},prefix)
  const p=db.prepare(`SELECT kind FROM ${prefix}studio_projects WHERE id=?`).get(String(t.projectId))
  return{url:'',mime:p?.kind==='video'?'video/webm':'audio/wav',status:String(t.status)}
 }
 const row=db.prepare(`SELECT mime FROM ${prefix}${s.kind==='asset'?'studio_assets':'studio_media_refs'} WHERE id=?`).get(s.id)
 if(!row)throw new HttpError(400,'时间线素材不存在；请一并恢复关联模块')
 return{url:`/api/studio/${s.kind==='asset'?'assets':'media'}/${s.id}/content`,mime:String(row.mime),status:'completed'}
}
export function validateMediaReferences(db:DatabaseSync,c:Composition,prefix=''){
 for(const shot of c.shots)for(const id of shot.taskIds){const r=resolveSource(db,{kind:'task',id},prefix);if(!r.mime.startsWith('video/'))throw new HttpError(400,'分镜必须关联视频任务')}
 for(const t of c.tracks)for(const clip of t.clips)if(clip.source){const r=resolveSource(db,clip.source,prefix);if(!r.mime.startsWith(t.kind==='video'?'video/':'audio/'))throw new HttpError(400,'轨道与素材类型不匹配')}
}
export function validateCompositions(db:DatabaseSync,prefix='',projectIds?:string[]){
 for(const p of db.prepare(`SELECT id,settings FROM ${prefix}studio_projects WHERE kind='video' UNION ALL SELECT projectId AS id,settings FROM ${prefix}studio_versions`).all()){
  if(projectIds&&!projectIds.includes(String(p.id)))continue
  const settings=JSON.parse(String(p.settings));if(settings.composition)validateMediaReferences(db,parseComposition(settings.composition),prefix)
 }
}
