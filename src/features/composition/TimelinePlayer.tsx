import {useEffect,useMemo,useRef,useState} from 'react'
import {compositionDuration,type Composition} from '../../../shared/video/composition'
type Resolved=Record<string,{url:string;mime:string;status:string}>
/** A bounded realtime local preview/export. Never uploads media or invokes a provider. */
export function TimelinePlayer({composition:c,resolved}:{composition:Composition;resolved:Resolved}){
 const canvas=useRef<HTMLCanvasElement>(null),elements=useRef(new Map<string,HTMLMediaElement>()),clock=useRef({at:0,started:0,playing:false}),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[recording,setRecording]=useState(false),[message,setMessage]=useState(''),[url,setUrl]=useState(''),[plan,setPlan]=useState(false)
 const audio=useRef<AudioContext|null>(null),mix=useRef<MediaStreamAudioDestinationNode|null>(null),nodes=useRef(new Map<HTMLMediaElement,{node:MediaElementAudioSourceNode;gain:GainNode}>()),recorder=useRef<MediaRecorder|null>(null),cancelExport=useRef(false),recordedUrl=useRef(''),deadline=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),exportStream=useRef<MediaStream|null>(null),starting=useRef(false)
 const duration=compositionDuration(c),clips=useMemo(()=>c.tracks.flatMap(t=>t.clips.map(clip=>({track:t,clip}))),[c])
 const mediaCount=clips.filter(x=>x.clip.source).length
 const allReady=mediaCount<=64&&clips.filter(x=>x.clip.source&&!x.track.muted).every(x=>resolved[x.clip.source!.kind+':'+x.clip.source!.id]?.status==='completed')
 const canExport=typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')&&typeof HTMLCanvasElement.prototype.captureStream==='function'
 function stop(){clock.current.playing=false;setPlaying(false);for(const e of elements.current.values())e.pause();if(recorder.current?.state==='recording')recorder.current.stop()}
 useEffect(()=>{const mediaElements=elements.current;let frame=0,active=true
  const tick=()=>{if(!active)return;const state=clock.current;const t=Math.min(duration,state.playing?state.at+performance.now()-state.started:state.at);if(state.playing)setTime(t)
   const ctx=canvas.current?.getContext('2d');if(ctx){ctx.fillStyle='#10131c';ctx.fillRect(0,0,640,360)}
   for(const {track,clip} of clips){const e=elements.current.get(clip.id),on=!track.muted&&t>=clip.startMs&&t<clip.startMs+clip.durationMs
    if(e){const target=(clip.offsetMs+t-clip.startMs)/1000,limit=Number.isFinite(e.duration)?Math.max(0,e.duration-.04):0
     if(on&&e.readyState>=1){const seek=Math.min(Math.max(0,target),limit);if(!e.seeking&&Math.abs(e.currentTime-seek)>(state.playing?.2:.015))e.currentTime=seek
      if(track.kind==='video'){const v=e as HTMLVideoElement;if(ctx&&v.readyState>=2){const ratio=Math.min(640/v.videoWidth,360/v.videoHeight);ctx.drawImage(v,(640-v.videoWidth*ratio)/2,(360-v.videoHeight*ratio)/2,v.videoWidth*ratio,v.videoHeight*ratio)}}
      const gain=nodes.current.get(e)?.gain;e.volume=gain?1:clip.gain;if(gain)gain.gain.value=clip.gain
      if(state.playing&&target<e.duration&&e.paused)void e.play().catch(error=>{if(error instanceof DOMException&&error.name==='AbortError')return;state.at=t;state.playing=false;setPlaying(false);for(const media of mediaElements.values())media.pause();cancelExport.current=true;if(recorder.current?.state==='recording')recorder.current.stop();setMessage('浏览器拒绝播放；请暂停后重试，或更换支持的媒体编码')})
      if(target>=e.duration)e.pause()
     }else e.pause()
    }
    if(on&&track.kind==='subtitle'&&ctx){ctx.font='20px sans-serif';ctx.textAlign='center';const lines=(clip.text??'').match(/.{1,35}/gu)??[];lines.forEach((line,i)=>{const y=340-(lines.length-1-i)*24;ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(0,y-22,640,26);ctx.fillStyle='white';ctx.fillText(line,320,y)})}
   }
   if(state.playing&&t>=duration){state.at=duration;state.playing=false;setPlaying(false);for(const e of elements.current.values())e.pause();if(recorder.current?.state==='recording')recorder.current.stop()}
   frame=requestAnimationFrame(tick)
  };frame=requestAnimationFrame(tick);return()=>{active=false;cancelAnimationFrame(frame);for(const e of mediaElements.values())e.pause()}
 },[clips,resolved,duration]) // Media nodes are local-only; changed edits restart rendering at the same cursor.
 useEffect(()=>()=>{clock.current.playing=false;clearTimeout(deadline.current);cancelExport.current=true;if(recorder.current?.state==='recording')recorder.current.stop();void audio.current?.close();if(recordedUrl.current)URL.revokeObjectURL(recordedUrl.current)},[])
 function seek(value:number){stop();clock.current.at=value;setTime(value)}
 async function start(exporting=false){if(starting.current||recorder.current)return;starting.current=true;try{
   if(!allReady)throw Error('存在未完成或缺失素材，请先修复引用')
   for(const [id,e]of elements.current){const row=clips.find(x=>x.clip.id===id);if(!row||row.track.muted)continue;if(e.error||e.readyState<1||!Number.isFinite(e.duration)||e.duration<=0)throw Error('媒体尚未加载或编码不支持，不能开始预览/导出')}
   if(exporting){
    if(!canExport||duration>30000||clips.length>30||!duration)throw Error('本地导出限30秒、30片段，需支持WebM VP8/Opus的浏览器')
    if(recordedUrl.current){URL.revokeObjectURL(recordedUrl.current);recordedUrl.current='';setUrl('')}
    cancelExport.current=false
    audio.current??=new AudioContext();mix.current??=audio.current.createMediaStreamDestination();await audio.current.resume()
    for(const e of elements.current.values())if(e instanceof HTMLAudioElement&&!nodes.current.has(e)){const node=audio.current.createMediaElementSource(e),gain=audio.current.createGain();node.connect(gain);gain.connect(mix.current);gain.connect(audio.current.destination);nodes.current.set(e,{node,gain})}
    const stream=canvas.current!.captureStream(15);exportStream.current=stream;for(const track of mix.current.stream.getAudioTracks())stream.addTrack(track.clone())
    const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1000000,audioBitsPerSecond:96000}),chunks:Blob[]=[];let size=0
    rec.ondataavailable=e=>{size+=e.data.size;if(size>20*1024*1024){cancelExport.current=true;rec.stop();setMessage('导出超过20MiB限制，已中止')}else chunks.push(e.data)}
    rec.onstop=()=>{clearTimeout(deadline.current);exportStream.current=null;for(const t of stream.getTracks())t.stop();setRecording(false);clock.current.playing=false;setPlaying(false);for(const e of elements.current.values())e.pause();if(!cancelExport.current){if(recordedUrl.current)URL.revokeObjectURL(recordedUrl.current);recordedUrl.current=URL.createObjectURL(new Blob(chunks,{type:rec.mimeType}));setUrl(recordedUrl.current);setMessage('本地WebM导出完成，请下载并核对；没有上传或写入原素材')}recorder.current=null}
    rec.onerror=(event)=>{cancelExport.current=true;if(rec.state==='recording')rec.stop();const error=(event as Event&{error?:DOMException}).error;setMessage('浏览器录制失败：'+(error?.name??'unknown')+' '+(error?.message??'未生成成片'))};recorder.current=rec;clock.current.at=0;setTime(0);rec.start(250);deadline.current=setTimeout(()=>{cancelExport.current=true;if(rec.state==='recording')rec.stop();setMessage('导出超过时间限制，已取消')},duration+5000);setRecording(true);setPlan(false)
   }else if(audio.current)await audio.current.resume()
   if(clock.current.at>=duration)clock.current.at=0;clock.current.started=performance.now();clock.current.playing=true;setPlaying(true)
  }catch(e){if(exporting){cancelExport.current=true;for(const t of exportStream.current?.getTracks()??[])t.stop();exportStream.current=null;setRecording(false)}setMessage(String(e))}finally{starting.current=false}}
 useEffect(()=>{const hidden=()=>{if(document.hidden&&recorder.current?.state==='recording'){cancelExport.current=true;recorder.current.stop();setMessage('页面进入后台，已取消导出，请保持页面前台重试')}};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden)},[])
 return <section aria-label="多轨本地预览"><h3>本地时间线预览</h3><canvas ref={canvas} width={640} height={360} style={{maxWidth:'100%',background:'#10131c'}} aria-label="时间线画面"/><p>{(time/1000).toFixed(1)} / {(duration/1000).toFixed(1)} 秒。视频原声静音；音乐/配音由独立音轨混合。短视频末帧保持，短音频结束后静音。</p><p>预览最多64个媒体片段；本地实时导出限30秒、30片段、20MiB。更多片段请拆分工程。</p><input aria-label="时间线播放位置" type="range" min={0} max={Math.max(duration,1)} value={time} disabled={recording} onChange={e=>seek(Number(e.target.value))}/><button disabled={recording||!duration||!allReady} onClick={()=>playing?(clock.current.at=time,stop()):void start()}>{playing?'暂停时间线':'播放时间线'}</button><button disabled={recording||!canExport||duration>30000||clips.length>30||!allReady||!duration} onClick={()=>{stop();setPlan(true)}}>预览视频导出计划</button>{!canExport&&<p>当前浏览器不支持WebM录制；可继续预览，请使用支持VP8/Opus录制的Chrome或Firefox导出。</p>}{plan&&<div role="dialog" aria-label="视频导出确认"><p>本地实时录制 WebM，640×360、15fps、{(duration/1000).toFixed(1)}秒；最多30秒/30片段/20MiB。请保持页面前台。不会覆盖工程或素材。</p><button onClick={()=>void start(true)}>确认本地导出视频</button><button onClick={()=>setPlan(false)}>取消导出计划</button></div>}{recording&&<button onClick={()=>{cancelExport.current=true;stop();setMessage('已取消本地导出')}}>取消视频导出</button>}{url&&<a href={url} download="storyforge-timeline.webm">下载时间线视频</a>}<p role="status">{message}</p><div style={{display:'none'}}>{clips.filter(x=>x.clip.source).slice(0,64).map(({track,clip})=>{const s=resolved[clip.source!.kind+':'+clip.source!.id];if(!s?.url)return null;const props={src:s.url,preload:'auto',onError:(event:import('react').SyntheticEvent<HTMLMediaElement>)=>{cancelExport.current=true;if(recorder.current?.state==='recording')recorder.current.stop();setMessage(event.currentTarget.error?.message.includes('OnMediaSinkAudioError')?'音频输出设备不可用，请检查设备后重新载入；导出已中止':'素材解码失败，请更换编码；不会导出缺失片段')},ref:(e:HTMLMediaElement|null)=>{if(e)elements.current.set(clip.id,e);else elements.current.delete(clip.id)}};return track.kind==='video'?<video key={clip.id} {...props} muted playsInline/>:<audio key={clip.id} {...props}/>})}</div></section>
}
