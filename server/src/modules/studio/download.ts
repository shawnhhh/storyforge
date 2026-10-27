import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { closeSync, existsSync, lstatSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import ipaddr from 'ipaddr.js'
import { HttpError } from '../novels/store.js'
import { checkContainer, fileHash } from './media.js'
interface Address {address:string;family:number}
interface Reply {status:number;headers:Record<string,string|undefined>;body:AsyncIterable<Uint8Array>}
export type SafeTransport=(url:URL,address:Address,headers:Record<string,string>,signal:AbortSignal)=>Promise<Reply>
const transport:SafeTransport=async(url,address,headers,signal)=>{
 // A generic HTTP proxy can resolve a different IP than the validated address. Fail closed.
 if(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)throw new HttpError(503,'当前代理未配置安全 DNS 固定下载传输')
 return new Promise((resolve,reject)=>{const req=httpsRequest(url,{agent:false,signal,headers,lookup:(_host,_options,callback)=>callback(null,address.address,address.family)},res=>{const mapped:Record<string,string|undefined>={};for(const[k,v]of Object.entries(res.headers))mapped[k]=Array.isArray(v)?v[0]:v;resolve({status:res.statusCode??0,headers:mapped,body:res})});req.on('error',()=>reject(new HttpError(502,'远端媒体请求失败')));req.end()})
}
export class SafeMediaDownloader {
 constructor(private domains:readonly string[],private resolve:(host:string)=>Promise<Address[]>=host=>lookup(host,{all:true}),private send:SafeTransport=transport){}
 async validate(raw:string){
  let url:URL;try{url=new URL(raw)}catch{throw new HttpError(400,'媒体 URL 无效')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||raw.length>8192||url.hostname.endsWith('.')||isIP(url.hostname.replace(/^\[|\]$/g,''))||!this.domains.includes(url.hostname))throw new HttpError(400,'媒体 URL 不在服务商允许范围')
  const addresses=await this.resolve(url.hostname)
  if(!addresses.length||addresses.some(a=>{try{return ipaddr.process(a.address).range()!=='unicast'||isIP(a.address)!==a.family}catch{return true}}))throw new HttpError(400,'媒体地址解析到受限网络')
  return{url,address:addresses[0]}
 }
 async download(raw:string,destination:string,expected:{digest:string;bytes:number;mime:string},timeoutMs=30000){
  if(!/^[a-f0-9]{64}$/.test(expected.digest)||!Number.isSafeInteger(expected.bytes)||expected.bytes<12||expected.bytes>2*1024**3)throw new HttpError(400,'媒体大小或哈希无效')
  if(existsSync(destination)){if(!lstatSync(destination).isFile()||lstatSync(destination).isSymbolicLink()||await fileHash(destination)!==expected.digest)throw new HttpError(409,'目标文件已存在且内容不同');return {path:destination,bytes:expected.bytes,digest:expected.digest}}
  const pending=destination+'.pending',statePath=pending+'.json',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
  const bounded=<T>(action:Promise<T>)=>new Promise<T>((resolve,reject)=>{const abort=()=>reject(new HttpError(504,'媒体下载超时'));if(controller.signal.aborted){abort();return}controller.signal.addEventListener('abort',abort,{once:true});action.then(value=>{controller.signal.removeEventListener('abort',abort);resolve(value)},error=>{controller.signal.removeEventListener('abort',abort);reject(error)})})
  try{
   for(const path of [pending,statePath])if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||lstatSync(path).nlink!==1))throw new HttpError(400,'下载暂存路径不安全')
   let state:{digest:string;etag:string}|undefined
   if(existsSync(statePath)){try{state=JSON.parse(readFileSync(statePath,'utf8'))}catch{/* restart safely */}}
   let offset=existsSync(pending)?statSync(pending).size:0
   if(!state||state.digest!==expected.digest||!state.etag||state.etag.startsWith('W/')||offset>=expected.bytes){rmSync(pending,{force:true});offset=0;state=undefined}
   let rawUrl=raw,reply:Reply|undefined
   for(let redirects=0;redirects<=3;redirects++){
    const {url,address}=await bounded(this.validate(rawUrl))
    reply=await bounded(this.send(url,address,{...(offset?{Range:`bytes=${offset}-`,'If-Range':state!.etag}:{}),'Accept-Encoding':'identity'},controller.signal))
    if([301,302,303,307,308].includes(reply.status)){
     // Close redirect bodies and validate every new origin and its DNS before another request.
     const iterator=reply.body[Symbol.asyncIterator]();await iterator.return?.();if(!reply.headers.location||redirects===3)throw new HttpError(400,'媒体重定向过多或无效');rawUrl=new URL(reply.headers.location,url).href;continue
    }
    break
   }
   if(!reply||![200,206].includes(reply.status))throw new HttpError(502,'远端媒体下载失败')
   const etag=reply.headers.etag
   if(offset&&(reply.status!==206||etag!==state!.etag||reply.headers['content-range']!==`bytes ${offset}-${expected.bytes-1}/${expected.bytes}`))throw new HttpError(409,'远端文件已改变，请清除暂存后重试')
   if(!offset&&reply.status!==200)throw new HttpError(400,'远端范围响应无效')
   if(reply.headers['content-encoding']&&reply.headers['content-encoding']!=='identity')throw new HttpError(400,'远端编码不支持')
   if(reply.headers['content-type']?.split(';')[0]!==expected.mime)throw new HttpError(400,'远端媒体类型不匹配')
   if(reply.headers['content-length']&&Number(reply.headers['content-length'])!==expected.bytes-offset)throw new HttpError(400,'远端文件长度不匹配')
   if(etag&&!etag.startsWith('W/'))writeFileSync(statePath,JSON.stringify({digest:expected.digest,etag}),{mode:0o600})
   const fd=openSync(pending,offset?'a':'w',0o600)
   try{const iterator=reply.body[Symbol.asyncIterator]();for(;;){const next=await bounded(iterator.next());if(next.done)break;const chunk=next.value;if(controller.signal.aborted)throw new HttpError(504,'媒体下载超时');if(offset+chunk.length>expected.bytes)throw new HttpError(413,'远端媒体超过大小上限');let written=0;while(written<chunk.length)written+=writeSync(fd,chunk,written,chunk.length-written);offset+=chunk.length}fsyncSync(fd)}finally{closeSync(fd)}
   if(offset!==expected.bytes)throw new HttpError(502,'下载中断，可继续恢复')
   if(await fileHash(pending)!==expected.digest){rmSync(pending,{force:true});rmSync(statePath,{force:true});throw new HttpError(400,'远端文件哈希不匹配')}
   // Read just the signature, not an entire multi-gigabyte result.
   const {openSync:open,readSync,closeSync:close}=await import('node:fs'),head=Buffer.alloc(32),file=open(pending,'r');try{readSync(file,head,0,head.length,0);checkContainer(expected.mime,head)}finally{close(file)}
   renameSync(pending,destination);rmSync(statePath,{force:true});return{path:destination,bytes:offset,digest:expected.digest}
  }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(controller.signal.aborted?504:502,controller.signal.aborted?'媒体下载超时':'媒体下载失败；可用相同文件信息恢复')}finally{controller.abort();clearTimeout(timer)}
 }
}
