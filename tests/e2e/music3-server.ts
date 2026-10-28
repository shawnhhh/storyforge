import { createServer } from 'node:http'
import { once } from 'node:events'
import { defaultPolicy } from '../../server/src/modules/studio/costs.js'
const fixture=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/v1/audio/speech'){res.writeHead(404).end();return}
 let raw='';for await(const b of req)raw+=b
 const input=JSON.parse(raw)
 if(input.model!=='minimax_ttm'||input.stream!==false||input.response_format!=='wav'||!input.input){res.writeHead(400).end();return}
 const data=Buffer.alloc(800044);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40)
 res.writeHead(200,{'Content-Type':'audio/wav'});res.end(input.input.includes('[fixture-truncated]')?data.subarray(0,44):data)
}).listen(0,'127.0.0.1');await once(fixture,'listening');const address=fixture.address();if(!address||typeof address==='string')throw Error('fixture unavailable')
process.env.STORYFORGE_MUSIC3_ENABLE='selfhost'
process.env.STORYFORGE_MUSIC3_ENDPOINT=`http://127.0.0.1:${address.port}/v1/audio/speech`
process.env.STORYFORGE_MEDIA_BUDGET_CONFIG=JSON.stringify({...defaultPolicy,models:[...defaultPolicy.models,{id:'minimax_ttm',provider:'music3-selfhost',rateMicrosPerSecond:0,maxSeconds:300,billingSeconds:300,maxPrompt:10000,kinds:['music'],virtual:true}]})
process.on('SIGTERM',()=>fixture.close());await import('../../server/src/index.js')
