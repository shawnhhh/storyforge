import { useEffect, useRef, useState } from 'react'
import { cardStatuses, foreshadowStatuses, outlineKinds, type PlanningSnapshot, type Outline, type PlotCard, type Plotline, type Foreshadow } from '../../../shared/contracts/planning'
import type { ChapterSummary } from '../../../shared/contracts/novels'
import { serviceGeneration } from '../../shared/api/client'
import { planningApi } from './api'
import { PlanningAutosave, type PlanningSaveStatus } from './autosave'
import { clearDraft, downloadDraft, readDraft, writeDraft } from './drafts'
import './planning.css'
import type { SearchHit } from '../../../shared/contracts/search'

type Section = 'outlines' | 'plotlines' | 'cards' | 'foreshadows'
type Entry = Outline | Plotline | PlotCard | Foreshadow
const labels: Record<Section, string> = { outlines: '小说大纲', plotlines: '剧情线', cards: '剧情卡片', foreshadows: '伏笔管理' }
const statusLabels: Record<PlanningSaveStatus, string> = { saved: '已保存', pending: '等待保存', saving: '保存中…', failed: '保存失败 · 草稿已保留', conflict: '版本冲突 · 草稿已保留' }

export function PlanningPanel({ novelId, chapters, onBack, onDirty, initialSelection }: { initialSelection?: SearchHit | null; novelId: string; chapters: ChapterSummary[]; onBack: () => void; onDirty: (dirty: boolean) => void }) {
  const [loaded, setLoaded] = useState<{ snapshot: PlanningSnapshot; restored: boolean; paused: boolean } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    planningApi.read(novelId).then(snapshot => {
      const draft = readDraft(novelId)
      if (active) setLoaded({ snapshot: draft?.snapshot ?? snapshot, restored: !!draft, paused: !!draft && (draft.snapshot.version !== snapshot.version || draft.generation !== serviceGeneration()) })
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '加载规划失败') })
    return () => { active = false }
  }, [novelId, attempt])
  if (!loaded) return <section className="planning-panel"><button onClick={onBack}>返回写作</button>{error ? <div role="alert">{error}<button onClick={() => { try { const draft = readDraft(novelId); if (draft) downloadDraft(draft.snapshot); else setError('此作品没有本机草稿') } catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取本机草稿') } }}>导出本机规划草稿</button><button onClick={() => { setError(''); setAttempt(value => value + 1) }}>重试加载</button></div> : <p role="status">正在加载创作规划…</p>}</section>
  return <PlanningEditor key={`${novelId}:${attempt}`} initial={loaded.snapshot} initialSelection={initialSelection} restored={loaded.restored} paused={loaded.paused} chapters={chapters} onBack={onBack} onDirty={onDirty} onReload={() => { setLoaded(null); setAttempt(value => value + 1) }} />
}
function PlanningEditor({ initial, restored, paused, chapters, onBack, onReload, onDirty, initialSelection }: { initialSelection?: SearchHit | null; initial: PlanningSnapshot; restored: boolean; paused: boolean; chapters: ChapterSummary[]; onBack: () => void; onReload: () => void; onDirty: (dirty: boolean) => void }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [section, setSection] = useState<Section>(initialSelection && ['outlines', 'plotlines', 'cards', 'foreshadows'].includes(initialSelection.kind) ? initialSelection.kind as Section : 'outlines')
  const [selected, setSelected] = useState<string | null>(initialSelection?.id ?? null)
  const [status, setStatus] = useState<PlanningSaveStatus>(paused ? 'conflict' : restored ? 'pending' : 'saved')
  const [error, setError] = useState(paused ? '已恢复本机草稿，但服务端版本或服务会话已变化。请先导出草稿，再重新加载并核对。' : '')
  const [storageError, setStorageError] = useState('')
  const [search, setSearch] = useState('')
  const [line, setLine] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [unresolved, setUnresolved] = useState(false)
  const [view, setView] = useState('cards')
  const [timeline, setTimeline] = useState(false)
  const saver = useRef<PlanningAutosave | null>(null)
  const dirty = useRef(restored)
  useEffect(() => {
    let mounted = true
    onDirty(restored)
    const controller = new PlanningAutosave(initial, {
      save: value => planningApi.save(value.novelId, value.version, value),
      draft: value => {
        try { if (value) writeDraft({ snapshot: value, generation: serviceGeneration() }); else clearDraft(initial.novelId); if (mounted) setStorageError('') }
        catch { if (mounted) setStorageError('本机草稿存储失败（可能空间不足），请保持页面打开并导出草稿。') }
      },
      status: (value, message) => { if (mounted) { dirty.current = value !== 'saved'; onDirty(dirty.current); setStatus(value); setError(message ?? '') } },
      version: version => { if (mounted) setSnapshot(value => ({ ...value, version })) },
    }, paused)
    saver.current = controller
    if (restored && !paused) controller.change(initial)
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { mounted = false; controller.dispose(); window.removeEventListener('beforeunload', unload) }
  }, [initial, paused, restored, onDirty])
  function change(next: PlanningSnapshot) { dirty.current = true; onDirty(true); setSnapshot(next); saver.current?.change(next) }
  function update(patch: Partial<Entry>) {
    change({ ...snapshot, [section]: snapshot[section].map(row => row.id === selected ? { ...row, ...patch } : row) })
  }
  function add() {
    const base = { id: crypto.randomUUID(), title: section === 'outlines' ? '新大纲' : section === 'plotlines' ? '新剧情线' : section === 'cards' ? '新剧情卡片' : '新伏笔', content: '' }
    const entry: Entry = section === 'outlines' ? { ...base, kind: 'overall', parentId: null, chapterIds: [] }
      : section === 'plotlines' ? { ...base, kind: 'custom' }
      : section === 'cards' ? { ...base, summary: '', status: 'idea', plotlineId: null, storyTime: '', timeOrder: null, chapterIds: [] }
      : { ...base, status: 'unplanted', plantedChapterIds: [], plannedChapterIds: [], resolvedChapterIds: [], chapterIds: [], cardIds: [] }
    change({ ...snapshot, [section]: [...snapshot[section], entry] }); setSelected(entry.id); setSearch(''); setFilterStatus(''); setLine(''); setUnresolved(false)
  }
  function remove() {
    if (!selected || !window.confirm('删除当前规划？大纲子项将提升一级，其他引用将解除。')) return
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
    <div className="planning-top"><button disabled={status !== 'saved'} onClick={onBack}>返回写作</button><h2>大纲与剧情规划</h2><span role="status" className={`planning-status ${status}`}>{statusLabels[status]}</span><button onClick={() => downloadDraft(snapshot)}>导出规划草稿</button><button disabled={status === 'saving' || status === 'conflict'} onClick={() => { void saver.current?.flush() }}>立即保存</button></div>
    {restored && <p className="backup-note">已恢复本机未保存草稿。</p>}
    {(error || storageError) && <div className="planning-error" role="alert">{error || storageError}{status === 'failed' && <button onClick={() => { void saver.current?.flush() }}>重试保存规划</button>}</div>}
    <button className="planning-reload" disabled={status === 'saving'} onClick={() => { if (dirty.current && !window.confirm('重新加载将放弃本机规划草稿。请先导出草稿，确认继续？')) return; try { clearDraft(snapshot.novelId); onDirty(false); onReload() } catch { setStorageError('无法清除本机草稿，请检查浏览器存储设置。') } }}>重新加载规划</button>
    <nav className="planning-tabs" aria-label="规划模块">{(Object.keys(labels) as Section[]).map(key => <button key={key} aria-pressed={section === key} onClick={() => { setSection(key); setSelected(null); setSearch(''); setLine(''); setFilterStatus('') }}>{labels[key]}（{snapshot[key].length}）</button>)}</nav>
    <p className="planning-reminders">伏笔共 {snapshot.foreshadows.length} 项 · 未回收 {unresolvedCount} 项 · 已回收 {snapshot.foreshadows.length - unresolvedCount} 项。{reminderCount > 0 && `提醒：${reminderCount} 项已安排回收章节，尚未回收。`}</p>
    <div className="planning-tools"><button className="primary" onClick={add}>新建{labels[section] === '伏笔管理' ? '伏笔' : labels[section] === '小说大纲' ? '大纲' : labels[section]}</button><input aria-label="搜索规划" placeholder="搜索标题、摘要或内容" value={search} onChange={event => setSearch(event.target.value)} />
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
      {section === 'foreshadows' && <>{<ChapterLinks label="埋设章节" chapters={chapters} values={(current as Foreshadow).plantedChapterIds} onChange={values => update({ plantedChapterIds: values })} />}{<ChapterLinks label="计划回收章节" chapters={chapters} values={(current as Foreshadow).plannedChapterIds} onChange={values => update({ plannedChapterIds: values })} />}{<ChapterLinks label="实际回收章节" chapters={chapters} values={(current as Foreshadow).resolvedChapterIds} onChange={values => update({ resolvedChapterIds: values })} />}<fieldset className="planning-links"><legend>关联剧情卡片</legend>{!snapshot.cards.length && <small>暂无剧情卡片</small>}{snapshot.cards.map(card => <label key={card.id}><input type="checkbox" checked={(current as Foreshadow).cardIds.includes(card.id)} onChange={event => update({ cardIds: event.target.checked ? [...(current as Foreshadow).cardIds, card.id] : (current as Foreshadow).cardIds.filter(id => id !== card.id) })} />{card.title}</label>)}</fieldset>{(current as Foreshadow).status === 'resolved' && !(current as Foreshadow).resolvedChapterIds.length && <p className="planning-warning">已回收，但尚未记录实际回收章节，请补充。</p>}</>}
      <button className="danger" onClick={remove}>删除当前规划</button>
    </> : <div className="planning-empty">选择一个规划进行编辑，修改后会自动保存。</div>}</div></div>
  </section>
}

function ChapterLinks({ label, chapters, values, onChange }: { label: string; chapters: ChapterSummary[]; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="planning-links"><legend>{label}</legend>{!chapters.length && <small>暂无章节，请返回写作创建章节。</small>}{chapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={values.includes(chapter.id)} onChange={event => onChange(event.target.checked ? [...values, chapter.id] : values.filter(id => id !== chapter.id))} />{chapter.title}</label>)}{values.filter(id => !chapters.some(chapter => chapter.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => onChange(values.filter(value => value !== id))} />已删除或不可用的章节（取消以解除关联）</label>)}</fieldset>
}
