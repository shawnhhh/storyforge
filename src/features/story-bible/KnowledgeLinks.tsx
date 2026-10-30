import { DraftNotice } from '../../shared/drafts/DraftNotice.js'
import { useDraftProtection } from '../../shared/drafts/useDraftProtection.js'
import { useEffect, useRef, useState } from 'react'
import type { KnowledgeLink, KnowledgeSnapshot } from '../../../shared/contracts/knowledge.js'
import type { StoryBible } from '../../../shared/contracts/story-bible.js'
import type { ChapterSummary } from '../../../shared/contracts/novels.js'
import { worldCategories } from '../../../shared/contracts/story-bible.js'
import { ApiError } from '../../shared/api/client.js'
import { storyApi } from './api.js'
import { listenKnowledgeChanges, notifyKnowledgeChange } from './knowledge-events.js'

export type OpenMaterial = (kind: 'characters' | 'world' | 'chapter', id: string) => void
interface Props {
  novelId: string
  source: { kind: 'world' | 'character' | 'chapter'; id: string }
  data: StoryBible
  chapters: ChapterSummary[]
  disabled: boolean
  onBusy: (busy: boolean) => void
  onOpen?: OpenMaterial
}
export function KnowledgeLinks({ novelId, source, data, chapters, disabled, onBusy, onOpen }: Props) {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState(source.kind === 'chapter' ? '创作参考' : '相关设定')
  const [note, setNote] = useState('')
  const draft = useDraftProtection(`reference:${novelId}:${source.kind}:${source.id}`, { target: '', label: source.kind === 'chapter' ? '创作参考' : '相关设定', note: '' })
  const [saved, setSaved] = useState(false)
  function change(patch: Partial<{ target: string; label: string; note: string }>) {
    const value = { target, label, note, ...patch }
    setTarget(value.target); setLabel(value.label); setNote(value.note); setSaved(false)
    draft.protection.change(value)
  }
  const active = useRef(false)
  const mounted = useRef(false)
  // A delayed read must never replace an acknowledged newer revision.
  function acceptSnapshot(value: KnowledgeSnapshot) {
    setSnapshot(current => current && current.version > value.version ? current : value)
  }
  useEffect(() => {
    mounted.current = true
    let current = true
    storyApi.links(novelId).then(value => { if (current) acceptSnapshot(value) }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : '读取关联失败') })
    return () => { current = false; mounted.current = false }
  }, [novelId])
  useEffect(() => listenKnowledgeChanges(novelId, acceptSnapshot), [novelId])
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (active.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  function name(kind: 'world' | 'character' | 'chapter', id: string) {
    return kind === 'chapter' ? chapters.find(item => item.id === id)?.title ?? '已删除章节' : kind === 'world' ? data.world.find(item => item.id === id)?.name ?? '已删除设定' : data.characters.find(item => item.id === id)?.name ?? '已删除人物'
  }
  async function refresh() {
    if (active.current) return
    active.current = true; setBusy(true)
    try { const fresh = await storyApi.links(novelId); if (mounted.current) { acceptSnapshot(fresh); setError(''); setConflict(false) } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '读取关联失败') }
    finally { active.current = false; if (mounted.current) setBusy(false) }
  }
  async function save(links: KnowledgeLink[], adding = false) {
    if (!snapshot || active.current || disabled || conflict) return
    active.current = true; setBusy(true); setError('')
    try {
      const fresh = await storyApi.saveLinks(novelId, { version: snapshot.version, links })
      notifyKnowledgeChange(novelId, fresh)
      if (adding) { void draft.protection.saved({ target, label, note }) }
      if (mounted.current) { acceptSnapshot(fresh); if (adding) { setTarget(''); setNote(''); setSaved(true) } }
    } catch (reason) {
      if (mounted.current) { setError(reason instanceof Error ? reason.message : '保存关联失败，输入已保留，可重试'); if (reason instanceof ApiError && [400, 404, 409].includes(reason.status)) setConflict(true) }
    } finally { active.current = false; if (mounted.current) setBusy(false) }
  }
  const outgoing = snapshot?.links.filter(item => item.source.kind === source.kind && item.source.id === source.id) ?? []
  const incoming = snapshot?.links.filter(item => item.target.kind === source.kind && item.target.id === source.id) ?? []
  const targets = [...(source.kind === 'chapter' ? data.characters.map(item => ({ kind: 'character' as const, id: item.id, title: `${item.name} · 人物` })) : []), ...data.world.filter(item => item.id !== source.id).map(item => ({ kind: 'world' as const, id: item.id, title: `${item.name} · ${worldCategories[item.category]}` }))]
  const chosen = targets.find(item => `${item.kind}:${item.id}` === target)
  const duplicate = outgoing.some(item => item.target.kind === chosen?.kind && item.target.id === chosen?.id && item.label === label.trim())
  const blocked = draft.blocked || disabled || busy || conflict || !snapshot
  const title = source.kind === 'chapter' ? '章节资料引用' : '资料关联与引用'
  function open(kind: 'world' | 'character' | 'chapter', id: string) { onOpen?.(kind === 'character' ? 'characters' : kind, id) }
  return <section className="knowledge-links" aria-label={title} aria-busy={busy}>
    <div className="knowledge-heading"><h3>{title}</h3><button disabled={busy || disabled} onClick={() => { void refresh() }}>刷新关联</button></div>
    <p className="profile-hint">{source.kind === 'chapter' ? '引用资料供本章创作查阅，记录用途与备注；不会插入或改写正文。' : '建立地点、势力及其他设定之间的有向关联，并查看引用此资料的章节。人物关联沿用人物档案。'}</p>
    <DraftNotice draft={draft} onRestore={value => change(value)} />
    {saved && <p role="status">已保存到数据库</p>}
    {error && <p role="alert">保存失败 · {error}；输入已保留。{conflict ? '请先刷新关联，核对最新记录。' : '可重试操作。'}</p>}
    {!snapshot && !error && <p role="status">正在读取关联…</p>}
    <ul className="profile-associations">{outgoing.map(item => <li key={item.id}><div><button disabled={busy || disabled || !onOpen} onClick={() => open(item.target.kind, item.target.id)}>{name(item.target.kind, item.target.id)}</button><span> · {item.label}</span>{item.note && <p className="knowledge-note">{item.note}</p>}{source.kind === 'chapter' && <details><summary>查阅资料内容</summary><p className="knowledge-note">{item.target.kind === 'world' ? data.world.find(record => record.id === item.target.id)?.description : Object.entries(data.characters.find(record => record.id === item.target.id)?.fields ?? {}).filter(([, value]) => value).map(([, value]) => value).join('\n')}</p></details>}</div><button disabled={blocked} aria-label={`移除引用 ${name(item.target.kind, item.target.id)}`} onClick={() => { if (window.confirm(`删除引用“${name(item.source.kind, item.source.id)} → ${name(item.target.kind, item.target.id)} · ${item.label}”？不删除正文和资料，引用进入回收站保留 30 天。`)) void save(snapshot!.links.filter(row => row.id !== item.id)) }}>移除</button></li>)}</ul>
    {source.kind !== 'character' && <fieldset disabled={blocked} className="knowledge-add"><legend>{source.kind === 'chapter' ? '添加资料引用' : '添加设定关联'}</legend>
      <label>引用资料<select aria-label="引用资料" value={target} onChange={event => change({ target: event.target.value })}><option value="">选择资料</option>{targets.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.title}</option>)}</select></label>
      <label>引用用途<input maxLength={80} value={label} onChange={event => change({ label: event.target.value })} /></label>
      <label>引用备注<textarea aria-label="引用备注" maxLength={2000} rows={2} value={note} onChange={event => change({ note: event.target.value })} /></label>
      <button disabled={!chosen || !label.trim() || duplicate || (snapshot?.links.length ?? 0) >= 1000} onClick={() => { if (chosen && snapshot) void save([...snapshot.links, { id: crypto.randomUUID(), source: { kind: source.kind as 'chapter' | 'world', id: source.id }, target: { kind: chosen.kind, id: chosen.id }, label: label.trim(), note }], true) }}>{source.kind === 'chapter' ? '添加引用' : '添加关联'}</button>
      {duplicate && <p className="profile-hint">此资料与用途已存在。</p>}
    </fieldset>}
    <h4>被引用与反向关联</h4>
    {incoming.length ? <ul className="profile-associations">{incoming.map(item => <li key={item.id}><div><button disabled={busy || disabled || !onOpen} onClick={() => open(item.source.kind, item.source.id)}>{name(item.source.kind, item.source.id)}</button><span> · {item.label}</span>{item.note && <p className="knowledge-note">{item.note}</p>}</div></li>)}</ul> : <p className="profile-hint">暂无引用</p>}
  </section>
}
