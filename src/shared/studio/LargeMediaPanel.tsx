import { useEffect, useState } from 'react'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { request } from '../api/client'
type Media = {id:string;name:string;mime:string;bytes:number;digest:string}
export function LargeMediaPanel({projectId}:{projectId:string}) {
  const [assets,setAssets]=useState<Media[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<{token:string;music:number;video:number;story:number}|null>(null)
  useEffect(()=>{let active=true;void request<Media[]>(`/studio/projects/${projectId}/media`).then(v=>{if(active)setAssets(v)}).catch(()=>{if(active)setMessage('媒体列表读取失败，请重新打开项目')});return()=>{active=false}},[projectId])
  async function upload(file:File,kind='media') {
    const hash=sha256.create();for await(const chunk of file.stream())hash.update(chunk)
    const digest=bytesToHex(hash.digest()),key=`sf-upload:${projectId}:${digest}:${kind}`
    let saved:string|null=null;try{saved=localStorage.getItem(key)}catch{/* session can still upload */}
    let session:{id:string;offset:number}
    try{if(!saved)throw new Error();session=await request(`/studio/uploads/${saved}`)}catch{session=await request(`/studio/projects/${projectId}/uploads`,'POST',{name:file.name,mime:file.type||'application/octet-stream',bytes:file.size,digest,kind});try{localStorage.setItem(key,session.id)}catch{/* manual resume remains available via API */}}
    for(let offset=session.offset;offset<file.size;) {
      const chunk=new Uint8Array(await file.slice(offset,offset+512*1024).arrayBuffer())
      let binary='';for(const byte of chunk)binary+=String.fromCharCode(byte)
      session=await request(`/studio/uploads/${session.id}`,'PUT',{offset,data:btoa(binary)});offset=session.offset;setMessage(`已上传 ${Math.floor(offset/file.size*100)}%`)
    }
    if(kind==='backup')setPreview(await request('/media-backups/preview','POST',{uploadId:session.id}))
    else {await request(`/studio/uploads/${session.id}/complete`,'POST',{});try{localStorage.removeItem(key)}catch{/* receipt remains idempotent */}setAssets(await request(`/studio/projects/${projectId}/media`));setMessage('媒体完整性校验通过并已保存')}
  }
  async function run(action:()=>Promise<void>){setBusy(true);try{await action()}catch(e){setMessage(e instanceof Error?e.message:'操作失败；重新选择相同文件可续传')}finally{setBusy(false)}}
  return <section aria-label="大型媒体库"><h2>大型媒体与统一备份</h2><p>媒体最大 2 GiB。中断后重新选择相同文件可继续上传。旧工程 JSON 不包含大型媒体，请使用统一备份 v2。</p><label>上传大型媒体<input type="file" disabled={busy} accept="audio/*,video/*,image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>upload(f));e.target.value=''}}/></label><button disabled={busy} onClick={()=>void run(async()=>{const archive=await request<{id:string}>('/media-backups','POST',{drafts:[]});const a=document.createElement('a');a.href=`/api/media-backups/${archive.id}/content`;a.download='storyforge-media.sfm';a.click();setMessage('已生成统一备份 v2，包含已保存项目和媒体；未保存编辑请先保存或导出草稿')})}>下载统一备份 v2</button><label>预览统一备份 v2<input type="file" accept=".sfm" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>upload(f,'backup'));e.target.value=''}}/></label>{preview&&<div><p>备份预览：小说 {preview.story} · 音乐 {preview.music} · 视频 {preview.video}；恢复将创建新副本。</p><button disabled={busy} onClick={()=>void run(async()=>{await request('/media-backups/restore','POST',{token:preview.token,modules:['story','music','video'],confirmation:'恢复为新副本'});setPreview(null);setMessage('已恢复为新副本，请刷新项目列表')})}>确认恢复为新副本</button></div>}{message&&<p role="status">{message}</p>}{assets.map(a=><figure key={a.id}>{a.mime.startsWith('audio/')?<audio controls src={`/api/studio/media/${a.id}/content`} aria-label={a.name}/>:a.mime.startsWith('video/')?<video controls src={`/api/studio/media/${a.id}/content`} aria-label={a.name} style={{maxWidth:'100%'}}/>:<img src={`/api/studio/media/${a.id}/content`} alt={a.name} style={{maxWidth:'100%'}}/>}<figcaption>{a.name} · {a.bytes} bytes <a href={`/api/studio/media/${a.id}/content`} download={a.name}>下载媒体</a><button disabled={busy} onClick={()=>void run(async()=>{await request(`/studio/media/${a.id}`,'DELETE',{});setAssets(await request(`/studio/projects/${projectId}/media`))})}>解除媒体引用</button></figcaption></figure>)}</section>
}
