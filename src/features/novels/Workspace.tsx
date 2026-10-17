import { Dashboard } from '../dashboard/Dashboard'
import { ChapterReferences } from '../story-bible/ChapterReferences'
import type { OpenMaterial } from '../story-bible/KnowledgeLinks'
import { PlanningPanel } from '../planning/PlanningPanel'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Chapter, ChapterResult, ChapterSummary, Novel, NovelDetail } from '../../../shared/contracts/novels'
import { ApiError, api } from './api'
import { downloadNovel } from './download'
import { BackupPanel } from '../backups/BackupPanel'
import { StoryBiblePanel } from '../story-bible/StoryBiblePanel'
import { NovelDialog } from './NovelDialog'
import { ChapterNavigation } from './ChapterNavigation'
import type { EditorControl } from './ChapterEditor'
import { editorShortcut } from './editor-shortcuts'
import './workspace.css'
import '../dashboard/dashboard.css'
import '../preferences/preferences.css'
import './focus-writing.css'
import { usePreferences } from '../preferences/usePreferences'
import { PreferencesDialog } from '../preferences/PreferencesDialog'
import { SearchDialog } from '../search/SearchDialog'
import type { SearchHit } from '../../../shared/contracts/search'
import { storyApi } from '../story-bible/api'
import { planningApi } from '../planning/api'

const ChapterEditor = lazy(() => import('./ChapterEditor').then(module => ({ default: module.ChapterEditor })))

