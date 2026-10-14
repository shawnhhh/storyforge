import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Chapter, ChapterResult, ChapterSummary, Novel, NovelDetail } from '../../../shared/contracts/novels'
import { api } from './api'
import './workspace.css'

const ChapterEditor = lazy(() => import('./ChapterEditor').then(module => ({ default: module.ChapterEditor })))

export function Workspace() {
  const [novels, setNovels] = useState<Novel[]>([])
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [session, setSession] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const active = useRef(false)
  const blocked = busy || dirty
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
    api.list().then(items => { if (mounted) setNovels(items) }).catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : '无法连接本地服务') })
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
  function selectNovel(novel: Novel) {
    if (blocked) return
    void run(async () => {
      const loaded = await api.detail(novel.id)
      const first = loaded.chapters[0] ? await api.chapter(loaded.chapters[0].id) : null
      setDetail(loaded); updateNovel(loaded.novel); setChapter(first); setSession(value => value + 1)
    })
  }
  function refresh() {
    if (blocked) return
    void run(async () => {
      const items = await api.list(); setNovels(items)
      if (detail) {
        if (!items.some(item => item.id === detail.novel.id)) { setDetail(null); setChapter(null); return }
        const loaded = await api.detail(detail.novel.id); setDetail(loaded)
        const selected = loaded.chapters.find(item => item.id === chapter?.id) ?? loaded.chapters[0]
        if (selected) await loadChapter(selected.id)
        else setChapter(null)
      }
    })
  }
  function openModal(mode: 'create' | 'edit') {
    setTitle(mode === 'edit' ? detail?.novel.title ?? '' : '')
    setDescription(mode === 'edit' ? detail?.novel.description ?? '' : '')
    setError(''); setModal(mode)
  }
  function addChapter() {
    if (!detail || blocked) return
    void run(async () => {
      const result = await api.createChapter(detail.novel, `第 ${detail.chapters.length + 1} 章`)
      const loaded = await api.detail(detail.novel.id)
      setDetail(loaded); updateNovel(loaded.novel); setChapter(result.chapter); setSession(value => value + 1)
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
    if (!chapter || busy || (dirty && !window.confirm('重新加载会放弃当前未保存修改。请先复制正文或导出草稿，确认继续？'))) return
    void run(async () => {
      const loaded = await api.detail(chapter.novelId)
      const fresh = await api.chapter(chapter.id)
      setDetail(loaded); updateNovel(loaded.novel); setChapter(fresh); setSession(value => value + 1); setDirty(false)
    })
  }
  return <div className="workspace">
    <aside className="library-pane">
      <div className="brand"><span className="brand-mark">S</span><div><strong>StoryForge</strong><small>原创故事工作台</small></div></div>
      <div className="library-heading"><span>我的小说 <span className="count">{novels.length}</span></span><button aria-label="创建小说" disabled={blocked} onClick={() => openModal('create')}>＋</button></div>
      <nav aria-label="小说列表">{novels.map(novel => <button key={novel.id} className={`novel-item ${detail?.novel.id === novel.id ? 'selected' : ''}`} disabled={blocked} onClick={() => selectNovel(novel)}><span className="book-icon">▤</span><span><strong>{novel.title}</strong><small>{new Date(novel.updatedAt).toLocaleDateString('zh-CN')} · v{novel.version}</small></span></button>)}</nav>
      {!novels.length && <p className="sidebar-note">从一部新小说开始，构建你的故事世界。</p>}
      <div className="library-bottom"><button disabled={blocked} onClick={refresh}>刷新本地数据</button><small>● 本地存储 · 无需登录</small></div>
    </aside>
    <main className="main-workspace">
      <header className="workspace-heading"><div><span className="eyebrow">创作空间</span><h1>{detail?.novel.title ?? '欢迎来到 StoryForge'}</h1></div>{detail && <div className="button-row"><button disabled={blocked} onClick={() => openModal('edit')}>小说设置</button><button className="danger" disabled={blocked} onClick={() => {
        if (!window.confirm(`删除《${detail.novel.title}》及全部章节？此操作不可撤销。`)) return
        void run(async () => { await api.remove(detail.novel); setNovels(items => items.filter(item => item.id !== detail.novel.id)); setDetail(null); setChapter(null) })
      }}>删除小说</button></div>}</header>
      {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭提示">×</button><small>若数据已在其他浏览器变化，请先保存或处理当前草稿，再点击“刷新本地数据”。</small></div>}
      {dirty && <div className="pending-note">正文存在未保存修改，保存完成后即可切换小说、章节或调整顺序。</div>}
      {detail ? <div className="writing-area"><aside className="chapter-pane"><div className="chapter-heading"><span>章节 <span className="count">{detail.chapters.length}</span></span><button disabled={blocked} onClick={addChapter} aria-label="添加章节">＋</button></div>
        <ol className="chapter-list">{detail.chapters.map((item, index) => <li key={item.id} className={chapter?.id === item.id ? 'active' : ''}><button className="chapter-select" disabled={blocked} onClick={() => { void run(() => loadChapter(item.id)) }}><span className="chapter-number">{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span></button><div className="order-buttons"><button aria-label={`上移 ${item.title}`} disabled={blocked || index === 0} onClick={() => move(item, -1)}>↑</button><button aria-label={`下移 ${item.title}`} disabled={blocked || index === detail.chapters.length - 1} onClick={() => move(item, 1)}>↓</button></div></li>)}</ol>
        {chapter && <button className="delete-chapter danger" disabled={blocked} onClick={() => {
          if (!window.confirm(`删除“${chapter.title}”？此操作不可撤销。`)) return
          void run(async () => {
            const loaded = await api.deleteChapter(chapter, detail.novel)
            setDetail(loaded); updateNovel(loaded.novel)
            if (loaded.chapters[0]) await loadChapter(loaded.chapters[0].id)
            else setChapter(null)
          })
        }}>删除当前章节</button>}
      </aside>{chapter ? <Suspense fallback={<div className="empty-state">正在加载编辑器…</div>}><ChapterEditor key={`${chapter.id}:${session}`} chapter={chapter} onSaved={onSaved} onDirty={setDirty} onReload={reloadEditor} disabled={busy} /></Suspense> : <div className="empty-state"><span className="empty-icon">✎</span><h2>故事，从第一章开始</h2><p>为《{detail.novel.title}》创建一个章节。</p><button className="primary" disabled={busy} onClick={addChapter}>创建第一章</button></div>}</div> : <div className="empty-state welcome"><span className="empty-icon">▤</span><h2>让灵感成为故事</h2><p>创建小说，整理章节，专注写作。<br />所有正式数据保存在这台 Mac 的 SQLite 中。</p><button className="primary" disabled={busy} onClick={() => openModal('create')}>创建小说</button></div>}
    </main>
    {modal && <div className="modal-backdrop"><form className="novel-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        if (modal === 'create') {
          const novel = await api.create(title, description); updateNovel(novel); setDetail({ novel, chapters: [] }); setChapter(null)
        } else if (detail) { updateNovel(await api.update(detail.novel, title, description)) }
        setModal(null)
      })
    }}><h2 id="dialog-title">{modal === 'create' ? '创建小说' : '小说设置'}</h2><label>小说名称<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="为故事起一个名字" /></label><label>简介<textarea maxLength={4000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="故事的起点、主题或一句话梗概" /></label>{error && <p className="dialog-error" role="alert">{error}</p>}<div className="button-row"><button type="button" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="primary" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存'}</button></div></form></div>}
  </div>
}
