import { createHash, randomUUID } from 'node:crypto'
import { request } from 'node:https'
import { renameSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { GenerationInput } from '../../../../../shared/contracts/studio.js'
import { HttpError } from '../../novels/store.js'
import { RetryableProviderError, type AsyncCreativeProvider, type RemoteState } from '../jobs.js'
import { MediaStore } from '../media.js'
import type { ServerKeyVault } from '../secrets.js'
import { SafeMediaDownloader } from '../download.js'
import { VideoQuarantine } from './quarantine.js'
export const hailuoCapabilities={remoteQuery:true,remoteCancel:false,remoteIdempotency:false,webhook:false,localCancellation:true,queuedRemoteCancel:false} as const
export function hailuoRequest(input:GenerationInput,model:string){
 const s=input.project.settings
 if(input.project.kind!=='video'||model!=='MiniMax-H3'||!input.prompt.trim()||input.prompt.length>2000)throw new HttpError(400,'H3仅支持单镜头视频及最多2000字符提示词')
 const duration=s.durationSeconds,resolution=s.resolution??'768P',image=s.firstFrameUrl
 if(typeof duration!=='number'||!Number.isInteger(duration)||duration<4||duration>15||!['768P','2K'].includes(String(resolution)))throw new HttpError(400,'H3时长为4–15秒，分辨率为768P或2K')
 // This release deliberately exposes only T2V / one first frame, not reference-video, audio, editing or regeneration.
 for(const k of ['lastFrameUrl','referenceVideoUrl','referenceAudioUrl','callback_url'])if(s[k]!==undefined)throw new HttpError(400,'本适配器不支持此多模态参数')
 const content:({type:'text';text:string}|{type:'image_url';image_url:{url:string};role:'first_frame'})[]=[{type:'text',text:input.prompt}]
 if(image!==undefined){if(typeof image!=='string'||image.length>8192)throw new HttpError(400,'首帧URL无效');let u:URL;try{u=new URL(image)}catch{throw new HttpError(400,'首帧URL无效')}if(u.protocol!=='https:'||u.username||u.password||u.hash)throw new HttpError(400,'首帧必须是明确授权的HTTPS素材URL');content.push({type:'image_url',image_url:{url:image},role:'first_frame'})}
 const ratio=image?'adaptive':s.aspectRatio??'16:9'
 if(!['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'].includes(String(ratio))||(!image&&ratio==='adaptive'))throw new HttpError(400,'H3画面比例无效')
 return{model,content,resolution,duration,ratio}
}
export type HailuoTransport=(method:'POST'|'GET'|'DELETE',path:string,body:unknown,signal:AbortSignal)=>Promise<unknown>
/** Fixed official control plane, no caller supplied endpoints, no redirects, bounded JSON and no automatic POST retries. */
export function officialHailuoTransport(vault:ServerKeyVault):HailuoTransport{return async(method,path,body,signal)=>{
 if(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)throw Error('hailuo-proxy-transport-not-configured')
 const key=vault.get('minimax-hailuo');if(!key)throw Error('hailuo-key-unconfigured')
 if(!/^\/v2\/(?:video_generation(?:\/[\w-]+)?|query\/video_generation\/[\w-]+)$/.test(path))throw Error('invalid-hailuo-path')
 return new Promise((resolve,reject)=>{const req=request(new URL(path,'https://api.minimax.io'),{method,signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}},res=>{let bytes=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024){res.destroy();reject(Error('hailuo-response-size'));return}chunks.push(chunk)});res.on('error',()=>reject(Error('hailuo-transport')));res.on('end',()=>{if(res.statusCode!==200){reject(method==='GET'&&(res.statusCode===429||Number(res.statusCode)>=500)?new RetryableProviderError('hailuo-query-retry'):Error('hailuo-api-rejected'));return}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('hailuo-invalid-json'))}})});req.on('error',()=>reject(method==='GET'?new RetryableProviderError('hailuo-query-unavailable'):Error('hailuo-submit-unknown')));req.end(body===undefined?undefined:JSON.stringify(body))})
}}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('hailuo-protocol');return value as Record<string,unknown>}
export class HailuoProvider implements AsyncCreativeProvider {
 readonly id='minimax-hailuo'
 readonly models=[{id:'MiniMax-H3',kinds:['video' as const],maxPrompt:2000}]
 readonly capabilities=hailuoCapabilities
 private active=new Map<string,AbortController>();private stopped=false
 constructor(private db:DatabaseSync,private media:MediaStore,private send:HailuoTransport,private quarantine=new VideoQuarantine(new SafeMediaDownloader(['video-product.cdn.minimax.io','cdn.hailuoai.com']))){
  db.exec(`CREATE TABLE IF NOT EXISTS studio_hailuo_calls(key TEXT PRIMARY KEY,digest TEXT NOT NULL,remoteId TEXT,state TEXT NOT NULL,path TEXT NOT NULL,uploadId TEXT,error TEXT);`)
 }
 validate(input:GenerationInput,model:string){hailuoRequest(input,model)}
 async lookup(key:string){const row=this.db.prepare('SELECT * FROM studio_hailuo_calls WHERE key=?').get(key);if(!row)return null;if(!row.remoteId)throw Error('hailuo-submission-unknown-no-auto-retry');return String(row.remoteId)}
 async submit(input:GenerationInput,model:string,key:string,signal:AbortSignal){
  const body=hailuoRequest(input,model),digest=createHash('sha256').update(JSON.stringify(body)).digest('hex'),old=this.db.prepare('SELECT digest FROM studio_hailuo_calls WHERE key=?').get(key)
  if(old){if(old.digest!==digest)throw Error('hailuo-idempotency-conflict');return (await this.lookup(key))!}
  // Durable ambiguity fence BEFORE POST. A lost response must never result in a second paid request.
  this.db.prepare("INSERT INTO studio_hailuo_calls(key,digest,state,path) VALUES(?,?,'dispatching',?)").run(key,digest,randomUUID())
  const reply=record(await this.send('POST','/v2/video_generation',body,signal)),id=reply.task_id
  if(typeof id!=='string'||!/^[\w-]{1,100}$/.test(id))throw Error('hailuo-protocol')
  this.db.prepare("UPDATE studio_hailuo_calls SET remoteId=?,state='remote' WHERE key=?").run(id,key);return id
 }
 async poll(id:string,input:GenerationInput,signal:AbortSignal):Promise<RemoteState>{
  const row=this.db.prepare('SELECT * FROM studio_hailuo_calls WHERE remoteId=?').get(id);if(!row)throw Error('hailuo-receipt-missing')
  if(row.state==='complete')return{status:'completed',output:{name:'hailuo.mp4',mime:'video/mp4',mediaUploadId:String(row.uploadId)}}
  if(['failed','cancelled'].includes(String(row.state)))return{status:'failed',code:'hailuo-import-failed'}
  if(this.active.has(id))return{status:'running',progress:80}
  if(this.active.size>=2)return{status:'running',progress:60}
  const task=record(record(await this.send('GET',`/v2/query/video_generation/${id}`,undefined,signal)).task)
  if(task.id!==id||task.model!=='MiniMax-H3')throw Error('hailuo-task-mismatch')
  if(task.status==='queued'||task.status==='running')return{status:'running',progress:task.status==='queued'?30:50}
  if(task.status==='failed'||task.status==='cancelled')return{status:'failed',code:'hailuo-remote-failed'}
  if(task.status!=='succeeded')throw Error('hailuo-status-invalid')
  const url=record(task.content).url;if(typeof url!=='string')throw Error('hailuo-result-missing')
  if(!this.stopped){const c=new AbortController();this.active.set(id,c);void this.importVideo(id,input,url,String(row.path),c).catch(()=>{/* receipt and checkpoint remain recoverable after storage failure */})}
  return{status:'running',progress:80}
 }
 private async importVideo(id:string,input:GenerationInput,url:string,pathId:string,c:AbortController){
  const path=this.media.pendingPath(pathId),timer=setTimeout(()=>c.abort(),10*60*1000);let uploadId:string|undefined
  try{
   let verified:{bytes:number;digest:string}|undefined
   for(let i=0;i<3;i++){try{verified=await this.quarantine.download(url,path,c.signal);break}catch(e){if(c.signal.aborted||i===2)throw e}}
   if(!verified)throw Error('video-unverified');c.signal.throwIfAborted();if(this.stopped)throw Error('stopped')
   const upload=this.media.start(input.project.id,{name:'hailuo.mp4',mime:'video/mp4',...verified});uploadId=upload.id
   renameSync(path,this.media.pendingPath(upload.id));this.db.prepare('UPDATE studio_uploads SET offset=bytes WHERE id=?').run(upload.id);await this.media.prepare(upload.id)
   c.signal.throwIfAborted();if(this.stopped)throw Error('stopped')
   this.db.prepare("UPDATE studio_hailuo_calls SET state='complete',uploadId=? WHERE remoteId=? AND state='remote'").run(upload.id,id)
  }catch{if(!this.stopped&&this.db.isOpen)this.db.prepare("UPDATE studio_hailuo_calls SET state='failed',error='video-validation-or-download-failed' WHERE remoteId=? AND state='remote'").run(id)
   if(uploadId&&this.db.isOpen){rmSync(this.media.pendingPath(uploadId),{force:true});this.db.prepare('DELETE FROM studio_uploads WHERE id=? AND result IS NULL').run(uploadId)}
  }finally{clearTimeout(timer);this.active.delete(id);if(!this.stopped){rmSync(path,{force:true});rmSync(path+'.json',{force:true})}}
 }
 async cancel(id:string){
  this.active.get(id)?.abort();this.db.prepare("UPDATE studio_hailuo_calls SET state='cancelled' WHERE remoteId=?").run(id)
  // The official DELETE is state-dependent: a queued task can finish between GET and DELETE,
  // turning cancellation into record deletion. No conditional cancel API is documented.
  // Fence local publication only; never risk deleting a completed remote result.
 }

 stop(){this.stopped=true;for(const c of this.active.values())c.abort()}
}
