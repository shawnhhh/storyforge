/** Versioned local composition; integer milliseconds are shared by editor, preview and export. */
export interface ClipSource {kind:'asset'|'media'|'task';id:string}
export interface Scene {id:string;title:string;setting:string;characterIds:string[]}
export interface Shot {id:string;sceneId:string;description:string;camera:string;durationMs:number;characterIds:string[];taskIds:string[]}
export interface Clip {id:string;shotId?:string;sceneId?:string;startMs:number;durationMs:number;offsetMs:number;gain:number;source?:ClipSource;text?:string}
export interface Track {id:string;kind:'video'|'music'|'voice'|'subtitle';muted:boolean;clips:Clip[]}
export interface Composition {schema:1;source:{novelId:string;chapterId:string;chapterVersion:number;title:string;digest:string};scenes:Scene[];shots:Shot[];tracks:Track[]}
export const compositionDuration=(c:Composition)=>Math.max(c.shots.reduce((n,s)=>n+s.durationMs,0),...c.tracks.flatMap(t=>t.clips.map(x=>x.startMs+x.durationMs)))
export function parseComposition(raw:unknown):Composition {
 const fail=():never=>{throw Error('分镜或时间线格式无效')}
 let value:unknown;try{value=typeof raw==='string'?JSON.parse(raw):raw}catch{return fail()}
 const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>}
 const text=(v:unknown,max:number,empty=false)=>{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))return fail();return v}
 const id=(v:unknown)=>text(v,100)
 const list=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)return fail();return v as unknown[]}
 const ids=(v:unknown)=>{const a=list(v,32).map(id);if(new Set(a).size!==a.length)return fail();return a}
 const number=(v:unknown,min:number,max:number,integer=true)=>{if(typeof v!=='number'||!Number.isFinite(v)||(integer&&!Number.isInteger(v))||v<min||v>max)return fail();return v}
 const v=obj(value),source=obj(v.source);if(v.schema!==1)return fail()
 const c:Composition={schema:1,source:{novelId:id(source.novelId),chapterId:id(source.chapterId),chapterVersion:number(source.chapterVersion,1,100000000),title:text(source.title,200),digest:text(source.digest,64)},scenes:[],shots:[],tracks:[]}
 if(!/^[a-f0-9]{64}$/.test(c.source.digest))return fail()
 c.scenes=list(v.scenes,50).map(x=>{const s=obj(x);return{id:id(s.id),title:text(s.title,200),setting:text(s.setting,2000,true),characterIds:ids(s.characterIds)}})
 c.shots=list(v.shots,100).map(x=>{const s=obj(x);return{id:id(s.id),sceneId:id(s.sceneId),description:text(s.description,2000),camera:text(s.camera,100),durationMs:number(s.durationMs,100,60000),characterIds:ids(s.characterIds),taskIds:ids(s.taskIds)}})
 c.tracks=list(v.tracks,8).map(x=>{const t=obj(x);if(!['video','music','voice','subtitle'].includes(String(t.kind))||typeof t.muted!=='boolean')return fail();const kind=t.kind as Track['kind'];return{id:id(t.id),kind,muted:t.muted,clips:list(t.clips,200).map(x=>{const a=obj(x),clip:Clip={id:id(a.id),startMs:number(a.startMs,0,600000),durationMs:number(a.durationMs,100,600000),offsetMs:number(a.offsetMs,0,600000),gain:number(a.gain,0,1,false)};if(a.shotId!==undefined)clip.shotId=id(a.shotId);if(a.sceneId!==undefined)clip.sceneId=id(a.sceneId);if(kind==='subtitle'){clip.text=text(a.text,2000);if(a.source!==undefined)return fail()}else{const s=obj(a.source);if(!['asset','media','task'].includes(String(s.kind)))return fail();clip.source={kind:s.kind as ClipSource['kind'],id:id(s.id)}}return clip})}})
 const unique=(a:{id:string}[])=>{if(new Set(a.map(x=>x.id)).size!==a.length)fail()};unique(c.scenes);unique(c.shots);unique(c.tracks);unique(c.tracks.flatMap(t=>t.clips))
 for(const s of c.shots)if(!c.scenes.some(x=>x.id===s.sceneId))fail()
 for(const t of c.tracks){const sorted=[...t.clips].sort((a,b)=>a.startMs-b.startMs);for(let i=0;i<sorted.length;i++){const x=sorted[i];if(i&&sorted[i-1].startMs+sorted[i-1].durationMs>x.startMs)fail();if(x.shotId&&!c.shots.some(s=>s.id===x.shotId)||x.sceneId&&!c.scenes.some(s=>s.id===x.sceneId))fail()}}
 if(c.tracks.filter(t=>t.kind==='video').length>1||compositionDuration(c)>600000)fail()
 return c
}
export function reorderShots(c:Composition,from:number,to:number):Composition {
 const copy=structuredClone(c),old=new Map<string,number>();let time=0;for(const s of c.shots){old.set(s.id,time);time+=s.durationMs}
 const [shot]=copy.shots.splice(from,1);if(!shot||to<0||to>copy.shots.length)throw Error('分镜顺序无效');copy.shots.splice(to,0,shot)
 time=0;for(const s of copy.shots){const delta=time-old.get(s.id)!;for(const t of copy.tracks)for(const clip of t.clips)if(clip.shotId===s.id)clip.startMs+=delta;time+=s.durationMs}
 return parseComposition(copy)
}
