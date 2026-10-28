import { createHash, randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { createWriteStream, renameSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { GenerationInput } from '../../../../../shared/contracts/studio.js'
import type { AsyncCreativeProvider, RemoteState } from '../jobs.js'
import { MediaStore, fileHash, mediaLimit } from '../media.js'
import type { ServerKeyVault } from '../secrets.js'
import { HttpError } from '../../novels/store.js'
export const music3Capabilities={remoteQuery:false,remoteCancel:false,remoteIdempotency:false,webhook:false,localCancellation:true} as const
export function music3Request(input:GenerationInput){
 const s=input.project.settings
 if(input.project.kind!=='music'||s.durationSeconds!==undefined)throw new HttpError(400,'Music3仅支持音乐，未提供严格时长参数')
 if(s.instrumental!==undefined&&typeof s.instrumental!=='boolean')throw new HttpError(400,'纯音乐参数无效')
 if(s.instrumental&&input.project.content.trim())throw new HttpError(400,'纯音乐模式请先明确清空歌词并保存')
 if(!s.instrumental&&!input.project.content.trim())throw new HttpError(400,'人声歌曲需要先保存歌词')
 const lyrics=s.instrumental?'[Instrumental]':input.project.content
 const instructions=[input.prompt,JSON.stringify({genre:s.genre,mood:s.mood,tempo:s.tempo,structure:s.structure}),s.instrumental?'Instrumental only, no vocals.':'Follow the supplied lyrics.'].join('\n')
 if(Buffer.byteLength(lyrics+instructions)>4000)throw new HttpError(400,'Music3适配器输入上限为4000 UTF-8字节')
 return{model:'minimax_ttm',input:lyrics,instructions,response_format:'wav',seed:7,max_new_tokens:9000,stream:false}
}
interface Reply {status:number;mime:string;body:AsyncIterable<Uint8Array>}
export type Music3Transport=(body:ReturnType<typeof music3Request>,signal:AbortSignal)=>Promise<Reply>
/** Only a preconfigured loopback control plane; never follows redirects or accepts result URLs. */
export function localMusic3Transport(endpoint:string,vault?:ServerKeyVault):Music3Transport {
 const url=new URL(endpoint)
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/v1/audio/speech'||url.username||url.password||url.search||url.hash)throw new Error('Music3 endpoint must be explicit loopback /v1/audio/speech')
 return async(body,signal)=>new Promise((resolve,reject)=>{
  const key=vault?.get('music3-selfhost'),req=request(url,{method:'POST',signal,headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})}},res=>{resolve({status:res.statusCode??0,mime:res.headers['content-type']?.split(';')[0]??'',body:res})})
  req.on('error',()=>reject(new Error('Music3 transport unavailable')));req.end(JSON.stringify(body))
 })
}
/** Durable local wrapper for a synchronous official API, NOT a remote task/query API. */
export class Music3Provider implements AsyncCreativeProvider {
 readonly id='music3-selfhost'
 readonly models=[{id:'minimax_ttm',kinds:['music' as const],maxPrompt:4000}]
 readonly capabilities=music3Capabilities
 private active=new Map<string,AbortController>()
 private stopped=false
 constructor(private db:DatabaseSync,private media:MediaStore,private send:Music3Transport){
  // No remote reconciliation API exists. Never reissue a previously dispatched request after restart.
  db.prepare("UPDATE studio_music_calls SET state='unknown',error='response-unknown-no-automatic-retry' WHERE state='dispatched'").run()
 }
 validate(input:GenerationInput,model:string){if(model!=='minimax_ttm')throw new HttpError(400,'Music3模型不支持');music3Request(input)}
 async lookup(key:string){return this.db.prepare('SELECT 1 FROM studio_music_calls WHERE key=?').get(key)?key:null}
 async submit(input:GenerationInput,model:string,key:string){
  this.validate(input,model);const digest=createHash('sha256').update(JSON.stringify(music3Request(input))).digest('hex'),old=this.db.prepare('SELECT digest FROM studio_music_calls WHERE key=?').get(key)
  if(old&&old.digest!==digest)throw new HttpError(409,'Music3本地幂等键冲突')
  this.db.prepare("INSERT OR IGNORE INTO studio_music_calls VALUES(?,?,'ready',NULL,NULL)").run(key,digest);return key
 }
 async poll(key:string,input:GenerationInput):Promise<RemoteState>{
  const row=this.db.prepare('SELECT * FROM studio_music_calls WHERE key=?').get(key)
  if(!row)throw new Error('Music3 receipt missing')
  if(row.state==='complete')return{status:'completed',output:{name:'music3.wav',mime:'audio/wav',mediaUploadId:String(row.uploadId)}}
  if(['failed','unknown','cancelled'].includes(String(row.state)))return{status:'failed',code:String(row.error??row.state)}
  if(row.state==='dispatched'&&!this.active.has(key)){this.db.prepare("UPDATE studio_music_calls SET state='unknown',error='response-unknown-no-automatic-retry' WHERE key=? AND state='dispatched'").run(key);return{status:'failed',code:'response-unknown-no-automatic-retry'}}
  if(row.state==='ready'&&this.active.size>=2)return{status:'running',progress:10}
  if(row.state==='ready'&&!this.stopped){
   const controller=new AbortController();this.active.set(key,controller)
   // Commit the dispatch marker BEFORE the single non-idempotent network request.
   if(this.db.prepare("UPDATE studio_music_calls SET state='dispatched' WHERE key=? AND state='ready'").run(key).changes)void this.execute(key,input,controller).catch(()=>{/* storage failure retains dispatch marker; next local poll marks unknown */})
  }
  return{status:'running',progress:40}
 }
 private async execute(key:string,input:GenerationInput,controller:AbortController){
  const temp=this.media.pendingPath(randomUUID()),timer=setTimeout(()=>controller.abort(),10*60*1000)
  let stream:ReturnType<typeof createWriteStream>|undefined
  try{
   const response=await this.send(music3Request(input),controller.signal)
   if(response.status!==200||response.mime!=='audio/wav')throw new Error(response.status===401||response.status===403?'auth':response.status===429?'rate-limited':'upstream')
   stream=createWriteStream(temp,{flags:'wx',mode:0o600});let ioError:unknown;stream.on('error',e=>{ioError=e});let bytes=0
   for await(const chunk of response.body){if(controller.signal.aborted||this.stopped)throw new Error('interrupted');bytes+=chunk.length;if(bytes>mediaLimit)throw new Error('size');if(ioError)throw ioError;if(!stream.write(chunk))await once(stream,'drain')}
   stream.end();await once(stream,'finish');if(controller.signal.aborted||this.stopped)throw new Error('interrupted')
   const digest=await fileHash(temp),upload=this.media.start(input.project.id,{name:'music3.wav',mime:'audio/wav',bytes,digest})
   renameSync(temp,this.media.pendingPath(upload.id));this.db.prepare('UPDATE studio_uploads SET offset=bytes WHERE id=?').run(upload.id)
   await this.media.prepare(upload.id)
   if(controller.signal.aborted||this.stopped)throw new Error('interrupted')
   this.db.prepare("UPDATE studio_music_calls SET state='complete',uploadId=? WHERE key=? AND state='dispatched'").run(upload.id,key)
  }catch(e){if(!this.stopped&&this.db.isOpen)this.db.prepare("UPDATE studio_music_calls SET state='failed',error=? WHERE key=? AND state='dispatched'").run(controller.signal.aborted?'interrupted-response-unknown':e instanceof Error&&['auth','rate-limited','size'].includes(e.message)?e.message:'generation-or-import-failed',key)}
  finally{clearTimeout(timer);controller.abort();stream?.destroy();rmSync(temp,{force:true});this.active.delete(key)}
 }
 async cancel(key:string){this.active.get(key)?.abort();this.db.prepare("UPDATE studio_music_calls SET state='cancelled',error='local-only-remote-cancel-unsupported' WHERE key=?").run(key)}
 stop(){this.stopped=true;for(const controller of this.active.values())controller.abort()}
}
