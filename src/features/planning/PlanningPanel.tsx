import { AiPlanning } from '../ai/AiPlanning'
import { validatePlanning } from '../../../shared/domain/planning'
import { useEffect, useRef, useState } from 'react'
import { cardStatuses, foreshadowStatuses, outlineKinds, type PlanningSnapshot, type Outline, type PlotCard, type Plotline, type Foreshadow } from '../../../shared/contracts/planning'
import type { ChapterSummary } from '../../../shared/contracts/novels'
import { DraftNotice } from '../../shared/drafts/DraftNotice'
import { useDraftProtection } from '../../shared/drafts/useDraftProtection'
import { fingerprint, persistLocalDraft, readLocalDrafts } from '../../shared/drafts/store'
import { planningApi } from './api'
import { PlanningAutosave, type PlanningSaveStatus } from './autosave'
import { clearDraft, downloadDraft, readDraft } from './drafts'
import './planning.css'
import { storyApi } from '../story-bible/api'
import type { StoryBible } from '../../../shared/contracts/story-bible'
import type { KnowledgeSnapshot } from '../../../shared/contracts/knowledge'
import type { OpenMaterial } from '../story-bible/KnowledgeLinks'
import { StoryTimeline } from './StoryTimeline'
import { assertPlanningRecovery } from './recovery'
import { serviceGeneration } from '../../shared/api/client'
import type { SearchHit } from '../../../shared/contracts/search'

type Section = 'outlines' | 'plotlines' | 'cards' | 'foreshadows'
type Entry = Outline | Plotline | PlotCard | Foreshadow
const labels: Record<Section, string> = { outlines: '小说大纲', plotlines: '剧情线', cards: '剧情卡片', foreshadows: '伏笔管理' }
const statusLabels: Record<PlanningSaveStatus, string> = { saved: '已保存到数据库', pending: '等待保存', saving: '保存中…', failed: '保存失败 · 草稿已保留', conflict: '版本冲突 · 草稿已保留' }

