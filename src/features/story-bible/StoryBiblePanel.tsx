import type { ChapterSummary } from '../../../shared/contracts/novels.js'
import { KnowledgeLinks, type OpenMaterial } from './KnowledgeLinks.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { worldCategories, type Character, type WorldEntry, type StoryBible, type WorldCategory } from '../../../shared/contracts/story-bible.js'
import { storyApi } from './api.js'
import { CharacterEditor } from './CharacterEditor.js'
import { WorldEditor } from './WorldEditor.js'
import { matchesKnowledge, profileRecords, newCharacter, newWorld, timelineEntries } from './model.js'
import './story-bible.css'

interface Props { novelId: string; mode: 'characters' | 'world' | 'library'; initialId?: string | null; chapters: ChapterSummary[]; onOpen: OpenMaterial; disabled: boolean; onDirty: (dirty: boolean) => void }
export function StoryBiblePanel({ novelId, mode, disabled, onDirty, initialId, chapters, onOpen }: Props) {
  const [data, setData] = useState<StoryBible | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [category, setCategory] = useState('')
  const [timeline, setTimeline] = useState(false)
  const [materialType, setMaterialType] = useState('')
  const [creationType, setCreationType] = useState('characters')
  const [linkBusy, setLinkBusy] = useState(false)
  const active = useRef(false)
  const blocked = loading || busy || dirty || linkBusy || disabled
  const isLibrary = mode === 'library'
  const isCharacter = mode === 'characters'
  const label = isLibrary ? '资料' : isCharacter ? '人物' : '设定'
  useEffect(() => {
    let mounted = true
    storyApi.list(novelId).then(result => {
      if (!mounted) return
      setData(result); setSelectedId(initialId && profileRecords(result, mode).some(item => item.id === initialId) ? initialId : profileRecords(result, mode)[0]?.id ?? null)
    }).catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : '读取资料失败') })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [novelId, mode, initialId])
  useEffect(() => { onDirty(blocked); return () => onDirty(false) }, [onDirty, blocked])
  const onCharacterSaved = useCallback((record: Character) => {
    setData(current => current ? { ...current, characters: current.characters.map(item => item.id === record.id ? record : item) } : current)
  }, [])
  const onWorldSaved = useCallback((record: WorldEntry) => {
    setData(current => current ? { ...current, world: current.world.map(item => item.id === record.id ? record : item) } : current)
  }, [])
  async function run(operation: () => Promise<void>) {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试') }
    finally { active.current = false; setBusy(false) }
  }
  function resetFilters() { setQuery(''); setTag(''); setCategory(''); setTimeline(false); setMaterialType('') }
  function reload(discard = false) {
    if (active.current || disabled || (dirty && !discard)) return
    if (dirty && !window.confirm('重新加载会放弃当前未保存的资料修改。请先导出草稿或复制内容，确认继续？')) return
    void run(async () => {
      const fresh = await storyApi.list(novelId)
      setData(fresh); setSelectedId(profileRecords(fresh, mode).some(item => item.id === selectedId) ? selectedId : profileRecords(fresh, mode)[0]?.id ?? null)
      setDirty(false); setSession(value => value + 1)
    })
  }
  function create() {
    if (blocked) return
    void run(async () => {
      if (isCharacter || (isLibrary && creationType === 'characters')) {
        const record = await storyApi.createCharacter(novelId, newCharacter())
        setData(current => ({ characters: [...(current?.characters ?? []), record], world: current?.world ?? [] })); setSelectedId(record.id)
      } else {
        const record = await storyApi.createWorld(novelId, newWorld((isLibrary ? creationType : category) as WorldCategory || 'location'))
        setData(current => ({ world: [...(current?.world ?? []), record], characters: current?.characters ?? [] })); setSelectedId(record.id)
      }
      resetFilters()
    })
  }
  const all = data ? profileRecords(data, mode) : []
  const selected = all.find(item => item.id === selectedId)
  const tags = [...new Set(all.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const categories = [...new Set(data?.characters.map(item => item.category).filter(Boolean) ?? [])].sort()
  const filtered = all.filter(item => matchesKnowledge(item, query, tag, category, isLibrary ? materialType : ''))
  const visible = !isLibrary && !isCharacter && timeline ? timelineEntries(filtered as WorldEntry[]) : filtered
  function remove() {
    if (!selected || blocked || !window.confirm(`删除${label}“${selected.name}”？相关的人物关系和设定关联会一并移除，小说正文不受影响。将进入回收站保留 30 天，可恢复资料及关联。`)) return
    void run(async () => {
      const kind = 'fields' in selected ? 'characters' : 'world'
      await storyApi.remove(kind, selected)
      setSelectedId(null)
      setData(current => current ? { ...current, [kind]: current[kind].filter(item => item.id !== selected.id) } : current)
      // Refresh versions of characters whose associations were cascaded away.
      const fresh = await storyApi.list(novelId)
      setData(fresh); setSelectedId(profileRecords(fresh, mode)[0]?.id ?? null)
    })
  }
  const open: OpenMaterial = (kind, id) => {
    if (blocked || active.current) return
    if (kind === 'chapter' || !isLibrary) { onOpen(kind, id); return }
    resetFilters(); setSelectedId(id); setSession(value => value + 1)
  }
  return <section className="story-bible" aria-label={isLibrary ? '创作资料库' : isCharacter ? '人物档案管理' : '世界观管理'} aria-busy={loading || busy}>
    <header className="story-toolbar"><div><h2>{isLibrary ? '创作资料库' : isCharacter ? '人物档案' : '世界观资料库'}</h2><p>仅属于当前小说 · 保存在本机</p></div>
      <div className="button-row"><button disabled={blocked} onClick={() => reload()}>刷新资料</button><span className="knowledge-create">{isLibrary && <select aria-label="新增资料类型" disabled={blocked} value={creationType} onChange={event => setCreationType(event.target.value)}><option value="characters">人物</option>{Object.entries(worldCategories).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>}<button className="primary" disabled={blocked || !data} onClick={create}>新增{label}</button></span></div>
    </header>
    {error && <div className="workspace-error" role="alert">{error}<button disabled={blocked} onClick={() => reload()}>重试读取资料</button></div>}
    {loading ? <div className="empty-state" role="status">正在读取本地资料…</div> : data && <div className="story-columns">
      <aside className="story-list-pane" aria-label={`${label}列表与筛选`}>
        <label className="sr-only" htmlFor="profile-search">搜索{label}</label><input id="profile-search" type="search" placeholder={`搜索${label}及内容…`} value={query} onChange={event => setQuery(event.target.value)} />
        {isLibrary ? <><nav className="world-categories" aria-label="资料类型">{[['', '全部资料'], ['characters', '人物'], ['world', '世界观'], ...Object.entries(worldCategories)].map(([key, title]) => <button key={key} aria-pressed={materialType === key} onClick={() => { setMaterialType(key); setCategory('') }}>{title}</button>)}</nav>{materialType === 'characters' && <label>筛选角色分类<select aria-label="筛选角色分类" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}</> : !isCharacter ? <nav className="world-categories" aria-label="世界观分类"><button aria-pressed={!category} onClick={() => setCategory('')}>全部分类</button>{Object.entries(worldCategories).map(([key, title]) => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{title}</button>)}</nav> : <label>筛选角色分类<select aria-label="筛选角色分类" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
        <label>筛选标签<select aria-label="筛选标签" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(item => <option key={item} value={item}>{item}</option>)}{tag && !tags.includes(tag) && <option value={tag}>{tag}（已移除）</option>}</select></label>
        {!isLibrary && !isCharacter && <button aria-pressed={timeline} onClick={() => setTimeline(value => !value)}>重要事件时间线</button>}
        <p className="profile-hint">{visible.length} / {all.length} 条{timeline && !isCharacter ? ' · 按时间线顺序' : ''}</p>
        <nav className="profile-list" aria-label={isLibrary ? '资料列表' : isCharacter ? '人物列表' : '设定列表'}>{visible.map(item => <button key={item.id} disabled={blocked} aria-current={item.id === selectedId ? 'page' : undefined} onClick={() => { setSelectedId(item.id); setSession(value => value + 1) }}>
          {'timeText' in item && timeline && <small className="timeline-time">{item.timeText || '时间待定'} · 顺序 {item.sortOrder}</small>}<strong>{item.name}</strong><small>{'fields' in item ? `人物 · ${item.category || '未分类'}` : worldCategories[item.category]}</small><span className="profile-list-tags">{item.tags.join(' · ')}</span>
        </button>)}</nav>
        {!visible.length && <div className="profile-list-empty"><p>{all.length ? '没有匹配的资料' : `还没有${label}`}</p>{all.length > 0 && <button onClick={resetFilters}>清除筛选</button>}</div>}
      </aside>
      <div className="story-editor-pane">
        {selected ? <>
          <div className="profile-detail-heading"><span>资料详情 · 可直接编辑</span><details className="delete-menu"><summary>···</summary><button className="danger" disabled={blocked} onClick={remove}>删除{label}</button></details></div>
          {'fields' in selected ? <CharacterEditor key={`${selected.id}:${session}`} record={selected} characters={data.characters} world={data.world} disabled={busy || linkBusy || disabled} onSaved={onCharacterSaved} onDirty={setDirty} onReload={() => reload(true)} onOpen={open}>
            <KnowledgeLinks key={selected.id} novelId={novelId} source={{ kind: 'character', id: selected.id }} data={data} chapters={chapters} disabled={busy || dirty || disabled} onBusy={setLinkBusy} onOpen={open} />
          </CharacterEditor> : <WorldEditor key={`${selected.id}:${session}`} record={selected} characters={data.characters} disabled={busy || linkBusy || disabled} onSaved={onWorldSaved} onDirty={setDirty} onReload={() => reload(true)} onOpen={open}>
            <KnowledgeLinks key={selected.id} novelId={novelId} source={{ kind: 'world', id: selected.id }} data={data} chapters={chapters} disabled={busy || dirty || disabled} onBusy={setLinkBusy} onOpen={open} />
          </WorldEditor>}
        </> : <div className="empty-state"><span className="empty-icon">{isCharacter ? '♙' : '◇'}</span><h2>{all.length ? `选择一条${label}` : isLibrary ? '让每一份灵感有所归属' : isCharacter ? '故事因人物而鲜活' : '为故事构建一个世界'}</h2><p>{isLibrary ? '统一整理人物、地点、势力、设定与章节引用。' : isCharacter ? '记录人物经历、成长线与彼此关系。' : '整理地点、势力、力量体系和历史事件。'}</p><button className="primary" disabled={blocked} onClick={create}>新增{label}</button></div>}
      </div>
    </div>}
  </section>
}
