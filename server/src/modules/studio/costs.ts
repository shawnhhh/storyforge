import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { GenerationInput } from '../../../../shared/contracts/studio.js'
import { HttpError } from '../novels/store.js'
export interface PriceModel {id:string;provider:string;rateMicrosPerSecond:number;maxSeconds:number;maxPrompt:number;kinds:('music'|'video')[];virtual:boolean}
export interface BudgetPolicy {taskLimitMicros:number;monthlyLimitMicros:number;models:PriceModel[]}
export const defaultPolicy:BudgetPolicy={taskLimitMicros:100000,monthlyLimitMicros:1000000,models:[{id:'mock-v1',provider:'mock',rateMicrosPerSecond:0,maxSeconds:60,maxPrompt:10000,kinds:['music','video'],virtual:true},{id:'mock-metered',provider:'mock',rateMicrosPerSecond:1000,maxSeconds:60,maxPrompt:10000,kinds:['music','video'],virtual:true}]}
const digest=(input:GenerationInput,provider:string,model:string)=>createHash('sha256').update(JSON.stringify([input,provider,model])).digest('hex')
export class CostControls {
 readonly policy:BudgetPolicy
 constructor(private db:DatabaseSync,policy:BudgetPolicy=defaultPolicy,private now=()=>Date.now()){
  if(!Number.isSafeInteger(policy.taskLimitMicros)||policy.taskLimitMicros<0||!Number.isSafeInteger(policy.monthlyLimitMicros)||policy.monthlyLimitMicros<0||new Set(policy.models.map(m=>m.provider+':'+m.id)).size!==policy.models.length)throw new Error('Invalid budget policy')
  for(const m of policy.models)if(!/^[\w-]{1,100}$/.test(m.id)||!m.kinds.length||m.kinds.some(k=>!['music','video'].includes(k))||typeof m.virtual!=='boolean'||!/^[\w-]{1,100}$/.test(m.provider)||!Number.isSafeInteger(m.rateMicrosPerSecond)||m.rateMicrosPerSecond<0||!Number.isSafeInteger(m.maxSeconds)||m.maxSeconds<1||m.maxSeconds>3600||!Number.isSafeInteger(m.maxPrompt)||m.maxPrompt<1||m.maxPrompt>10000)throw new Error('Invalid price model')
  this.policy={taskLimitMicros:policy.taskLimitMicros,monthlyLimitMicros:policy.monthlyLimitMicros,models:policy.models.map(m=>({id:m.id,provider:m.provider,rateMicrosPerSecond:m.rateMicrosPerSecond,maxSeconds:m.maxSeconds,maxPrompt:m.maxPrompt,kinds:[...m.kinds],virtual:m.virtual}))}
 }
 private price(input:GenerationInput,provider:string,model:string){
  const p=this.policy.models.find(p=>p.id===model&&p.provider===provider)
  if(!p||!p.kinds.includes(input.project.kind)||input.prompt.length>p.maxPrompt)throw new HttpError(400,'模型或提示词能力不支持')
  const seconds=input.project.settings.durationSeconds??(input.project.kind==='music'?2:1)
  if(typeof seconds!=='number'||!Number.isInteger(seconds)||seconds<1||seconds>p.maxSeconds)throw new HttpError(400,'模型时长参数不支持')
  const amount=p.rateMicrosPerSecond*seconds
  if(!Number.isSafeInteger(amount)||amount>this.policy.taskLimitMicros)throw new HttpError(402,'单任务费用上限不足')
  return {p,seconds,amount}
 }
 quote(input:GenerationInput,provider='mock',model='mock-v1'){
  if(Number(this.db.prepare('SELECT COUNT(*) n FROM studio_cost_quotes WHERE expires>? AND taskId IS NULL').get(this.now())!.n)>=1000)throw new HttpError(429,'待确认费用过多')
  const {p,seconds,amount}=this.price(input,provider,model),token=randomUUID(),expires=this.now()+300000
  this.db.prepare('INSERT INTO studio_cost_quotes VALUES(?,?,?,?,?,NULL)').run(token,digest(input,provider,model),amount,expires,JSON.stringify(p))
  this.db.prepare('DELETE FROM studio_cost_quotes WHERE expires<? AND taskId IS NULL').run(this.now())
  return {token,provider,model,seconds,amountMicros:amount,currency:'virtual-unit',virtual:p.virtual,expires,monthly:this.month()}
 }
 // Called inside the SAME transaction as StudioJobs submission. No provider call precedes this reservation.
 reserve(taskId:string,input:GenerationInput,provider:string,model:string,token:unknown){
  const {p,amount}=this.price(input,provider,model),month=new Date(this.now()).toISOString().slice(0,7)
  if(amount>0){const quote=typeof token==='string'?this.db.prepare('SELECT * FROM studio_cost_quotes WHERE token=?').get(token):undefined
   if(!quote||quote.taskId!==null||Number(quote.expires)<this.now()||quote.digest!==digest(input,provider,model)||quote.amount!==amount||quote.price!==JSON.stringify(p))throw new HttpError(409,'请重新预览并确认费用')
   this.db.prepare('UPDATE studio_cost_quotes SET taskId=? WHERE token=?').run(taskId,String(token))
  }
  const reserved=Number(this.db.prepare('SELECT COALESCE(SUM(reserved),0) n FROM studio_cost_reservations WHERE month=?').get(month)!.n)
  if(!Number.isSafeInteger(reserved+amount)||reserved+amount>this.policy.monthlyLimitMicros)throw new HttpError(402,'月度预算不足')
  this.db.prepare('INSERT INTO studio_cost_reservations VALUES(?,?,?,?,?,?,?)').run(taskId,month,amount,0,'reserved',JSON.stringify(p),this.now())
 }
 completed(taskId:string){this.db.prepare("UPDATE studio_cost_reservations SET spent=reserved,status='settled' WHERE taskId=? AND status='reserved'").run(taskId)}
 month(){const month=new Date(this.now()).toISOString().slice(0,7),row=this.db.prepare('SELECT COALESCE(SUM(reserved),0) reserved,COALESCE(SUM(spent),0) spent FROM studio_cost_reservations WHERE month=?').get(month)!;return{month,reservedMicros:Number(row.reserved),spentMicros:Number(row.spent),limitMicros:this.policy.monthlyLimitMicros}}
}

export function configuredBudget(env:NodeJS.ProcessEnv=process.env):BudgetPolicy {
 if(!env.STORYFORGE_MEDIA_BUDGET_CONFIG)return defaultPolicy
 try{return JSON.parse(env.STORYFORGE_MEDIA_BUDGET_CONFIG) as BudgetPolicy}catch{throw new Error('Invalid media budget configuration')}
}
