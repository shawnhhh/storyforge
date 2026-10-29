import { useState } from 'react'
import { request } from '../../shared/api/client'
import { readLocalDrafts } from '../../shared/drafts/store'
type Preview = { token: string; createdAt: string; story: number; music: number; video: number; drafts: number; policy: string }
function download(value: unknown,name: string) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a')
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function UnifiedBackupPanel() {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[archive,setArchive]=useState<unknown>(null),[preview,setPreview]=useState<Preview|null>(null),[modules,setModules]=useState(['story','music','video','drafts'])
 async function run(action:()=>Promise<void>){setBusy(true);setMessage('');try{await action()}catch(e){setMessage(String(e))}finally{setBusy(false)}}
 return <section aria-label="三模块统一备份"><h2>三模块统一备份</h2><p>仅本机处理，不上传云端。恢复创建新副本，不覆盖现有作品。备份包含此浏览器已保护草稿；其他浏览器和未保护的编辑需先保存或导出。草稿恢复到独立收件箱，核对后手动采用。</p><button disabled={busy} onClick={()=>void run(async()=>{
 const drafts:unknown[]=await readLocalDrafts()
 for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('storyforge-video-draft:'))drafts.push({module:'video',key,value:JSON.parse(localStorage.getItem(key)!)})}
 const data=await request('/unified-backups/export','POST',{drafts});download(data,'storyforge-unified.json');setMessage('统一备份已导出：小说、规划、人物、音乐、视频、历史、素材与草稿')
 })}>导出完整统一备份</button><label>选择统一备份 JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';setPreview(null);setArchive(null);if(file)void run(async()=>{
 if(!file.name.toLowerCase().endsWith('.json')||file.size>128*1024*1024)throw new Error('请选择128MiB以内的JSON备份')
 const value:unknown=JSON.parse(await file.text()),result=await request<Preview>('/unified-backups/preview','POST',{archive:value});setArchive(value);setPreview(result);setMessage('SHA-256、SQLite 结构、正文及关联数据校验通过')
 })}} /></label>{preview&&<div><h3>统一恢复预览</h3><p>{preview.createdAt} · 小说 {preview.story} · 音乐 {preview.music} · 视频 {preview.video} · 草稿 {preview.drafts}</p><p>{preview.policy}</p>{(['story','music','video','drafts'] as const).map((id,i)=><label key={id}><input type="checkbox" checked={modules.includes(id)} disabled={busy} onChange={e=>setModules(e.target.checked?[...modules,id]:modules.filter(v=>v!==id))} />{['小说','音乐','视频','浏览器草稿收件箱'][i]}</label>)}<button disabled={busy||!modules.length} onClick={()=>void run(async()=>{await request('/unified-backups/restore','POST',{archive,token:preview.token,modules,confirmation:'恢复为新副本'});setPreview(null);setArchive(null);setMessage('所选模块已恢复为新副本；返回工作台后重新打开作品。草稿保存在恢复收件箱。')})}>确认恢复为新副本</button><button disabled={busy} onClick={()=>{setPreview(null);setArchive(null)}}>取消统一恢复</button></div>}<button disabled={busy} onClick={()=>void run(async()=>{const drafts=await request('/unified-backups/drafts');download(drafts,'storyforge-recovered-drafts.json');setMessage('恢复草稿收件箱已导出，请核对后手动采用')})}>导出恢复草稿收件箱</button>{message && <p role="status">{message}</p>}</section>
}
