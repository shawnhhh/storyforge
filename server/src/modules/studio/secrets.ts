import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
export function redact(value:unknown):unknown {
 if(typeof value==='string')return value.replace(/https?:\/\/[^\s"<>]+/g,u=>{try{const url=new URL(u);return url.origin+url.pathname}catch{return '[URL]'}}).replace(/Bearer\s+[^\s,;]+/gi,'Bearer [REDACTED]').replace(/\bsk-[\w-]+/g,'[REDACTED]').replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]')
 if(Array.isArray(value))return value.map(redact)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/key|token|secret|password|authorization|cookie/i.test(k)?'[REDACTED]':redact(v)]))
 return value
}
/** Server-only vault. Master key must be supplied outside this directory and is never backed up/exported. */
export class ServerKeyVault {
 private root:string
 constructor(directory:string,private master:Uint8Array){if(master.length!==32)throw new Error('Master key must be 32 bytes');this.root=resolve(directory);mkdirSync(this.root,{recursive:true,mode:0o700});if(lstatSync(this.root).isSymbolicLink())throw new Error('Unsafe key directory');chmodSync(this.root,0o700)}
 private path(provider:string){if(!/^[\w-]{1,100}$/.test(provider))throw new Error('Invalid provider');return join(this.root,provider+'.json')}
 set(provider:string,key:string){if(!key||key.length>8192)throw new Error('Invalid key');const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.master,nonce);cipher.setAAD(Buffer.from(provider));const data=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);const destination=this.path(provider),pending=destination+'.'+randomBytes(8).toString('hex')+'.pending';writeFileSync(pending,JSON.stringify({nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600,flag:'wx'});renameSync(pending,destination)}
 configured(provider:string){return existsSync(this.path(provider))}
 get(provider:string){const path=this.path(provider);if(!existsSync(path))return undefined;if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()||lstatSync(path).nlink!==1)throw new Error('Unsafe key file');const v=JSON.parse(readFileSync(path,'utf8')),decipher=createDecipheriv('aes-256-gcm',this.master,Buffer.from(v.nonce,'base64'));decipher.setAAD(Buffer.from(provider));decipher.setAuthTag(Buffer.from(v.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(v.data,'base64')),decipher.final()]).toString('utf8')}
}
