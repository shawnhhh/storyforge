import { closeSync, existsSync, fsyncSync, openSync, lstatSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { SafeMediaDownloader, pinnedMediaTransport, type SafeTransport } from '../download.js'
import { fileHash, mediaLimit } from '../media.js'
/** No provider digest exists: this verifies transport completeness and local media validity,
 * not cryptographic authenticity against a provider-signed original. Never feeds a made-up hash to SafeMediaDownloader. */
export class VideoQuarantine {
 constructor(private guard:SafeMediaDownloader,private send:SafeTransport=pinnedMediaTransport){}
 async download(raw:string,path:string,signal:AbortSignal){
  const statePath=path+'.json',identity=createHash('sha256').update(raw).digest('hex')
  let state:{identity:string;etag:string;bytes:number;offset:number;digest:string}|undefined
  const safe=(p:string)=>{if(existsSync(p)){const s=lstatSync(p);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1)throw Error('unsafe-quarantine')}}
  safe(path);safe(statePath)
  if(existsSync(statePath))try{state=JSON.parse(readFileSync(statePath,'utf8'))}catch{/* discard invalid checkpoint */}
  if(!state||state.identity!==identity||!/^"[^"\r\n]+"$/.test(state.etag)||!Number.isSafeInteger(state.bytes)||state.bytes<12||state.bytes>mediaLimit||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>state.bytes||!existsSync(path)||statSync(path).size!==state.offset||await fileHash(path)!==state.digest){rmSync(path,{force:true});rmSync(statePath,{force:true});state=undefined}
  let offset=state?.offset??0
  try{
   if(!state||offset!==state.bytes){
    const {url,address}=await this.guard.validate(raw)
    const reply=await this.send(url,address,{'Accept-Encoding':'identity',...(offset?{Range:`bytes=${offset}-`,'If-Range':state!.etag}:{})},signal)
    // No redirect support in this path. CDN origins must be explicitly reviewed.
    const length=Number(reply.headers['content-length']),etag=reply.headers.etag
    const bytes=state?.bytes??length
    if((offset?reply.status!==206:reply.status!==200)||!/^\d+$/.test(reply.headers['content-length']??'')||!Number.isSafeInteger(length)||length<=0||bytes>mediaLimit||bytes<12||reply.headers['content-type']?.split(';')[0]!=='video/mp4'||(reply.headers['content-encoding']&&reply.headers['content-encoding']!=='identity')||(offset&&(etag!==state!.etag||reply.headers['content-range']!==`bytes ${offset}-${bytes-1}/${bytes}`||length!==bytes-offset)))throw Error('invalid-video-response')
    const fd=openSync(path,offset?'a':'wx',0o600)
    try{
     for await(const chunk of reply.body){
      signal.throwIfAborted();if(offset+chunk.length>bytes)throw Error('video-size')
      let n=0;while(n<chunk.length)n+=writeSync(fd,chunk,n,chunk.length-n);offset+=chunk.length
     }
    }finally{fsyncSync(fd);closeSync(fd)
     if(etag&&/^"[^"\r\n]+"$/.test(etag)){const checkpoint={identity,etag,bytes,offset,digest:await fileHash(path)};writeFileSync(statePath+'.tmp',JSON.stringify(checkpoint),{mode:0o600});renameSync(statePath+'.tmp',statePath)}
    }
    if(offset!==bytes)throw Error('video-interrupted')
   }
   await verifyVideo(path,signal)
   const digest=await fileHash(path);rmSync(statePath,{force:true});return{bytes:offset,digest}
  }catch(e){if(e instanceof Error&&['invalid-video-response','video-size','invalid-mp4','invalid-video-decode','video-validator-unavailable'].includes(e.message)){rmSync(path,{force:true});rmSync(statePath,{force:true})}throw e}
 }
}
/** Strict complete ISO BMFF box boundaries plus an actual full video decode. No network protocols. */
export async function verifyVideo(path:string,signal:AbortSignal){
 const size=statSync(path).size,fd=openSync(path,'r'),head=Buffer.alloc(16),found=new Set<string>();let at=0,count=0
 try{while(at<size){if(++count>100000||size-at<8)throw Error('invalid-mp4');readSync(fd,head,0,Math.min(16,size-at),at);let n=head.readUInt32BE(0);const type=head.toString('ascii',4,8);if(n===1){if(size-at<16)throw Error('invalid-mp4');n=Number(head.readBigUInt64BE(8));if(n<16)throw Error('invalid-mp4')}if(n===0||!Number.isSafeInteger(n)||n<8||n>size-at)throw Error('invalid-mp4');if(at===0&&type!=='ftyp')throw Error('invalid-mp4');found.add(type);at+=n}if(!['ftyp','moov','mdat'].every(t=>found.has(t)))throw Error('invalid-mp4')}finally{closeSync(fd)}
 await new Promise<void>((resolve,reject)=>{const child=spawn('ffmpeg',['-nostdin','-v','error','-xerror','-threads','1','-max_alloc','268435456','-protocol_whitelist','file','-i',path,'-map','0:v:0','-f','null','-'],{signal,stdio:'ignore'});child.once('error',()=>reject(Error('video-validator-unavailable')));child.once('exit',code=>code===0?resolve():reject(Error('invalid-video-decode')))})
}
