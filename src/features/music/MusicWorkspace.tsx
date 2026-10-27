import { useGenerationBudget } from '../../shared/studio/GenerationBudget'
import { LargeMediaPanel } from '../../shared/studio/LargeMediaPanel'
import { ImportPanel } from '../../shared/studio/ImportPanel'
import { useEffect, useRef, useState } from 'react'
import type { StudioAsset, StudioProject, StudioTask, StudioVersion } from '../../../shared/contracts/studio'
import { request } from '../../shared/api/client'
import { AssetPreview, TaskProgress } from '../../shared/studio/StudioFrame'
import { studioClient } from '../../shared/studio/client'
import { usePreferences } from '../preferences/usePreferences'
import { defaultMusicConfiguration, mockMusicAdapter, musicConfiguration } from './provider'
import '../preferences/preferences.css'
import './music.css'
const root = '/studio/projects'
export function MusicWorkspace({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  usePreferences()
  const [projects, setProjects] = useState<StudioProject[]>([])
  const budget = useGenerationBudget()
  const [current, setCurrent] = useState<StudioProject | null>(null)
  const [saved, setSaved] = useState('')
  const [name, setName] = useState('')
  const [history, setHistory] = useState<StudioVersion[]>([])
  const [assets, setAssets] = useState<StudioAsset[]>([])
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const active = useRef<string | null>(null)
  const dirty = Boolean(current && JSON.stringify(current) !== saved)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  const config = current ? musicConfiguration(current) : defaultMusicConfiguration
  async function list() { setProjects(await studioClient.list('music')) }
  useEffect(() => { let mounted = true; void studioClient.list('music').then(value => { if (mounted) { setProjects(value); setReady(true) } }).catch(e => { if (mounted) setError(String(e)) }); return () => { mounted = false } }, [])
  useEffect(() => { active.current = current?.id ?? null }, [current?.id])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  async function metadata(id: string) {
    const [versions, media, jobs] = await Promise.all([studioClient.history(id), studioClient.assets(id), studioClient.tasks(id)])
    if (active.current === id) { setHistory(versions); setAssets(media); setTasks(jobs) }
  }
  useEffect(() => {
    const id = current?.id
    if (!id) return
    void metadata(id).catch(e => setError(String(e)))
    const timer = window.setInterval(() => { void metadata(id).catch(e => setError(String(e))) }, 1500)
    return () => window.clearInterval(timer)
  }, [current?.id])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setStatus('')
    try { await action() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  async function open(id: string) {
    if (dirty) { setError('请先保存歌词或放弃本次编辑，再切换项目。'); return }
    await run(async () => { const project = await request<StudioProject>(`${root}/${id}`); active.current = project.id; setCurrent(project); setSaved(JSON.stringify(project)); setHistory([]); setAssets([]); setTasks([]) })
  }
  function edit(change: Partial<StudioProject>) { if (current) setCurrent({ ...current, ...change }) }
  function setting(change: Record<string, string | number | string[]>) { if (current) edit({ settings: { ...current.settings, ...change } }) }
  async function save() {
    if (!current) return
    await run(async () => {
      const updated = await studioClient.save(current)
      setCurrent(updated); setSaved(JSON.stringify(updated)); await list(); await metadata(updated.id); setStatus('歌词与配置已保存，历史版本已保留。')
    })
  }
  async function importAudio(file: File | undefined) {
    if (!file || !current) return
    if (!file.type.startsWith('audio/')) { setError('请选择音频文件。'); return }
    if (file.size > 500000) { setError('MVP 支持 500 KB 以内的音频素材，请先裁剪片段。'); return }
    await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const value of bytes) binary += String.fromCharCode(value)
      await request(`${root}/${current.id}/assets`, 'POST', { name: file.name, mime: file.type, data: btoa(binary) }); await metadata(current.id); setStatus('音频已导入本机素材库。')
    })
  }
  return <main className="music-workbench"><header><div><p className="music-note">STORYFORGE · MUSIC</p><h1>音乐工作台</h1></div><a href="#" onClick={e => { if (dirty) { e.preventDefault(); setError('请先保存歌词或放弃本次编辑，再返回小说。') } }}>小说工作台</a></header>
    {error && <p role="alert" className="music-error">{error}</p>}<p role="status">{status}</p>
    <div className="music-layout"><aside className="music-card"><h2>歌曲项目</h2><ImportPanel kind="music" disabled={busy || dirty} onImported={list} />{!ready && <><p className="music-note">正在连接本机音乐库，连接成功后可创建歌曲。</p>{error && <button disabled={busy} onClick={() => void run(async () => { await list(); setReady(true) })}>重新连接音乐库</button>}</>}<form onSubmit={event => { event.preventDefault(); if (!ready) return; if (dirty) { setError('请先保存当前项目。'); return }; void run(async () => { const project = await request<StudioProject>(root, 'POST', { kind: 'music', title: name }); active.current = project.id; setCurrent(project); setSaved(JSON.stringify(project)); setName(''); await list() }) }}><label>歌曲名称<input value={name} onChange={e => setName(e.target.value)} maxLength={200} required disabled={busy} /></label><button disabled={busy || !ready || !name.trim()} className="primary">创建歌曲</button></form><nav className="music-projects" aria-label="歌曲列表">{projects.map(project => <button key={project.id} disabled={busy} aria-current={current?.id === project.id} onClick={() => void open(project.id)}>{project.title}</button>)}</nav></aside>
    <section className="music-card">{!current ? <><h2>让下一首歌从一句词开始</h2><p className="music-note">创建歌曲，记录歌词与编曲想法。Mock 生成提供短音频流程演示，所有素材保存在本机。</p></> : <><label>项目标题<input value={current.title} disabled={busy} onChange={e => edit({ title: e.target.value })} /></label><div className="music-config"><label>曲风<input value={config.genre} disabled={busy} onChange={e => setting({ genre: e.target.value })} /></label><label>情绪<input value={config.mood} disabled={busy} onChange={e => setting({ mood: e.target.value })} /></label><label>速度（BPM）<input type="number" min="30" max="300" value={config.tempo} disabled={busy} onChange={e => setting({ tempo: Number(e.target.value) })} /></label></div><label>歌曲结构（用逗号分隔）<input value={config.structure.join(',')} disabled={busy} onChange={e => setting({ structure: e.target.value.split(',') })} /></label><label>歌词<textarea aria-label="歌词" className="music-lyrics" value={current.content} disabled={busy} onChange={e => edit({ content: e.target.value })} placeholder="[主歌]&#10;写下第一句歌词……" /></label><div className="music-actions"><button className="primary" disabled={busy || !dirty} onClick={() => void save()}>保存歌词与配置</button><button onClick={() => { const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'music-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>导出当前歌词草稿</button><span className="music-note">{dirty ? '有未保存编辑' : `已保存 · 版本 ${current.version}`}</span>{dirty && <button disabled={busy} onClick={() => { const original = JSON.parse(saved) as StudioProject; setCurrent(original); onDirtyChange(false); setError('') }}>放弃本次编辑</button>}</div><details><summary>歌词历史版本（{history.length}）</summary>{history.map(version => <div className="music-actions" key={version.id}><span>版本 {version.version} · {new Date(version.createdAt).toLocaleString()}</span><button disabled={busy || dirty} onClick={() => { edit({ content: version.content, title: version.title, settings: version.settings }); setStatus('历史版本已载入编辑区，点击保存后生成新版本。') }}>载入版本 {version.version}</button></div>)}</details><hr /><LargeMediaPanel key={current.id} projectId={current.id} /><h2>制作与试听</h2>{budget.control}<p className="music-note">当前 Provider：Mock。生成短合成音试听，用于验证任务、素材与导出流程；歌词不会被发送到外部服务。</p><div className="music-actions"><button disabled={busy || dirty || tasks.some(task => task.status === 'queued' || task.status === 'running')} onClick={() => void run(async () => { if(!await budget.generate(current, mockMusicAdapter.prompt(current)))return; await metadata(current.id); setStatus('Mock 音乐任务已创建。') })}>生成 Mock 音乐</button><label>导入音频（≤500 KB）<input type="file" accept="audio/*" disabled={busy} onChange={e => { void importAudio(e.target.files?.[0]); e.target.value = '' }} /></label><a href={`/api/studio/projects/${current.id}/export`} download>导出完整歌曲项目</a></div><p className="music-note">小说备份不包含音乐，请定期导出完整歌曲项目以保留歌词、历史与音频素材。</p><ul aria-label="生成任务">{tasks.map(task => <li key={task.id}><TaskProgress {...task} />{['queued','running'].includes(task.status) && <button onClick={() => void run(async () => { await studioClient.cancel(task.id); await metadata(current.id) })}>取消任务</button>}{task.error}</li>)}</ul><div className="music-assets">{assets.map(asset => <article className="music-asset" key={asset.id}><AssetPreview {...asset} /><p className="music-note">{asset.mime} · {asset.bytes} bytes</p></article>)}</div></> }</section></div></main>
}