export function PlanningPanel({ novelId, chapters, onBack, onDirty, initialSelection, onOpen }: { onOpen?: OpenMaterial; initialSelection?: SearchHit | null; novelId: string; chapters: ChapterSummary[]; onBack: () => void; onDirty: (dirty: boolean) => void }) {
  const [loaded, setLoaded] = useState<{ snapshot: PlanningSnapshot } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [focusAi, setFocusAi] = useState(false)
  useEffect(() => {
    let active = true
    planningApi.read(novelId).then(async snapshot => {
      const draft = readDraft(novelId)
      if (draft) {
        await persistLocalDraft({ schema: 1, revision: 0, id: `legacy-planning:${novelId}`, token: fingerprint(draft.snapshot), key: `planning:${novelId}`, updatedAt: new Date().toISOString(), base: fingerprint(draft.snapshot), generation: draft.generation, value: draft.snapshot })
        clearDraft(novelId)
      }
      if (active) setLoaded({ snapshot })
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '加载规划失败') })
    return () => { active = false }
  }, [novelId, attempt])
  if (!loaded) return <section className="planning-panel"><button onClick={onBack}>返回写作</button>{error ? <div role="alert">{error}<button onClick={() => { void (async () => { try { const drafts = await readLocalDrafts<PlanningSnapshot>(`planning:${novelId}`); if (drafts.length) { for (const draft of drafts) downloadDraft(draft.value) } else { const legacy = readDraft(novelId); if (legacy) downloadDraft(legacy.snapshot); else setError('此作品没有本机草稿') } } catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取本机草稿') } })() }}>导出本机规划草稿</button><button onClick={() => { setError(''); setAttempt(value => value + 1) }}>重试加载</button></div> : <p role="status">正在加载创作规划…</p>}</section>
  return <PlanningEditor key={`${novelId}:${attempt}`} initial={loaded.snapshot} focusAi={focusAi} initialSelection={initialSelection} onOpen={onOpen} chapters={chapters} onBack={onBack} onDirty={onDirty} onReload={focus => { setFocusAi(!!focus); setLoaded(null); setAttempt(value => value + 1) }} />
}
function PlanningEditor({ initial, focusAi, chapters, onBack, onReload, onDirty, initialSelection, onOpen }: { onOpen?: OpenMaterial; initialSelection?: SearchHit | null; initial: PlanningSnapshot; focusAi: boolean; chapters: ChapterSummary[]; onBack: () => void; onReload: (focusAi?: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const draft = useDraftProtection(`planning:${initial.novelId}`, initial)
  const { protection } = draft
  const [snapshot, setSnapshot] = useState(initial)
  const [materials, setMaterials] = useState<{ bible: StoryBible; knowledge: KnowledgeSnapshot } | null>(null)
  const [materialError, setMaterialError] = useState('')
  const [materialAttempt, setMaterialAttempt] = useState(0)
  const [showTimeline, setShowTimeline] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([storyApi.list(initial.novelId), storyApi.links(initial.novelId)]).then(([bible, knowledge]) => {
      if (active) { setMaterials({ bible, knowledge }); setMaterialError('') }
    }).catch(reason => { if (active) setMaterialError(reason instanceof Error ? reason.message : '读取资料失败') })
    return () => { active = false }
  }, [initial.novelId, materialAttempt])
  const [section, setSection] = useState<Section>(initialSelection && ['outlines', 'plotlines', 'cards', 'foreshadows'].includes(initialSelection.kind) ? initialSelection.kind as Section : 'outlines')
  const [selected, setSelected] = useState<string | null>(initialSelection?.id ?? null)
  const [status, setStatus] = useState<PlanningSaveStatus>('saved')
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [search, setSearch] = useState('')
  const [line, setLine] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [unresolved, setUnresolved] = useState(false)
  const [view, setView] = useState('cards')
  const [timeline, setTimeline] = useState(false)
  const aiSaved = useRef(false)
  const saver = useRef<PlanningAutosave | null>(null)
  const dirty = useRef(false)
  useEffect(() => {
    let mounted = true
    onDirty(false)
    const controller = new PlanningAutosave(initial, {
      save: async value => { const saved = await planningApi.save(value.novelId, value.version, value); void protection.saved(value); return saved },
      draft: () => {},
      status: (value, message) => { if (mounted) { dirty.current = value !== 'saved'; onDirty(dirty.current); setStatus(value); setError(message ?? '') } },
      version: version => { if (mounted) setSnapshot(value => ({ ...value, version })) },
    })
    saver.current = controller
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { mounted = false; controller.dispose(); window.removeEventListener('beforeunload', unload) }
  }, [initial, onDirty, protection])
  function change(next: PlanningSnapshot) { dirty.current = true; onDirty(true); setSnapshot(next); protection.change(next); saver.current?.change(next) }
  function update(patch: Partial<Entry>) {
    const old = snapshot[section].find(row => row.id === selected)
    if (old) {
      const before = old as unknown as Record<string, unknown>, after = patch as Record<string, unknown>
      const removing = Object.entries(after).some(([key, value]) => Array.isArray(before[key]) && Array.isArray(value) ? (before[key] as string[]).some(id => !value.includes(id)) : ['parentId', 'plotlineId'].includes(key) && before[key] && before[key] !== value)
      if (removing && !window.confirm(`解除规划“${old.title}”的原关联？不删除目标对象，保存后原关联进入回收站保留 30 天。`)) return
    }
    change({ ...snapshot, [section]: snapshot[section].map(row => row.id === selected ? { ...row, ...patch } : row) })
  }
  function add(target = section) {
    setSection(target); setShowTimeline(false)
    const base = { id: crypto.randomUUID(), title: target === 'outlines' ? '新大纲' : target === 'plotlines' ? '新剧情线' : target === 'cards' ? '新剧情卡片' : '新伏笔', content: '' }
    const entry: Entry = target === 'outlines' ? { ...base, kind: 'overall', parentId: null, chapterIds: [] }
      : target === 'plotlines' ? { ...base, kind: 'custom' }
      : target === 'cards' ? { ...base, summary: '', status: 'idea', plotlineId: null, storyTime: '', timeOrder: null, chapterIds: [] }
      : { ...base, status: 'unplanted', plantedChapterIds: [], plannedChapterIds: [], resolvedChapterIds: [], chapterIds: [], cardIds: [] }
    change({ ...snapshot, [target]: [...snapshot[target], entry] }); setSelected(entry.id); setSearch(''); setFilterStatus(''); setLine(''); setUnresolved(false)
  }
  function remove() {
    if (!selected || !window.confirm(`删除规划“${snapshot[section].find(row => row.id === selected)?.title}”？大纲子项将提升一级，其他引用将解除。保存后进入回收站保留 30 天。`)) return
    const outline = snapshot.outlines.find(row => row.id === selected)
    const next = { ...snapshot, [section]: snapshot[section].filter(row => row.id !== selected) }
    next.outlines = next.outlines.map(row => row.parentId === selected ? { ...row, parentId: outline?.parentId ?? null } : row)
    next.cards = next.cards.map(row => row.plotlineId === selected ? { ...row, plotlineId: null } : row)
    next.foreshadows = next.foreshadows.map(row => ({ ...row, cardIds: row.cardIds.filter(id => id !== selected) }))
    change(next); setSelected(null)
  }
  function move(id: string, direction: number) {
    const rows = [...snapshot[section]], source = rows.findIndex(row => row.id === id)
    const peers = rows.filter(row => section !== 'outlines' || (row as Outline).parentId === (rows[source] as Outline).parentId)
    const target = peers[peers.findIndex(row => row.id === id) + direction]
    if (!target) return
    const index = rows.indexOf(target); [rows[source], rows[index]] = [rows[index], rows[source]]
    change({ ...snapshot, [section]: rows })
  }
  const current = snapshot[section].find(row => row.id === selected)
  const descendants = new Set<string>()
  function visit(id: string) { for (const row of snapshot.outlines) if (row.parentId === id && !descendants.has(row.id)) { descendants.add(row.id); visit(row.id) } }
  if (section === 'outlines' && selected) { descendants.add(selected); visit(selected) }
  function depth(row: Outline): number { const parent = snapshot.outlines.find(item => item.id === row.parentId); return parent ? 1 + depth(parent) : 0 }
  function tree(parent: string | null): Outline[] { return snapshot.outlines.filter(row => row.parentId === parent).flatMap(row => [row, ...tree(row.id)]) }
  let rows: Entry[] = section === 'outlines' ? tree(null) : [...snapshot[section]]
  rows = rows.filter(row => `${row.title} ${row.content} ${'summary' in row ? row.summary : ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .filter(row => section !== 'cards' || ((!line || (row as PlotCard).plotlineId === line) && (!filterStatus || (row as PlotCard).status === filterStatus)))
    .filter(row => section !== 'foreshadows' || ((!unresolved || (row as Foreshadow).status !== 'resolved') && (!filterStatus || (row as Foreshadow).status === filterStatus)))
  if (section === 'cards' && timeline) rows.sort((a, b) => ((a as PlotCard).timeOrder ?? Infinity) - ((b as PlotCard).timeOrder ?? Infinity))
  const unresolvedCount = snapshot.foreshadows.filter(row => row.status !== 'resolved').length
  const reminderCount = snapshot.foreshadows.filter(row => row.status !== 'resolved' && row.plannedChapterIds.length > 0).length
  return <section className="planning-panel" aria-label="创作规划" onCompositionStart={() => saver.current?.composition(true)} onCompositionEnd={() => saver.current?.composition(false)}>
    <div className="planning-top"><button disabled={status !== 'saved'} onClick={onBack}>返回写作</button><h2>剧情大纲与故事时间线</h2><span role="status" className={`planning-status ${status}`}>{statusLabels[status]}</span><button onClick={() => downloadDraft(snapshot)}>导出规划草稿</button><button disabled={status === 'saving' || status === 'conflict'} onClick={() => { void saver.current?.flush() }}>立即保存</button></div>
    <AiPlanning autoFocus={focusAi} novelId={initial.novelId} chapters={chapters} disabled={status !== 'saved' || draft.blocked} onSaved={() => { aiSaved.current = true }} onClose={() => { if (aiSaved.current) { aiSaved.current = false; onReload(true) } }} />
    <DraftNotice draft={draft} onRestore={(value, source) => { validatePlanning(value, true); assertPlanningRecovery(snapshot, source, serviceGeneration()); change({ ...value, novelId: initial.novelId, version: snapshot.version }) }} />
    {(error || storageError) && <div className="planning-error" role="alert">{error || storageError}{status === 'failed' && <button onClick={() => { void saver.current?.flush() }}>重试保存规划</button>}</div>}
    <button className="planning-reload" disabled={status === 'saving'} onClick={() => { if (dirty.current && !window.confirm('重新加载将放弃本机规划草稿。请先导出草稿，确认继续？')) return; void protection.discardWorking().then(() => { onDirty(false); onReload() }).catch(() => setStorageError('无法清除本机草稿，请检查浏览器存储设置。')) }}>重新加载规划</button>
    <fieldset className="draft-editing-scope" disabled={draft.blocked}>
    <nav className="planning-tabs" aria-label="规划模块">{(Object.keys(labels) as Section[]).map(key => <button key={key} aria-pressed={!showTimeline && section === key} onClick={() => { setShowTimeline(false); setSection(key); setSelected(null); setSearch(''); setLine(''); setFilterStatus('') }}>{labels[key]}（{snapshot[key].length}）</button>)}<button aria-pressed={showTimeline} onClick={() => setShowTimeline(true)}>故事时间线</button></nav>
    <p className="planning-reminders">伏笔共 {snapshot.foreshadows.length} 项 · 未回收 {unresolvedCount} 项 · 已回收 {snapshot.foreshadows.length - unresolvedCount} 项。{reminderCount > 0 && `提醒：${reminderCount} 项已安排回收章节，尚未回收。`}</p>
    {materialError && <p role="alert">资料加载失败：{materialError}<button onClick={() => setMaterialAttempt(value => value + 1)}>重试加载资料</button></p>}
    {showTimeline ? materials ? <StoryTimeline snapshot={snapshot} bible={materials.bible} knowledge={materials.knowledge} chapters={chapters} disabled={status !== 'saved'} onOpen={onOpen} onCard={id => { setSection('cards'); setSelected(id); setSearch(''); setLine(''); setFilterStatus(''); setShowTimeline(false) }} onCreate={() => add('cards')} /> : <p role="status">正在加载时间线资料…</p> : <>
    <div className="planning-tools"><button className="primary" onClick={() => add()}>新建{labels[section] === '伏笔管理' ? '伏笔' : labels[section] === '小说大纲' ? '大纲' : labels[section]}</button><input aria-label="搜索规划" placeholder="搜索标题、摘要或内容" value={search} onChange={event => setSearch(event.target.value)} />
      {section === 'cards' && <><select aria-label="筛选剧情线" value={line} onChange={event => setLine(event.target.value)}><option value="">全部剧情线</option>{snapshot.plotlines.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select><select aria-label="剧情视图" value={view} onChange={event => setView(event.target.value)}><option value="cards">卡片视图</option><option value="list">列表视图</option></select><label><input type="checkbox" checked={timeline} onChange={event => setTimeline(event.target.checked)} />按故事内部时间排序</label></>}
      {(section === 'cards' || section === 'foreshadows') && <select aria-label="筛选状态" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(section === 'cards' ? cardStatuses : foreshadowStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
      {section === 'foreshadows' && <label><input type="checkbox" checked={unresolved} onChange={event => setUnresolved(event.target.checked)} />仅看未回收伏笔</label>}
    </div>
    <div className="planning-layout"><div className={`planning-items ${section === 'cards' && view === 'cards' ? 'card-grid' : ''}`} aria-label={labels[section]}>
      {!rows.length && <div className="planning-empty">{snapshot[section].length ? '没有符合筛选条件的规划。' : '还没有规划，从一个灵感开始。'}</div>}
      {rows.map(row => <article key={row.id} className={selected === row.id ? 'selected' : ''} style={section === 'outlines' ? { marginLeft: Math.min(depth(row as Outline), 8) * 12 } : undefined}>
        <button className="planning-select" onClick={() => setSelected(row.id)} aria-pressed={selected === row.id}><strong>{row.title || '未命名'}</strong><small>{section === 'outlines' ? `${outlineKinds[(row as Outline).kind]} · 第 ${depth(row as Outline) + 1} 层` : section === 'cards' ? `${cardStatuses[(row as PlotCard).status]} · ${(row as PlotCard).storyTime || '未设定故事时间'}` : section === 'foreshadows' ? foreshadowStatuses[(row as Foreshadow).status] : ({ main: '主线', subplot: '支线', custom: '自定义' }[(row as Plotline).kind])}</small>{section === 'cards' && <span>{(row as PlotCard).summary || '暂无摘要'}</span>}</button>
        <div className="planning-order"><button aria-label={`上移规划 ${row.title}`} disabled={!!search || !!line || !!filterStatus || (section === 'cards' && timeline)} onClick={() => move(row.id, -1)}>↑</button><button aria-label={`下移规划 ${row.title}`} disabled={!!search || !!line || !!filterStatus || (section === 'cards' && timeline)} onClick={() => move(row.id, 1)}>↓</button></div>
      </article>)}
    </div><div className="planning-form">{current ? <>
      <label>规划标题<input maxLength={200} value={current.title} onChange={event => update({ title: event.target.value })} /></label>
      {section === 'outlines' && <><label>大纲类型<select value={(current as Outline).kind} onChange={event => update({ kind: event.target.value as Outline['kind'] })}>{Object.entries(outlineKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>上级大纲<select value={(current as Outline).parentId ?? ''} onChange={event => update({ parentId: event.target.value || null })}><option value="">无（顶层）</option>{snapshot.outlines.filter(row => !descendants.has(row.id)).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label></>}
      {section === 'plotlines' && <label>剧情线类型<select value={(current as Plotline).kind} onChange={event => update({ kind: event.target.value as Plotline['kind'] })}><option value="main">主线</option><option value="subplot">支线</option><option value="custom">自定义</option></select></label>}
      {section === 'cards' && <><label>摘要<textarea maxLength={4000} value={(current as PlotCard).summary} onChange={event => update({ summary: event.target.value })} /></label><label>所属剧情线<select value={(current as PlotCard).plotlineId ?? ''} onChange={event => update({ plotlineId: event.target.value || null })}><option value="">未分配</option>{snapshot.plotlines.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label>故事内部时间<input maxLength={200} placeholder="例如：天启三年冬" value={(current as PlotCard).storyTime} onChange={event => update({ storyTime: event.target.value })} /></label><label>故事时间序号<input type="number" min={-1e9} max={1e9} step={1} placeholder="数字越小越早，留空排在末尾" value={(current as PlotCard).timeOrder ?? ''} onChange={event => update({ timeOrder: event.target.value === '' ? null : Number(event.target.value) })} /></label></>}
      {(section === 'cards' || section === 'foreshadows') && <label>规划状态<select value={(current as PlotCard | Foreshadow).status} onChange={event => update({ status: event.target.value as PlotCard['status'] | Foreshadow['status'] })}>{Object.entries(section === 'cards' ? cardStatuses : foreshadowStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      <label>详细内容<textarea className="planning-content" maxLength={100000} value={current.content} onChange={event => update({ content: event.target.value })} /></label>
      {section !== 'plotlines' && <ChapterLinks label="关联章节" chapters={chapters} values={(current as Foreshadow).chapterIds} onChange={values => update({ chapterIds: values })} />}
      {(section === 'outlines' || section === 'cards') && (materials ? <>
        <MaterialLinks label={section === 'cards' ? '参与人物' : '关联人物'} entries={materials.bible.characters} values={(current as Outline | PlotCard).characterIds ?? []} onChange={characterIds => update({ characterIds })} onOpen={onOpen ? id => onOpen('characters', id) : undefined} disabled={status !== 'saved'} />
        <MaterialLinks label="关联地点" entries={materials.bible.world.filter(row => row.category === 'location')} values={(current as Outline | PlotCard).worldIds ?? []} onChange={values => update({ worldIds: [...(current as Outline | PlotCard).worldIds?.filter(id => materials.bible.world.some(row => row.id === id && row.category !== 'location')) ?? [], ...values] })} onOpen={onOpen ? id => onOpen('world', id) : undefined} disabled={status !== 'saved'} knownIds={materials.bible.world.map(row => row.id)} />
        <MaterialLinks label="其他关联资料" entries={materials.bible.world.filter(row => row.category !== 'location')} values={(current as Outline | PlotCard).worldIds ?? []} onChange={values => update({ worldIds: [...(current as Outline | PlotCard).worldIds?.filter(id => materials.bible.world.some(row => row.id === id && row.category === 'location')) ?? [], ...values] })} onOpen={onOpen ? id => onOpen('world', id) : undefined} disabled={status !== 'saved'} knownIds={materials.bible.world.map(row => row.id)} />
      </> : <p>资料尚未加载，已有引用会保留。</p>)}
      {section === 'foreshadows' && <>{<ChapterLinks label="埋设章节" chapters={chapters} values={(current as Foreshadow).plantedChapterIds} onChange={values => update({ plantedChapterIds: values })} />}{<ChapterLinks label="计划回收章节" chapters={chapters} values={(current as Foreshadow).plannedChapterIds} onChange={values => update({ plannedChapterIds: values })} />}{<ChapterLinks label="实际回收章节" chapters={chapters} values={(current as Foreshadow).resolvedChapterIds} onChange={values => update({ resolvedChapterIds: values })} />}<fieldset className="planning-links"><legend>关联剧情卡片</legend>{!snapshot.cards.length && <small>暂无剧情卡片</small>}{snapshot.cards.map(card => <label key={card.id}><input type="checkbox" checked={(current as Foreshadow).cardIds.includes(card.id)} onChange={event => update({ cardIds: event.target.checked ? [...(current as Foreshadow).cardIds, card.id] : (current as Foreshadow).cardIds.filter(id => id !== card.id) })} />{card.title}</label>)}</fieldset>{(current as Foreshadow).status === 'resolved' && !(current as Foreshadow).resolvedChapterIds.length && <p className="planning-warning">已回收，但尚未记录实际回收章节，请补充。</p>}</>}
      <details className="delete-menu"><summary>···</summary><button className="danger" onClick={remove}>删除当前规划</button></details>
    </> : <div className="planning-empty">选择一个规划进行编辑，修改后会自动保存。</div>}</div></div></>}
    </fieldset>
  </section>
}

function ChapterLinks({ label, chapters, values, onChange }: { label: string; chapters: ChapterSummary[]; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="planning-links"><legend>{label}</legend>{!chapters.length && <small>暂无章节，请返回写作创建章节。</small>}{chapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={values.includes(chapter.id)} onChange={event => onChange(event.target.checked ? [...values, chapter.id] : values.filter(id => id !== chapter.id))} />{chapter.title}</label>)}{values.filter(id => !chapters.some(chapter => chapter.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => onChange(values.filter(value => value !== id))} />已删除或不可用的章节（取消以解除关联）</label>)}</fieldset>
}

function MaterialLinks({ label, entries, values, onChange, onOpen, disabled, knownIds = entries.map(row => row.id) }: {
  label: string; entries: { id: string; name: string }[]; values: string[]; onChange: (ids: string[]) => void
  onOpen?: (id: string) => void; disabled: boolean; knownIds?: string[]
}) {
  // Keep only this group's IDs when editing; callers preserve the other world categories.
  const group = values.filter(id => entries.some(row => row.id === id) || !knownIds.includes(id))
  return <fieldset className="planning-links"><legend>{label}</legend>
    {!entries.length && <small>暂无资料，请到创作资料库创建。</small>}
    {entries.map(row => <div className="planning-material" key={row.id}><label><input type="checkbox" checked={values.includes(row.id)} onChange={event => onChange(event.target.checked ? [...group, row.id] : group.filter(id => id !== row.id))} />{row.name}</label>{values.includes(row.id) && onOpen && <button disabled={disabled} onClick={() => onOpen(row.id)} aria-label={`查阅资料 ${row.name}`}>查阅</button>}</div>)}
    {group.filter(id => !knownIds.includes(id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => onChange(group.filter(value => value !== id))} />资料已删除或不可用（取消以解除关联）</label>)}
  </fieldset>
}
