import { useRef, useState } from 'react'
import type { StudioProject, StudioTask } from '../../../shared/contracts/studio'
import { request } from '../api/client'
export function useGenerationBudget(){
 const [model,setModel]=useState('mock-v1')
 const pending=useRef(false)
 async function generate(project:StudioProject,prompt:string){if(pending.current)return;pending.current=true;try{const quote=await request<{token:string;amountMicros:number;virtual:boolean}>(`/studio/projects/${project.id}/estimate`,'POST',{model,prompt});if(quote.amountMicros>0&&!window.confirm(`本任务预估 ${quote.amountMicros} 微虚拟单位（仅 Mock 演示，不会真实扣费）。确认生成？`))return;return await request<StudioTask>(`/studio/projects/${project.id}/generate`,'POST',{version:project.version,prompt,model,confirmation:quote.token,idempotencyKey:crypto.randomUUID()})}finally{pending.current=false}}
 return {generate,control:<label>生成模型<select aria-label="生成模型" value={model} onChange={e=>setModel(e.target.value)}><option value="mock-v1">Mock 免费模型</option><option value="mock-metered">Mock 虚拟计费模型</option></select></label>}
}
