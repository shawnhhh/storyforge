/** Explicit provenance IDs. Generation never mutates the referenced records. */
export interface VideoSourceLinks { novelId?:string; chapterId?:string; shotId?:string; characterIds?:string[]; materialIds?:string[] }
export function videoSourceLinks(raw:unknown):VideoSourceLinks {
 if(raw===undefined||raw==='')return{}
 const value:unknown=typeof raw==='string'?JSON.parse(raw):raw
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('视频来源关联无效')
 const input=value as Record<string,unknown>,result:VideoSourceLinks={}
 const id=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>128||[...v].some(c=>c.charCodeAt(0)<32))throw Error('视频来源ID无效');return v}
 for(const k of Object.keys(input))if(!['novelId','chapterId','shotId','characterIds','materialIds'].includes(k))throw Error('视频来源关联字段无效')
 for(const k of ['novelId','chapterId','shotId'] as const)if(input[k]!==undefined)result[k]=id(input[k])
 for(const k of ['characterIds','materialIds'] as const)if(input[k]!==undefined){const list=input[k];if(!Array.isArray(list)||list.length>32)throw Error('视频来源关联数量无效');result[k]=[...new Set(list.map(id))]}
 if(result.chapterId&&!result.novelId)throw Error('关联章节时请同时指定小说ID')
 return result
}
