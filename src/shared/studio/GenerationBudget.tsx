import { useEffect, useRef, useState } from 'react'
import type { StudioProject, StudioTask } from '../../../shared/contracts/studio'
import { request } from '../api/client'
export function useGenerationBudget(kind='music',label='生成模型'){
 const [available,setAvailable]=useState(false)
 const [hailuo,setHailuo]=useState(false)
 useEffect(()=>{let active=true;void request<{id:string}[]>('/studio/providers').then(p=>{if(active){setAvailable(p.some(p=>p.id==='music3-selfhost'));setHailuo(p.some(p=>p.id==='minimax-hailuo'))}}).catch(()=>{});return()=>{active=false}},[])
 const [model,setModel]=useState('mock-v1')
 const pending=useRef(false)
 async function generate(project:StudioProject,prompt:string){if(pending.current)return;pending.current=true;try{const provider=model==='MiniMax-H3'?'minimax-hailuo':model==='minimax_ttm'?'music3-selfhost':'mock';const quote=await request<{token:string;amountMicros:number;virtual:boolean}>(`/studio/projects/${project.id}/estimate`,'POST',{provider,model,prompt});if(quote.amountMicros>0&&!window.confirm(`本任务预估 ${quote.amountMicros} ${provider==='minimax-hailuo'?'微美元':'微虚拟单位'}（${provider==='minimax-hailuo'?'真实付费任务，按管理员配置的保守费率预留；取消不保证免收费':provider==='mock'?'仅 Mock 演示，不会真实扣费':'自托管算力估算，不保证生成时长'}）。确认生成？`))return;return await request<StudioTask>(`/studio/projects/${project.id}/generate`,'POST',{version:project.version,prompt,provider,model,confirmation:quote.token,idempotencyKey:crypto.randomUUID()})}finally{pending.current=false}}
 return {generate,isHailuo:model==='MiniMax-H3',isMusic3:model==='minimax_ttm',generateLabel:model==='minimax_ttm'?'生成 Music3 音乐':'生成 Mock 音乐',control:<label>生成模型<select aria-label={label} value={model} onChange={e=>setModel(e.target.value)}><option value="mock-v1">Mock 免费模型</option><option value="mock-metered">Mock 虚拟计费模型</option>{kind==='video'&&<option value="MiniMax-H3" disabled={!hailuo}>MiniMax H3（默认关闭）</option>}{kind==='music'&&<option value="minimax_ttm" disabled={!available}>Music3 自托管（默认关闭）</option>}</select></label>}
}