export function Workspace() {
  const [dashboardRevision, setDashboardRevision] = useState(0)
  const preferences = usePreferences()
  const [utility, setUtility] = useState<'search' | 'preferences' | null>(null)
  const [utilityOpener, setUtilityOpener] = useState<HTMLElement | null>(null)
  const [searchTarget, setSearchTarget] = useState<SearchHit | null>(null)
  const [novels, setNovels] = useState<Novel[]>([])
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [session, setSession] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [dialogOpener, setDialogOpener] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [focused, setFocused] = useState(false)
  const [focusTools, setFocusTools] = useState(false)
  const [backups, setBackups] = useState(false)
  const [exportFormat, setExportFormat] = useState<'markdown' | 'txt' | 'json'>('markdown')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'writing' | 'characters' | 'world' | 'planning' | 'library'>('writing')
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [chapterQuery, setChapterQuery] = useState('')
  const editorControl = useRef<EditorControl | null>(null)
  const workspaceElement = useRef<HTMLDivElement | null>(null)
  const focusScroll = useRef<{ element: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    if (focused || !focusScroll.current) return
    const { element, top } = focusScroll.current
    // A chapter switch replaces the document; never apply another chapter's scroll.
    if (element.isConnected) element.scrollTop = top
    focusScroll.current = null
  }, [focused])
  function changeFocus(next: boolean) {
    if (next) {
      const element = workspaceElement.current?.querySelector<HTMLElement>('.document')
      focusScroll.current = element ? { element, top: element.scrollTop } : null
    }
    setFocused(next)
    setFocusTools(false)
    editorControl.current?.focus()
  }
  const active = useRef(false)
  const blocked = loading || busy || dirty || referenceBusy
  const updateNovel = useCallback((novel: Novel) => {
    setNovels(items => [novel, ...items.filter(item => item.id !== novel.id)])
    setDetail(current => current?.novel.id === novel.id ? { ...current, novel } : current)
  }, [])
  const onSaved = useCallback((result: ChapterResult) => {
    updateNovel(result.novel)
    setChapter(result.chapter)
    setDetail(current => current ? { ...current, chapters: current.chapters.map(item => item.id === result.chapter.id ? result.chapter : item) } : current)
  }, [updateNovel])
  useEffect(() => {
    let mounted = true
    api.list().then(items => { if (mounted) setNovels(items) }).catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : '无法连接本地服务') }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])
  async function run(operation: () => Promise<void>) {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试') }
    finally { active.current = false; setBusy(false) }
  }
  async function loadChapter(id: string) {
    const loaded = await api.chapter(id)
    setChapter(loaded); setSession(value => value + 1); setDirty(false)
  }
  function selectChapter(id: string) {
    if (view !== 'writing' || loading || busy || referenceBusy || id === chapter?.id) return
    void run(async () => {
      // A lazy editor may not be mounted yet; a clean chapter can still switch.
      const control = editorControl.current
      if (control ? !await control.saveBeforeLeave() : dirty) {
        setError('当前章节尚未保存，已保留在编辑器中。请先重试保存或处理版本冲突，再切换章节。')
        return
      }
      await loadChapter(id)
    })
  }
  useEffect(() => {
    document.querySelector('.chapter-list .active')?.scrollIntoView({ block: 'nearest' })
  }, [chapter?.id])
  function selectNovel(novel: Novel, chapterId?: string) {
    if (blocked || backups) return
    void run(async () => {
      const loaded = await api.detail(novel.id)
      const target = loaded.chapters.find(item => item.id === chapterId) ?? loaded.chapters[0]
      const first = target ? await api.chapter(target.id) : null
      if (!detail) setView('writing')
      setFocused(false)
      setSearchTarget(null); setMaterialId(null); setChapterQuery(''); setDetail(loaded); updateNovel(loaded.novel); setChapter(first); setSession(value => value + 1)
    })
  }
  function refresh() {
    if (blocked) return
    void run(async () => {
      const items = await api.list(); setNovels(items); setDashboardRevision(value => value + 1)
      if (detail) {
        if (!items.some(item => item.id === detail.novel.id)) { setDetail(null); setChapter(null); return }
        const loaded = await api.detail(detail.novel.id); setDetail(loaded)
        const selected = loaded.chapters.find(item => item.id === chapter?.id) ?? loaded.chapters[0]
        if (selected) await loadChapter(selected.id)
        else { setChapter(null); setSession(value => value + 1) }
      }
    })
  }
  function openUtility(mode: 'search' | 'preferences', opener: HTMLElement) {
    setUtilityOpener(opener); setUtility(mode)
  }
  function openModal(mode: 'create' | 'edit', opener: HTMLElement) {
    // WebKit mouse clicks need not focus a button. Keep the actual trigger.
    setDialogOpener(opener)
    setError(''); setModal(mode)
  }
  function addChapter() {
    if (!detail || blocked) return
    void run(async () => {
      const result = await api.createChapter(detail.novel, `第 ${detail.chapters.length + 1} 章`)
      // The mutation response already contains the new versions; no second request can fail after creation.
      setDetail({ novel: result.novel, chapters: [...detail.chapters, result.chapter] })
      updateNovel(result.novel); setChapter(result.chapter); setSession(value => value + 1)
    })
  }
  function move(item: ChapterSummary, direction: number) {
    if (!detail || blocked) return
    const ids = detail.chapters.map(row => row.id), from = ids.indexOf(item.id), to = from + direction
    if (to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    void run(async () => { const loaded = await api.reorder(detail.novel, ids); setDetail(loaded); updateNovel(loaded.novel) })
  }
  function reloadEditor() {
    if (!chapter || busy || (dirty && !window.confirm('重新加载数据库内容。未保存修改会作为本机草稿保留，随后需选择版本。确认继续？'))) return
    void run(async () => {
      let loaded: NovelDetail
      try { loaded = await api.detail(chapter.novelId) }
      catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason
        const items = await api.list()
        setNovels(items); setDetail(null); setChapter(null); setDirty(false)
        return
      }
      const selected = loaded.chapters.find(item => item.id === chapter.id) ?? loaded.chapters[0]
      const fresh = selected ? await api.chapter(selected.id) : null
      setDetail(loaded); updateNovel(loaded.novel); setChapter(fresh); setSession(value => value + 1); setDirty(false)
    })
  }
  const openMaterial: OpenMaterial = (kind, id) => {
    if (blocked) return
    if (kind === 'chapter') { void run(async () => { await loadChapter(id); setView('writing'); setFocused(false) }); return }
    setSearchTarget(null); setMaterialId(id); setView('library'); setFocused(false)
  }
  async function openSearchResult(hit: SearchHit): Promise<boolean> {
    if (blocked || backups || active.current) return false
    active.current = true; setBusy(true)
    try {
      const loaded = await api.detail(hit.novelId)
      let nextChapter: Chapter | null = null
      if (hit.kind === 'chapter') nextChapter = await api.chapter(hit.id)
      else if (hit.kind === 'novel' && loaded.chapters[0]) nextChapter = await api.chapter(loaded.chapters[0].id)
      else if (hit.kind === 'character' || hit.kind === 'world') {
        const records = await storyApi.list(hit.novelId)
        if (!records[hit.kind === 'character' ? 'characters' : 'world'].some(item => item.id === hit.id)) throw new Error('该资料已删除，请重新搜索。')
      } else if (hit.kind !== 'novel') {
        const snapshot = await planningApi.read(hit.novelId)
        if (!snapshot[hit.kind as 'outlines' | 'plotlines' | 'cards' | 'foreshadows'].some(item => item.id === hit.id)) throw new Error('该规划已删除，请重新搜索。')
      }
      setMaterialId(null); setDetail(loaded); updateNovel(loaded.novel); setChapter(nextChapter); setChapterQuery('')
      setView(hit.kind === 'novel' || hit.kind === 'chapter' ? 'writing' : hit.kind === 'character' ? 'characters' : hit.kind === 'world' ? 'world' : 'planning')
      setBackups(false); setFocused(false); setSearchTarget(hit); setSession(value => value + 1); setError('')
      return true
    } finally { active.current = false; setBusy(false) }
  }
  return <div ref={workspaceElement} data-font={preferences.value.font} data-layout={preferences.value.layout} data-shortcut-hints={preferences.value.shortcutHints} style={{ '--editor-font-size': `${preferences.value.fontSize}px` } as CSSProperties} className={`workspace ${!detail && !backups ? 'is-dashboard' : ''} ${view !== 'writing' && detail ? 'with-story-bible' : ''} ${focused && detail && view === 'writing' ? 'focused' : ''} ${focusTools ? 'focus-tools-visible' : ''}`} aria-busy={loading || busy} onKeyDownCapture={event => {
    if (utility || view !== 'writing' || !chapter || backups || modal || (event.target instanceof Element && event.target.closest('dialog'))) return
    const action = editorShortcut(event.nativeEvent)
    if (!action || (action === 'escape' && !focused)) return
    event.preventDefault()
    if (action === 'save') editorControl.current?.save()
    else if (action === 'focus' || action === 'escape') {
      changeFocus(action === 'escape' ? false : !focused)
    } else if (detail) {
      const index = detail.chapters.findIndex(item => item.id === chapter.id)
      const target = detail.chapters[index + (action === 'previous' ? -1 : 1)]
      if (target) selectChapter(target.id)
    }
  }}>
    <aside className="library-pane">
      <div className="brand"><span className="brand-mark">S</span><div><strong>StoryForge</strong><small>原创故事工作台</small></div></div>
      <button className="dashboard-home" aria-current={!detail && !backups ? 'page' : undefined} disabled={blocked || backups} onClick={() => { setBackups(false); setDetail(null); setChapter(null); setFocused(false); setView('writing'); setNotice(''); setError('') }}>⌂ 创作工作台</button>
      <div className="library-utilities"><button disabled={backups} onClick={event => openUtility('search', event.currentTarget)}>统一搜索</button><button onClick={event => openUtility('preferences', event.currentTarget)}>偏好设置</button></div>
      <div className="library-heading"><span>我的小说 <span className="count">{novels.length}</span></span><button aria-label="创建小说" disabled={blocked || backups} onClick={event => openModal('create', event.currentTarget)}>＋</button></div>
      <nav aria-label="小说列表">{novels.map(novel => <button key={novel.id} aria-current={detail?.novel.id === novel.id ? 'page' : undefined} className={`novel-item ${detail?.novel.id === novel.id ? 'selected' : ''}`} disabled={blocked || backups} onClick={() => selectNovel(novel)}><span className="book-icon">▤</span><span><strong>{novel.title}</strong><small>{new Date(novel.updatedAt).toLocaleDateString('zh-CN')}</small></span></button>)}</nav>
      {!novels.length && <p className="sidebar-note" role="status">{loading ? '正在读取本地小说…' : '从一部新小说开始，构建你的故事世界。'}</p>}
      <div className="library-bottom"><button disabled={blocked || backups} onClick={() => { setBackups(true); setFocused(false); setChapter(null); setDetail(null) }}>备份与恢复</button><button disabled={blocked || backups} onClick={refresh}>刷新本地数据</button><small>● 本地存储 · 无需登录</small></div>
    </aside>
    <main className="main-workspace">
      <header className="workspace-heading"><div><span className="eyebrow">创作空间</span><div className="focus-utilities"><button className="focus-tools-toggle" aria-expanded={focusTools} onClick={() => setFocusTools(value => !value)}>{focusTools ? '收起工具栏' : '显示工具栏'}</button><button onClick={event => openUtility('search', event.currentTarget)}>统一搜索</button><button onClick={event => openUtility('preferences', event.currentTarget)}>偏好设置</button></div><h1>{backups ? '备份与恢复' : detail?.novel.title ?? '创作工作台'}</h1></div>{detail && <div className="button-row"><select aria-label="小说导出格式" disabled={blocked} value={exportFormat} onChange={event => setExportFormat(event.target.value as typeof exportFormat)}><option value="markdown">Markdown</option><option value="txt">TXT</option><option value="json">JSON</option></select><button disabled={blocked} onClick={() => { setNotice('正在导出小说…'); void run(async () => { await downloadNovel(detail.novel.id, detail.novel.title, exportFormat); setNotice('导出文件已交给浏览器下载，请查看下载列表。') }).then(() => setNotice(current => current === '正在导出小说…' ? '' : current)) }}>导出小说</button><button className="focus-toggle" disabled={!chapter || view !== 'writing'} title="Ctrl/⌘ + Alt + Shift + F；Esc 退出" aria-pressed={focused} onClick={() => changeFocus(!focused)}>{focused ? '退出专注' : '专注写作'}</button><button disabled={blocked || view === 'planning'} onClick={event => openModal('edit', event.currentTarget)}>小说设置</button><button className="danger" disabled={blocked || view === 'planning'} onClick={() => {
        if (!window.confirm(`删除《${detail.novel.title}》及全部章节、人物、世界观和规划？此操作不可撤销。`)) return
        void run(async () => { await api.remove(detail.novel); setNovels(items => items.filter(item => item.id !== detail.novel.id)); setDetail(null); setChapter(null) })
      }}>删除小说</button></div>}</header>
      {detail && <nav className="workspace-sections" aria-label="小说工作台模块">{([['writing', '章节写作'], ['characters', '人物档案'], ['world', '世界观'], ['library', '创作资料库'], ['planning', '创作规划']] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} disabled={blocked} onClick={() => { setSearchTarget(null); if (view === 'planning') refresh(); setMaterialId(null); setView(key); setFocused(false) }}>{label}</button>)}</nav>}
      {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭提示">×</button><small>若数据已在其他浏览器变化，请先保存或处理当前草稿，再点击“刷新本地数据”。</small></div>}
      {detail && <div className="pending-note" aria-hidden={!dirty}>{view === 'planning' ? '规划存在未保存修改，保存完成后即可切换小说或模块。' : view === 'writing' ? '正文存在未保存修改。切换章节会先保存；切换小说或调整顺序请等待保存完成。' : '正在处理资料或存在未保存修改，完成保存后即可切换小说与模块。'}</div>}
      {!backups && notice && <p className="backup-status" role="status">{notice}</p>}
      {backups ? <BackupPanel onBack={() => { setBackups(false); setNotice(''); void run(async () => { setNovels(await api.list()) }) }} /> : detail && view === 'planning' ? <PlanningPanel key={`${detail.novel.id}:${session}`} novelId={detail.novel.id} initialSelection={searchTarget?.novelId === detail.novel.id ? searchTarget : null} chapters={detail.chapters} onDirty={setDirty} onBack={() => { setView('writing'); refresh() }} /> : detail && (view === 'characters' || view === 'world' || view === 'library') ? <StoryBiblePanel key={`${detail.novel.id}:${view}:${session}`} novelId={detail.novel.id} mode={view} initialId={materialId ?? (searchTarget?.novelId === detail.novel.id && searchTarget.kind === (view === 'characters' ? 'character' : 'world') ? searchTarget.id : null)} chapters={detail.chapters} onOpen={openMaterial} disabled={busy} onDirty={setDirty} /> : detail ? <div className="writing-area"><aside className="chapter-pane"><div className="chapter-heading"><span>章节 <span className="count">{detail.chapters.length}</span></span><button disabled={blocked} onClick={addChapter} aria-label="添加章节">＋</button></div>
        <input className="chapter-search" type="search" aria-label="搜索章节" placeholder="搜索章节标题或序号" value={chapterQuery} onChange={event => setChapterQuery(event.target.value)} />
        <ol className="chapter-list">{detail.chapters.map((item, index) => <li hidden={!!chapterQuery.trim() && !item.title.toLocaleLowerCase().includes(chapterQuery.trim().toLocaleLowerCase()) && String(index + 1) !== chapterQuery.trim()} key={item.id} className={chapter?.id === item.id ? 'active' : ''}><button className="chapter-select" aria-current={chapter?.id === item.id ? 'page' : undefined} disabled={loading || busy || referenceBusy || chapter?.id === item.id} onClick={() => selectChapter(item.id)}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span></button><div className="order-buttons"><button aria-label={`上移 ${item.title}`} disabled={blocked || index === 0} onClick={() => move(item, -1)}>↑</button><button aria-label={`下移 ${item.title}`} disabled={blocked || index === detail.chapters.length - 1} onClick={() => move(item, 1)}>↓</button></div></li>)}</ol>
        {chapterQuery.trim() && !detail.chapters.some((item, index) => item.title.toLocaleLowerCase().includes(chapterQuery.trim().toLocaleLowerCase()) || String(index + 1) === chapterQuery.trim()) && <p className="chapter-no-results" role="status">没有匹配的章节</p>}
        {chapter && <button className="delete-chapter danger" disabled={blocked} onClick={() => {
          if (!window.confirm(`删除“${chapter.title}”？此操作不可撤销。`)) return
          void run(async () => {
            const loaded = await api.deleteChapter(chapter, detail.novel)
            setDetail(loaded); updateNovel(loaded.novel); setChapter(null)
            if (loaded.chapters[0]) await loadChapter(loaded.chapters[0].id)
            else setChapter(null)
          })
        }}>删除当前章节</button>}
      </aside>{chapter ? <div className="chapter-workspace"><ChapterNavigation chapters={detail.chapters} currentId={chapter.id} disabled={loading || busy || referenceBusy} onSelect={selectChapter} /><Suspense fallback={<div className="empty-state">正在加载编辑器…</div>}><ChapterEditor key={`${chapter.id}:${session}`} chapter={chapter} focused={focused} controlRef={editorControl} onSaved={onSaved} onDirty={setDirty} onReload={reloadEditor} disabled={busy || referenceBusy}><ChapterReferences novelId={detail.novel.id} chapterId={chapter.id} chapters={detail.chapters} disabled={busy || dirty || referenceBusy} onBusy={setReferenceBusy} onOpen={openMaterial} /></ChapterEditor></Suspense></div> : <div className="empty-state"><span className="empty-icon">✎</span><h2>故事，从第一章开始</h2><p>为《{detail.novel.title}》创建一个章节。</p><button className="primary" disabled={blocked} onClick={addChapter}>创建第一章</button></div>}</div> : <Dashboard disabled={blocked} revision={dashboardRevision} onOpen={selectNovel} onCreate={opener => openModal('create', opener)} />}
    </main>
    {utility === 'search' && <SearchDialog returnFocusTo={utilityOpener} novels={novels} blocked={blocked} onSelect={openSearchResult} onClose={() => setUtility(null)} />}
    {utility === 'preferences' && <PreferencesDialog returnFocusTo={utilityOpener} value={preferences.value} error={preferences.error} onChange={preferences.change} onClose={() => setUtility(null)} />}
    {modal && <NovelDialog novel={modal === 'edit' ? detail?.novel ?? null : null} busy={busy} error={error} returnFocusTo={dialogOpener} onClose={() => { setModal(null); setError('') }} onSubmit={(title, description, saved) => {
      void run(async () => {
        if (modal === 'create') {
          const novel = await api.create(title, description); if (!detail) setView('writing'); updateNovel(novel); setDetail({ novel, chapters: [] }); setChapter(null)
        } else if (detail) { updateNovel(await api.update(detail.novel, title, description)) }
        saved(); setModal(null)
      })
    }} />}
  </div>
}
