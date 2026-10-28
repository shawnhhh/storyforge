// In-process official protocol fixture. No real keys, endpoints, or user data.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '../../server/src/app.js'
import { openDatabase } from '../../server/src/db/database.js'
import { openStudioDatabase } from '../../server/src/modules/studio/database.js'
import { StudioStore } from '../../server/src/modules/studio/store.js'
import { MediaStore } from '../../server/src/modules/studio/media.js'
import { HailuoProvider } from '../../server/src/modules/studio/video/hailuo.js'
import { VideoQuarantine } from '../../server/src/modules/studio/video/quarantine.js'
import { SafeMediaDownloader } from '../../server/src/modules/studio/download.js'
import { defaultPolicy } from '../../server/src/modules/studio/costs.js'
import { LocalAsyncProvider } from '../../server/src/modules/studio/jobs.js'
import { MockCreativeProvider } from '../../server/src/modules/studio/provider.js'
const dir=process.env.STORYFORGE_DATA_DIR!,db=openDatabase(dir),studioDb=openStudioDatabase(dir),media=new MediaStore(studioDb),file=join(dir,'fixture.mp4')
execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=5','-t','1','-c:v','libx264','-pix_fmt','yuv420p',file]);const data=readFileSync(file)
const tasks=new Map<string,boolean>()
const quarantine=new VideoQuarantine(new SafeMediaDownloader(['cdn.hailuoai.com'],async()=>[{address:'8.8.8.8',family:4}]),async url=>({status:200,headers:{'content-type':'video/mp4','content-length':String(data.length)},body:(async function*(){yield url.pathname.includes('broken')?data.subarray(0,32):data})()}))
const provider=new HailuoProvider(studioDb,media,async(method,path,body)=>{
 if(method==='POST'){const b=body as {model:string;content:{type:string;text?:string}[]};if(path!=='/v2/video_generation'||b.model!=='MiniMax-H3'||b.content[0].type!=='text')throw Error('protocol');const id=crypto.randomUUID();tasks.set(id,Boolean(b.content[0].text?.includes('[broken]')));return{task_id:id}}
 const id=path.split('/').at(-1)!;return{task:{id,model:'MiniMax-H3',status:'succeeded',content:{url:`https://cdn.hailuoai.com/${tasks.get(id)?'broken':'valid'}.mp4`}}}
},quarantine)
const store=new StudioStore(studioDb,undefined,[new LocalAsyncProvider(new MockCreativeProvider()),provider],{...defaultPolicy,taskLimitMicros:2000000,monthlyLimitMicros:100000000,models:[...defaultPolicy.models,{id:'MiniMax-H3',provider:provider.id,rateMicrosPerSecond:130000,maxSeconds:15,maxPrompt:2000,kinds:['video'],virtual:false}]})
const server=createApp(db,undefined,undefined,store).listen(Number(process.env.SERVER_PORT),'127.0.0.1')
process.on('SIGTERM',()=>{store.jobs.stop();server.close(()=>{studioDb.close();db.close()})})
