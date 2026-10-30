import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KnowledgeLink, KnowledgeSnapshot } from '../../../shared/contracts/knowledge'
import type { ChapterSummary } from '../../../shared/contracts/novels'
import type { PlanningSnapshot } from '../../../shared/contracts/planning'
import { cardStatuses, foreshadowStatuses, outlineKinds } from '../../../shared/contracts/planning'
import type { Character, StoryBible, WorldEntry } from '../../../shared/contracts/story-bible'
import { characterFields, worldCategories } from '../../../shared/contracts/story-bible'
import { storyTimeline } from '../../../shared/domain/timeline'
import { ApiError } from '../../shared/api/client'
import { planningApi } from '../planning/api'
import { storyApi } from './api'
import { listenKnowledgeChanges, notifyKnowledgeChange } from './knowledge-events'
import './chapter-inspector.css'

interface Props {
  novelId: string
  chapterId: string
  chapters: ChapterSummary[]
  onBusy: (busy: boolean) => void
  onClose?: () => void
}
interface InspectorData { novelId: string; bible: StoryBible; knowledge: KnowledgeSnapshot; planning: PlanningSnapshot }
type Tab = 'characters' | 'world' | 'plot'
const tabs: { id: Tab; label: string }[] = [{ id: 'characters', label: '人物' }, { id: 'world', label: '世界观' }, { id: 'plot', label: '剧情' }]

