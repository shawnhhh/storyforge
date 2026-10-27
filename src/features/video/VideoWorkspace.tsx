import { useCallback, useEffect, useState } from 'react'
import type { StudioAsset, StudioProject, StudioTask, StudioVersion } from '../../../shared/contracts/studio'
import { MockVideoAdapter, readVideoConfiguration, validateVideo, type VideoConfiguration } from '../../../shared/video/model'
import { request } from '../../shared/api/client'
import { usePreferences } from '../preferences/usePreferences'
import '../preferences/preferences.css'
import './video.css'

const path = '/studio/projects'
const adapter = new MockVideoAdapter()
async function fileData(file: File): Promise<string> {
  if (file.size > 500_000) throw new Error('MVP 素材上限为 500 KB，请先压缩')
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('素材读取失败')); reader.readAsDataURL(file) })
}
function assetURL(id: string) { return `/api/studio/assets/${encodeURIComponent(id)}/content` }
export function VideoWorkspace() {
  usePreferences()
  const [projects, setProjects] = useState<StudioProject[]>([])
  const [project, setProject] = useState<StudioProject | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [configuration, setConfiguration] = useState<VideoConfiguration>({ aspectRatio: '16:9', shots: [] })
  const [assets, setAssets] = useState<StudioAsset[]>([])
  const [history, setHistory] = useState<StudioVersion[]>([])
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [message, setMessage] = useState('所有生成均使用 Mock Provider')
  const [busy, setBusy] = useState(false)
  const dirty = Boolean(project && (title !== project.title || content !== project.content || JSON.stringify(configuration) !== JSON.stringify(readVideoConfiguration(project.settings))))
  const loadProjects = useCallback(async () => { setProjects(await request<StudioProject[]>(`${path}?kind=video`)) }, [])
  useEffect(() => { let active = true; void request<StudioProject[]>(`${path}?kind=video`).then(value => { if (active) setProjects(value) }).catch(error => { if (active) setMessage(String(error)) }); return () => { active = false } }, [])
  const related = useCallback(async (id: string) => {
    const [a, h, t] = await Promise.all([request<StudioAsset[]>(`${path}/${id}/assets`), request<StudioVersion[]>(`${path}/${id}/history`), request<StudioTask[]>(`${path}/${id}/tasks`)])
    setAssets(a); setHistory(h); setTasks(t)
  }, [])
  useEffect(() => {
    if (!project || !tasks.some(task => task.status === 'queued' || task.status === 'running')) return
    const timer = setInterval(() => { void related(project.id).catch(error => setMessage(String(error))) }, 350)
    return () => clearInterval(timer)
  }, [project, tasks, related])
  async function execute(action: () => Promise<void>) { setBusy(true); try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) } }
  function display(value: StudioProject) { setProject(value); setTitle(value.title); setContent(value.content); setConfiguration(readVideoConfiguration(value.settings)) }
  async function select(id: string) {
    if (dirty && !window.confirm('当前更改尚未保存，确认切换？')) return
    await execute(async () => { display(await request<StudioProject>(`${path}/${id}`)); await related(id); setMessage('项目已载入') })
  }
  async function save() {
    if (!project) return
    await execute(async () => {
      validateVideo(configuration)
      const value = await request<StudioProject>(`${path}/${project.id}`, 'PUT', { version: project.version, title, content, settings: { aspectRatio: configuration.aspectRatio, shots: JSON.stringify(configuration.shots) } })
      display(value); await related(value.id); await loadProjects(); setMessage('已保存到数据库')
    })
  }
  function updateShot(index: number, patch: Partial<VideoConfiguration['shots'][number]>) { setConfiguration(value => ({ ...value, shots: value.shots.map((shot, i) => i === index ? { ...shot, ...patch } : shot) })) }
  return <main className="video-studio">
    <header className="video-top"><div><span className="video-eyebrow">STORYFORGE / VIDEO</span><h1>视频工作台</h1></div><a href="#">小说</a></header>
    <div className="video-layout"><aside><h2>视频项目</h2><button disabled={busy || dirty} onClick={() => void execute(async () => { const value = await request<StudioProject>(path, 'POST', { kind: 'video', title: '未命名视频' }); display(value); await related(value.id); await loadProjects(); setMessage('已创建视频项目') })}>新建视频项目</button><nav aria-label="视频项目列表">{projects.map(value => <button aria-current={project?.id === value.id ? 'page' : undefined} key={value.id} disabled={busy} onClick={() => void select(value.id)}>{value.title}</button>)}</nav><p>素材与版本保存在本机 Studio 数据库。请定期导出工程文件。</p></aside>
    <section className="video-editor"><p role="status">{message}{dirty ? ' · 有未保存更改' : ''}</p>{project ? <fieldset className="video-fields" disabled={busy}>
      <div className="video-toolbar"><label>视频名称<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} /></label><button className="video-primary" disabled={busy} onClick={() => void save()}>保存视频项目</button><a download href={`/api/studio/projects/${project.id}/export`}>导出工程 JSON</a></div>
      <label>剧本<textarea className="video-script" value={content} onChange={event => setContent(event.target.value)} placeholder="从一段故事开始，描述场景与对白…" /></label>
      <div className="video-toolbar"><h2>分镜</h2><label>画面比例<select value={configuration.aspectRatio} onChange={event => setConfiguration(value => ({ ...value, aspectRatio: event.target.value }))}><option>16:9</option><option>9:16</option><option>1:1</option></select></label><button disabled={configuration.shots.length >= 100} onClick={() => setConfiguration(value => ({ ...value, shots: [...value.shots, { id: crypto.randomUUID(), description: '', duration: 5, camera: '固定镜头' }] }))}>添加镜头</button></div>
      <ol className="video-shots">{configuration.shots.map((shot, index) => <li key={shot.id}><strong>镜头 {index + 1}</strong><label>镜头描述 {index + 1}<textarea value={shot.description} onChange={event => updateShot(index, { description: event.target.value })} /></label><div className="video-toolbar"><label>时长 {index + 1}（秒）<input type="number" min="1" max="60" value={shot.duration} onChange={event => updateShot(index, { duration: Number(event.target.value) })} /></label><label>运镜 {index + 1}<input value={shot.camera} onChange={event => updateShot(index, { camera: event.target.value })} /></label><button disabled={index === 0} onClick={() => setConfiguration(value => { const shots = [...value.shots]; [shots[index - 1], shots[index]] = [shots[index], shots[index - 1]]; return { ...value, shots } })}>上移镜头 {index + 1}</button><button onClick={() => setConfiguration(value => ({ ...value, shots: value.shots.filter(item => item.id !== shot.id) }))}>移除镜头 {index + 1}</button></div></li>)}</ol>
      <section className="video-card"><h2>AI 视频</h2><p>Mock 生成提供一秒可播放示例，用于验证流程。剧本、运镜和时长配置保存在工程中，示例不代表成片渲染。</p><button disabled={busy || dirty || !configuration.shots.length} onClick={() => void execute(async () => { await request(`${path}/${project.id}/generate`, 'POST', { version: project.version, prompt: adapter.prompt(project) }); await related(project.id); setMessage('Mock 视频任务已提交') })}>生成 Mock 视频</button>{tasks.map(task => <div key={task.id}><span>{task.provider} · {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'running' ? '生成中' : '排队中'}</span><progress max="100" value={task.progress} aria-label="视频生成进度" /><span>{task.progress}%</span>{task.error && <p>{task.error}</p>}</div>)}</section>
      <section className="video-card"><h2>素材与预览</h2><label>导入图片、音频或视频<input type="file" accept="image/png,image/jpeg,image/webp,audio/wav,audio/mpeg,audio/ogg,video/webm,video/mp4" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void execute(async () => { await request(`${path}/${project.id}/assets`, 'POST', { name: file.name, mime: file.type, data: await fileData(file) }); await related(project.id); setMessage('素材已导入') }) }} /></label><div className="video-assets">{assets.map(asset => <article key={asset.id}><strong>{asset.name}</strong>{asset.mime.startsWith('video/') ? <video controls preload="metadata" src={assetURL(asset.id)} aria-label={`视频预览 ${asset.name}`} /> : asset.mime.startsWith('audio/') ? <audio controls src={assetURL(asset.id)} aria-label={`音频试听 ${asset.name}`} /> : <img src={assetURL(asset.id)} alt={asset.name} />}<a href={assetURL(asset.id)} download={asset.name}>导出素材 {asset.name}</a><small>{asset.bytes} 字节</small></article>)}</div></section>
      <details><summary>历史版本（{history.length}）</summary>{history.map(version => <article key={version.id}><strong>版本 {version.version} · {version.title}</strong><pre>{version.content}</pre><button disabled={busy || dirty} onClick={() => { setTitle(version.title); setContent(version.content); setConfiguration(readVideoConfiguration(version.settings)); setMessage('历史版本已载入编辑区，点击保存后成为新版本') }}>载入版本 {version.version}</button></article>)}</details>
    </fieldset> : <div className="video-empty"><h2>让故事开始流动</h2><p>创建视频项目，编写剧本并组织你的第一个分镜。</p></div>}</section></div>
  </main>
}
