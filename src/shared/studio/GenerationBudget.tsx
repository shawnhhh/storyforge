import { useEffect, useRef, useState } from 'react'
import type { StudioProject, StudioTask } from '../../../shared/contracts/studio'
import { request } from '../api/client'
export function useGenerationBudget(kind='music'){
 const [available,setAvailable]=useState(false)
 useEffect(()=>{let active=true;void request<{id:string}[]>('/studio/providers').then(p=>{if(active)setAvailable(p.some(p=>p.id==='music3-selfhost'))}).catch(()=>{});return()=>{active=false}},[])
 const [model,setModel]=useState('mock-v1')
 const pending=useRef(false)
 async function generate(project:StudioProject,prompt:string){if(pending.current)return;pending.current=true;try{const provider=model==='minimax_ttm'?'music3-selfhost':'mock';const quote=await request<{token:string;amountMicros:number;virtual:boolean}>(`/studio/projects/${project.id}/estimate`,'POST',{provider,model,prompt});if(quote.amountMicros>0&&!window.confirm(`本任务预估 ${quote.amountMicros} 微虚拟单位（${provider==='mock'?'仅 Mock 演示，不会真实扣费':'自托管算力估算，不保证生成时长'}）。确认生成？`))return;return await request<StudioTask>(`/studio/projects/${project.id}/generate`,'POST',{version:project.version,prompt,provider,model,confirmation:quote.token,idempotencyKey:crypto.randomUUID()})}finally{pending.current=false}}
 return {generate,isMusic3:model==='minimax_ttm',generateLabel:model==='minimax_ttm'?'生成 Music3 音乐':'生成 Mock 音乐',control:<label>生成模型<select aria-label="生成模型" value={model} onChange={e=>setModel(e.target.value)}><option value="mock-v1">Mock 免费模型</option><option value="mock-metered">Mock 虚拟计费模型</option>{kind==='music'&&<option value="minimax_ttm" disabled={!available}>Music3 自托管（默认关闭）</option>}</select></label>}
}