// This component owns its queries and selection. Switching tabs never replaces the
// editor, touches a Tiptap transaction, or refetches the novel's reference data.
export function ChapterInspector({ novelId, chapterId, chapters, onBusy, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('characters')
  const [data, setData] = useState<InspectorData | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState<{ chapterId: string; kind: 'character' | 'world'; id: string } | null>(null)
  const [target, setTarget] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(false)
  const saving = useRef(false)
  const identity = useRef(novelId)
  const tabId = useId()
  useEffect(() => {
    identity.current = novelId
    alive.current = true
    let current = true
    Promise.all([storyApi.list(novelId), storyApi.links(novelId), planningApi.read(novelId)])
      .then(([bible, knowledge, planning]) => {
        if (!current) return
        setData(previous => ({ novelId, bible, planning, knowledge: previous?.novelId === novelId && previous.knowledge.version > knowledge.version ? previous.knowledge : knowledge }))
        setError(''); setConflict(false)
      }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : '无法读取章节关联资料') })
      .finally(() => { if (current) setRefreshing(false) })
    return () => { current = false; alive.current = false }
  }, [novelId, attempt])
  useEffect(() => listenKnowledgeChanges(novelId, knowledge => {
    setData(previous => previous?.novelId === novelId && previous.knowledge.version < knowledge.version ? { ...previous, knowledge } : previous)
  }), [novelId])
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saving.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const current = data?.novelId === novelId ? data : null
  const links = useMemo(() => current?.knowledge.links.filter(link => link.source.kind === 'chapter' && link.source.id === chapterId) ?? [], [current, chapterId])
  const people = useMemo(() => current?.bible.characters.filter(person => links.some(link => link.target.kind === 'character' && link.target.id === person.id)) ?? [], [current, links])
  const worlds = useMemo(() => current?.bible.world.filter(world => links.some(link => link.target.kind === 'world' && link.target.id === world.id)) ?? [], [current, links])
  const cards = useMemo(() => current?.planning.cards.filter(card => card.chapterIds.includes(chapterId)) ?? [], [current, chapterId])
  const outlines = useMemo(() => current?.planning.outlines.filter(outline => outline.chapterIds.includes(chapterId)) ?? [], [current, chapterId])
  const foreshadows = useMemo(() => current?.planning.foreshadows.filter(item => [...item.chapterIds, ...item.plantedChapterIds, ...item.plannedChapterIds, ...item.resolvedChapterIds].includes(chapterId) || item.cardIds.some(id => cards.some(card => card.id === id))) ?? [], [current, chapterId, cards])
  const plotlines = useMemo(() => current?.planning.plotlines.filter(line => cards.some(card => card.plotlineId === line.id)) ?? [], [current, cards])
  const events = useMemo(() => current ? storyTimeline(current.planning, current.bible, current.knowledge).filter(event => event.chapterIds.includes(chapterId)) : [], [current, chapterId])
  const selected = selection?.chapterId === chapterId ? selection : null
  const character = selected?.kind === 'character' ? current?.bible.characters.find(item => item.id === selected.id) : undefined
  const world = selected?.kind === 'world' ? current?.bible.world.find(item => item.id === selected.id) : undefined
  const count = tab === 'characters' ? people.length : tab === 'world' ? worlds.length : cards.length + foreshadows.length + outlines.length
  const linkKind = tab === 'characters' ? 'character' : 'world'
  const options = tab === 'characters' ? current?.bible.characters ?? [] : current?.bible.world ?? []
  const available = options.filter(item => !links.some(link => link.target.kind === linkKind && link.target.id === item.id))
  const blocked = busy || refreshing || conflict || !current
  async function save(nextLinks: KnowledgeLink[]) {
    if (!current || saving.current || blocked) return
    const expectedNovel = novelId
    saving.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const knowledge = await storyApi.saveLinks(novelId, { version: current.knowledge.version, links: nextLinks })
      notifyKnowledgeChange(novelId, knowledge)
      if (alive.current && identity.current === expectedNovel) {
        setData(previous => previous?.novelId === expectedNovel ? { ...previous, knowledge: previous.knowledge.version > knowledge.version ? previous.knowledge : knowledge } : previous)
        setTarget(''); setNotice('章节关联已保存')
      }
    } catch (reason) {
      if (alive.current && identity.current === expectedNovel) {
        setError(reason instanceof Error ? reason.message : '保存关联失败，请重试')
        if (reason instanceof ApiError && [400, 404, 409].includes(reason.status)) setConflict(true)
      }
    } finally { saving.current = false; if (alive.current) setBusy(false) }
  }
  const show = (kind: 'character' | 'world', id: string) => { setSelection({ chapterId, kind, id }); setTab(kind === 'character' ? 'characters' : 'world') }
  function changeTab(next: Tab) { setTab(next); setTarget('') }
  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    event.preventDefault(); changeTab(tabs[next].id)
    document.getElementById(`${tabId}-${tabs[next].id}`)?.focus()
  }
  return <aside className="chapter-inspector" aria-label="章节关联检查器" aria-busy={busy || refreshing}>
    <header className="inspector-heading"><div><span className="inspector-eyebrow">创作关联</span><h2>章节检查器</h2></div>{onClose && <button className="inspector-close" aria-label="收起关联检查器" onClick={onClose}>×</button>}</header>
    <p className="inspector-chapter">{chapters.find(chapter => chapter.id === chapterId)?.title ?? '当前章节'}</p>
    <div className="inspector-tabs" role="tablist" aria-label="章节关联类型">{tabs.map((item, index) => <button key={item.id} id={`${tabId}-${item.id}`} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls={`${tabId}-panel`} onKeyDown={event => tabKey(event, index)} onMouseDown={event => event.preventDefault()} onClick={() => changeTab(item.id)}>{item.label}</button>)}</div>
    <div className="inspector-content" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`}>
      <div className="inspector-section-heading"><h3>{tab === 'characters' ? '本章人物' : tab === 'world' ? '本章设定' : '本章剧情'} <span>{count}</span></h3><button disabled={busy || refreshing} onClick={() => { setRefreshing(true); setAttempt(value => value + 1) }}>刷新资料</button></div>
      {error && <p className="inspector-error" role="alert">{error}{conflict ? '。关联版本已变化，请刷新资料并核对，再手动重试。' : '。可刷新资料或重试操作。'}</p>}
      {refreshing && <p className="inspector-muted" role="status">正在读取关联资料…</p>}
      {notice && <p className="inspector-muted" role="status">{notice}</p>}
      {current && tab !== 'plot' && <>
        <ul className="inspector-links">{links.filter(link => link.target.kind === linkKind).map(link => {
          const record = options.find(item => item.id === link.target.id)
          return <li key={link.id}><button className="inspector-record" aria-label={`查看${tab === 'characters' ? '人物档案' : '世界观资料'} ${record?.name ?? '已删除资料'}`} onClick={() => show(link.target.kind, link.target.id)}><span className="inspector-avatar" aria-hidden="true">{record?.name.slice(0, 1) ?? '?'}</span><span><strong>{record?.name ?? '已删除资料'}</strong><small>{record && 'fields' in record ? record.fields.identity || record.category || '人物档案' : record && 'description' in record ? worldCategories[record.category] : link.label}</small></span><span aria-hidden="true">›</span></button><div className="inspector-link-meta"><span>{link.label}{link.note ? ` · ${link.note}` : ''}</span><button disabled={blocked} aria-label={`取消章节关联 ${record?.name ?? '已删除资料'}`} onClick={() => { if (window.confirm(`取消本章对“${record?.name ?? '已删除资料'}”的关联？正文与资料会保留，引用进入回收站。`)) void save(current.knowledge.links.filter(item => item.id !== link.id)) }}>取消关联</button></div></li>
        })}</ul>
        {!links.some(link => link.target.kind === linkKind) && <p className="inspector-empty">{tab === 'characters' ? '尚未关联人物。将出场人物加入本章，随写随查。' : '尚未关联世界观。关联地点、组织与世界规则，保持设定一致。'}</p>}
        <div className="inspector-add"><label htmlFor={`${tabId}-target`}>关联{tab === 'characters' ? '人物' : '设定'}</label><div><select id={`${tabId}-target`} aria-label={tab === 'characters' ? '选择章节关联人物' : '选择章节关联设定'} value={available.some(item => item.id === target) ? target : ''} disabled={blocked} onChange={event => setTarget(event.target.value)}><option value="">{available.length ? '选择已有资料…' : '暂无可关联资料'}</option>{available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={blocked || !available.some(item => item.id === target) || current.knowledge.links.length >= 1000} onClick={() => { void save([...current.knowledge.links, { id: crypto.randomUUID(), source: { kind: 'chapter', id: chapterId }, target: { kind: linkKind, id: target }, label: '章节关联', note: '' }]) }}>添加关联</button></div></div>
      </>}
      {current && tab === 'characters' && <>
        {character && <CharacterDetails person={character} bible={current.bible} onWorld={id => { show('world', id); setTab('world') }} />}
        <section className="inspector-graph-section" aria-label="章节人物关系"><h3>人物关系图</h3><RelationshipGraph people={people} bible={current.bible} onSelect={id => show('character', id)} /></section>
      </>}
      {current && tab === 'world' && world && <section className="inspector-profile" aria-label={`世界观资料 ${world.name}`}><span className="inspector-eyebrow">{worldCategories[world.category]}</span><h3>{world.name}</h3><p>{world.description || '暂无设定描述'}</p>{world.timeText && <p className="inspector-muted">故事时间 · {world.timeText}</p>}{!!world.tags.length && <p className="inspector-tags">{world.tags.join(' · ')}</p>}<WorldAssociations world={world} data={current} onOpen={show} /></section>}
      {current && tab === 'plot' && <div className="inspector-plot">
        {!count && !events.length && <p className="inspector-empty">本章尚无关联剧情。在故事大纲与时间线中将剧情卡片、伏笔或大纲绑定到本章，即会显示在这里。</p>}
        {plotlines.map(line => <details key={`line:${line.id}`} open><summary><span>{line.kind === 'main' ? '主线' : line.kind === 'subplot' ? '支线' : '剧情线'}</span>{line.title}</summary><p>{line.content || '暂无描述'}</p></details>)}
        {outlines.map(outline => <details key={`outline:${outline.id}`}><summary><span>{outlineKinds[outline.kind]}</span>{outline.title}</summary><p>{outline.content || '暂无描述'}</p></details>)}
        {cards.map(card => <details key={`card:${card.id}`} open><summary><span>剧情卡片</span>{card.title}</summary><small>{cardStatuses[card.status]}{card.storyTime && ` · ${card.storyTime}`}</small>{card.summary && <p>{card.summary}</p>}{card.content && <p>{card.content}</p>}</details>)}
        {foreshadows.map(item => <details key={`foreshadow:${item.id}`} open><summary><span>伏笔</span>{item.title}</summary><small>{foreshadowStatuses[item.status]} · {item.resolvedChapterIds.includes(chapterId) ? '本章回收' : item.plantedChapterIds.includes(chapterId) ? '本章埋设' : item.plannedChapterIds.includes(chapterId) ? '计划在本章回收' : '关联本章'}</small><p>{item.content || '暂无描述'}</p></details>)}
        {!!events.length && <section aria-label="本章时间线事件"><h3>相关时间线</h3><ol className="inspector-timeline">{events.map(event => <li key={`${event.source}:${event.id}`}><small>{event.storyTime || '未设定故事时间'}</small><strong>{event.title}</strong><p>{event.description}</p></li>)}</ol></section>}
      </div>}
    </div>
    <footer className="inspector-footer">资料关联单独保存 · 正文持续自动保存</footer>
  </aside>
}
function CharacterDetails({ person, bible, onWorld }: { person: Character; bible: StoryBible; onWorld: (id: string) => void }) {
  return <section className="inspector-profile" aria-label={`人物档案 ${person.name}`}><span className="inspector-eyebrow">人物档案</span><h3>{person.name}</h3>{person.category && <p className="inspector-muted">{person.category}</p>}<dl>{Object.entries(characterFields).map(([key, label]) => person.fields[key as keyof typeof characterFields] ? <div key={key}><dt>{label}</dt><dd>{person.fields[key as keyof typeof characterFields]}</dd></div> : null)}</dl>{!Object.values(person.fields).some(Boolean) && <p className="inspector-muted">暂无补充资料</p>}{!!person.tags.length && <p className="inspector-tags">{person.tags.join(' · ')}</p>}{person.worldIds.map(id => { const world = bible.world.find(item => item.id === id); return world ? <button key={id} className="inspector-inline-link" onClick={() => onWorld(id)}>查看设定 · {world.name} ›</button> : null })}</section>
}
function WorldAssociations({ world, data, onOpen }: { world: WorldEntry; data: InspectorData; onOpen: (kind: 'character' | 'world', id: string) => void }) {
  const related = data.knowledge.links.filter(link => link.source.kind === 'world' && link.source.id === world.id)
  return <>{related.map(link => { const name = (link.target.kind === 'world' ? data.bible.world : data.bible.characters).find(item => item.id === link.target.id)?.name; return name ? <button key={link.id} className="inspector-inline-link" onClick={() => onOpen(link.target.kind, link.target.id)}>{link.label} · {name} ›</button> : null })}</>
}
function RelationshipGraph({ people, bible, onSelect }: { people: Character[]; bible: StoryBible; onSelect: (id: string) => void }) {
  const markerId = useId().replace(/:/g, '')
  const ids = new Set(people.map(person => person.id))
  const edges = bible.characters.flatMap(person => person.relations.filter(relation => ids.has(person.id) || ids.has(relation.targetId)).map(relation => ({ source: person.id, target: relation.targetId, label: relation.kind })))
  const nodes = bible.characters.filter(person => ids.has(person.id) || edges.some(edge => edge.source === person.id || edge.target === person.id))
  const height = Math.max(220, nodes.length * 40)
  const position = (index: number) => ({ x: 140 + Math.cos(-Math.PI / 2 + index * 2 * Math.PI / nodes.length) * 93, y: height / 2 + Math.sin(-Math.PI / 2 + index * 2 * Math.PI / nodes.length) * (height / 2 - 44) })
  if (!people.length) return <p className="inspector-muted">关联人物后显示真实人物关系。</p>
  if (!edges.length) return <p className="inspector-muted">本章人物暂无关系记录。可在人物档案中建立关系。</p>
  return <><svg className="inspector-relationship-graph" role="img" aria-label="当前章节人物关系图" viewBox={`0 0 280 ${height}`}><defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="26" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill="currentColor" /></marker></defs>{edges.map((edge, index) => { const from = nodes.findIndex(node => node.id === edge.source), to = nodes.findIndex(node => node.id === edge.target); if (from < 0 || to < 0) return null; const a = position(from), b = position(to); return <g key={`${edge.source}:${edge.target}:${index}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd={`url(#${markerId})`} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} className="inspector-edge-label">{edge.label}</text></g> })}{nodes.map((node, index) => { const p = position(index); return <g key={node.id} transform={`translate(${p.x},${p.y})`}><circle r="22" className={ids.has(node.id) ? 'is-linked' : ''} /><text y="4">{node.name.slice(0, 4)}</text><title>{node.name}</title></g> })}</svg><ul className="inspector-relations">{edges.map((edge, index) => <li key={`${edge.source}:${edge.target}:${index}`}><button onClick={() => onSelect(edge.source)}>{bible.characters.find(person => person.id === edge.source)?.name ?? '已删除人物'}</button><span> → {edge.label} → </span><button onClick={() => onSelect(edge.target)}>{bible.characters.find(person => person.id === edge.target)?.name ?? '已删除人物'}</button></li>)}</ul></>
}
