import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { CostControls, defaultPolicy } from '../src/modules/studio/costs.js'
import { ServerKeyVault, redact } from '../src/modules/studio/secrets.js'
import { SafeMediaDownloader, type SafeTransport } from '../src/modules/studio/download.js'
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
function fixture(limit=1000000){const dir=mkdtempSync(join(tmpdir(),'sf-costs-')),db=openStudioDatabase(dir),store=new StudioStore(db,undefined,undefined,{...defaultPolicy,monthlyLimitMicros:limit});store.jobs.stop();const p=store.create({kind:'music',title:'budget'});return{dir,db,store,p,close(){store.jobs.stop();db.close();rmSync(dir,{recursive:true,force:true})}}}
test('confirmed price is reserved atomically once, replay cannot charge twice, month and task limits reject before provider',async()=>{
 const f=fixture(3000);try{const input={project:f.p,prompt:'song'},quote=f.store.costs.quote(input,'mock','mock-metered'),body={version:1,prompt:'song',model:'mock-metered',confirmation:quote.token,idempotencyKey:'cost-request-123'}
 await assert.rejects(f.store.generate(f.p.id,{...body,confirmation:undefined}),/确认/)
 const a=await f.store.generate(f.p.id,body),b=await f.store.generate(f.p.id,body);assert.equal(a.id,b.id);assert.equal(f.store.costs.month().reservedMicros,2000)
 f.store.jobs.cancel(a.id)
 const second=f.store.costs.quote(input,'mock','mock-metered');await assert.rejects(f.store.generate(f.p.id,{...body,confirmation:second.token,idempotencyKey:'cost-second-123'}),/月度/)
 assert.equal(f.store.tasks(f.p.id).length,1);assert.equal(f.store.costs.month().reservedMicros,2000)
 const tight=new CostControls(f.db,{...defaultPolicy,taskLimitMicros:1});assert.throws(()=>tight.quote(input,'mock','mock-metered'),/单任务/)
 }finally{f.close()}
})
test('quotes bind snapshot, expire and are invalidated by price changes; reservations persist across restart',async()=>{
 const f=fixture();try{const input={project:f.p,prompt:'song'},quote=f.store.costs.quote(input,'mock','mock-metered')
 const changed=new CostControls(f.db,{...defaultPolicy,models:defaultPolicy.models.map(m=>m.id==='mock-metered'?{...m,rateMicrosPerSecond:2000}:m)});assert.throws(()=>changed.reserve('unused',input,'mock','mock-metered',quote.token),/确认/)
 const saved=f.store.save(f.p.id,{...f.p,content:'new',settings:{}})
 await assert.rejects(f.store.generate(f.p.id,{version:saved.version,prompt:'song',model:'mock-metered',confirmation:quote.token}),/确认/)
 const q=f.store.costs.quote({project:saved,prompt:'song'},'mock','mock-metered');f.db.prepare('UPDATE studio_cost_quotes SET expires=0 WHERE token=?').run(q.token)
 await assert.rejects(f.store.generate(f.p.id,{version:saved.version,prompt:'song',model:'mock-metered',confirmation:q.token}),/确认/)
 const now=f.store.costs.quote({project:saved,prompt:'song'},'mock','mock-metered');await f.store.generate(f.p.id,{version:saved.version,prompt:'song',model:'mock-metered',confirmation:now.token})
 const other=openStudioDatabase(f.dir);try{assert.equal(new CostControls(other).month().reservedMicros,2000)}finally{other.close()}
 f.store.costs.completed(f.store.tasks(f.p.id)[0].id);f.store.costs.completed(f.store.tasks(f.p.id)[0].id);assert.equal(f.store.costs.month().spentMicros,2000)
 }finally{f.close()}
})
test('encrypted server key storage rejects wrong master/tampering and redacts nested credentials and URL tokens',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sf-vault-'));try{const v=new ServerKeyVault(dir,Buffer.alloc(32,4));v.set('mock','fixture-secret-123');assert.equal(v.get('mock'),'fixture-secret-123');assert.ok(!readFileSync(join(dir,'mock.json'),'utf8').includes('fixture-secret-123'));assert.throws(()=>new ServerKeyVault(dir,Buffer.alloc(32,5)).get('mock'));assert.throws(()=>v.get('../mock'))
 const redacted=JSON.stringify(redact({authorization:'Bearer fixture-secret-123',nested:{api_key:'fixture-secret-123'},message:'token=fixture-secret-123 https://media.example/a?token=fixture-secret-123'}));assert.ok(!redacted.includes('fixture-secret-123'));assert.ok(!String(redact('upstream: {"api_key":"fixture-secret-123"}')).includes('fixture-secret-123'))
 const data=JSON.parse(readFileSync(join(dir,'mock.json'),'utf8'));data.data=Buffer.alloc(20).toString('base64');writeFileSync(join(dir,'mock.json'),JSON.stringify(data));assert.throws(()=>v.get('mock'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('SSRF rejects literals, credentials, non-HTTPS, suffix tricks, private IPv4/IPv6 and rebinding results',async()=>{
 let dns=0;const d=new SafeMediaDownloader(['media.example'],async()=>{dns++;return[{address:'127.0.0.1',family:4}]})
 for(const url of ['http://media.example/a','https://127.0.0.1/a','https://[::1]/a','https://u:p@media.example/a','https://media.example.evil/a','https://media.example:444/a','https://media.example./a'])await assert.rejects(d.validate(url))
 assert.equal(dns,0)
 for(const address of ['127.0.0.1','169.254.169.254','10.0.0.1','192.168.1.1','100.64.0.1','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])await assert.rejects(new SafeMediaDownloader(['media.example'],async()=>[{address,family:address.includes(':')?6:4}]).validate('https://media.example/a'))
 await assert.rejects(new SafeMediaDownloader(['media.example'],async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]).validate('https://media.example/a'))
})
test('safe downloader pins validated IP, validates redirects and resumes only the same strong ETag and exact range',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sf-download-')),bytes=Buffer.alloc(100000,3);bytes.write('RIFF');bytes.write('WAVE',8)
 const expected={bytes:bytes.length,digest:digest(bytes),mime:'audio/wav'};let calls=0,lastSignal:AbortSignal|undefined
 const send:SafeTransport=async(_url,ip,headers,signal)=>{lastSignal=signal;assert.equal(ip.address,'8.8.8.8');calls++;if(calls===1)return{status:200,headers:{etag:'"v1"','content-type':'audio/wav'},body:(async function*(){yield bytes.subarray(0,50000);throw new Error('token=fixture-secret')})()};assert.equal(headers.Range,'bytes=50000-');return{status:206,headers:{etag:'"v1"','content-type':'audio/wav','content-range':'bytes 50000-99999/100000'},body:(async function*(){yield bytes.subarray(50000)})()}}
 try{const d=new SafeMediaDownloader(['media.example'],async()=>[{address:'8.8.8.8',family:4}],send),path=join(dir,'result.wav');await assert.rejects(d.download('https://media.example/a',path,expected),e=>e instanceof Error&&!e.message.includes('fixture-secret'));await d.download('https://media.example/a',path,expected);assert.deepEqual(readFileSync(path),bytes);assert.equal(lastSignal?.aborted,true)
 const redirect=new SafeMediaDownloader(['media.example'],async()=>[{address:'8.8.8.8',family:4}],async()=>({status:302,headers:{location:'https://127.0.0.1/private'},body:(async function*(){})()}));await assert.rejects(redirect.download('https://media.example/a',join(dir,'blocked'),expected),/URL/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('download timeout, MIME/length/hash corruption and changed resume validators fail closed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sf-download-limits-')),b=Buffer.alloc(32);b.write('RIFF');b.write('WAVE',8);const expected={bytes:b.length,digest:digest(b),mime:'audio/wav'},dns=async()=>[{address:'8.8.8.8',family:4}]
 try{
 const hang=new SafeMediaDownloader(['media.example'],dns,async()=>new Promise(()=>{}));await assert.rejects(hang.download('https://media.example/a',join(dir,'timeout'),expected,20),/超时/)
 for(const headers of [{'content-type':'text/html'},{'content-type':'audio/wav','content-length':'999'}]){const d=new SafeMediaDownloader(['media.example'],dns,async()=>({status:200,headers,body:(async function*(){yield b})()}));await assert.rejects(d.download('https://media.example/a',join(dir,'bad'),expected))}
 const corrupt=new SafeMediaDownloader(['media.example'],dns,async()=>({status:200,headers:{'content-type':'audio/wav'},body:(async function*(){yield Buffer.alloc(32)})()}));await assert.rejects(corrupt.download('https://media.example/a',join(dir,'corrupt'),expected),/哈希/)
 writeFileSync(join(dir,'changed.pending'),b.subarray(0,16));writeFileSync(join(dir,'changed.pending.json'),JSON.stringify({digest:expected.digest,etag:'"v1"'}));const changed=new SafeMediaDownloader(['media.example'],dns,async()=>({status:206,headers:{etag:'"v2"','content-type':'audio/wav','content-range':'bytes 16-31/32'},body:(async function*(){yield b.subarray(16)})()}));await assert.rejects(changed.download('https://media.example/a',join(dir,'changed'),expected),/已改变/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('competing projects cannot overbook the monthly budget and a used quote cannot fund another task',async()=>{
 const f=fixture(3000);try{
 const other=f.store.create({kind:'music',title:'competing'}),prompt='song'
 const firstQuote=f.store.costs.quote({project:f.p,prompt},'mock','mock-metered'),secondQuote=f.store.costs.quote({project:other,prompt},'mock','mock-metered')
 const results=await Promise.allSettled([f.store.generate(f.p.id,{version:1,prompt,model:'mock-metered',confirmation:firstQuote.token,idempotencyKey:'concurrent-111'}),f.store.generate(other.id,{version:1,prompt,model:'mock-metered',confirmation:secondQuote.token,idempotencyKey:'concurrent-222'})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store.costs.month().reservedMicros,2000)
 const success=results[0];assert.equal(success.status,'fulfilled');if(success.status==='fulfilled')f.store.jobs.cancel(success.value.id)
 await assert.rejects(f.store.generate(f.p.id,{version:1,prompt,model:'mock-metered',confirmation:firstQuote.token,idempotencyKey:'concurrent-333'}),/确认/)
 }finally{f.close()}
})
