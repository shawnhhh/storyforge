import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import type { Chapter, ChapterResult, RichTextDocument } from '../../../shared/contracts/novels'
import { createEditorExtensions } from '../../shared/editor/extensions'
import { api } from './api'
import { ChapterSaver, type SaveState } from './autosave'
import { EditorStatistics, statisticsKey } from './editor-statistics'
import { DraftNotice } from '../../shared/drafts/DraftNotice'
import { useDraftProtection } from '../../shared/drafts/useDraftProtection'
import { AiWriting } from '../ai/AiWriting'
import { WritingProgress } from './WritingProgress'

export interface EditorControl {
  saveBeforeLeave: () => Promise<boolean>
  save: () => void
  focus: () => void
}
interface Props {
  focused: boolean
  children?: ReactNode
  controlRef: Ref<EditorControl>
  chapter: Chapter
  onSaved: (result: ChapterResult) => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
  disabled: boolean
}
export const ChapterEditor = memo(function ChapterEditor({ chapter, onSaved, onDirty, onReload, disabled, controlRef, children, focused }: Props) {
  const [initial] = useState(chapter)
  const draft = useDraftProtection(`chapter:${chapter.novelId}:${chapter.id}`, { title: initial.title, content: initial.content })
  const { protection } = draft
  const blocked = disabled || draft.blocked
  const saver = useRef<ChapterSaver | null>(null)
  const [state, setState] = useState<SaveState>({ status: 'saved', dirty: false, message: '' })
  const [title, setTitle] = useState(chapter.title)
  const titleRef = useRef(chapter.title)
  const editor = useEditor({
    // Create after commit: a suspended/StrictMode render may be abandoned.
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [...createEditorExtensions(), EditorStatistics],
    content: initial.content,
    onUpdate: ({ editor: instance }) => {
      const doc = instance.state.doc
      // Protect this immutable snapshot immediately; the server queue keeps its debounce.
      protection.change({ title: titleRef.current, content: doc.toJSON() as RichTextDocument })
      saver.current?.change(titleRef.current, () => doc.toJSON() as RichTextDocument)
    },
    editorProps: { attributes: { 'aria-label': '小说正文', role: 'textbox', 'aria-multiline': 'true' } },
  })
  useImperativeHandle(controlRef, () => ({
    saveBeforeLeave: () => saver.current?.saveBeforeLeave() ?? Promise.resolve(false),
    save: () => { if (!blocked) void saver.current?.flush() },
    focus: () => { editor?.commands.focus(undefined, { scrollIntoView: false }) },
  }), [editor, blocked])
  useEffect(() => { editor?.setEditable(!blocked, false) }, [editor, blocked])
  useEffect(() => {
    // Create the queue within the effect so StrictMode can clean up and recreate it.
    const queue = new ChapterSaver(initial, async (id, version, title, content) => {
      const result = await api.save(id, version, title, content)
      void protection.saved({ title, content })
      return result
    })
    saver.current = queue
    const unsubscribe = queue.subscribe((next, result) => {
      setState(next)
      onDirty(next.dirty)
      if (result) onSaved(result)
    })
    return () => { unsubscribe(); queue.dispose(); saver.current = null }
  }, [initial, onDirty, onSaved, protection])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.current?.state.dirty) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [])
  // Only document edits enter the queue; changing editability must not emit an update.
  const labels = { saved: '已保存到数据库', pending: '未保存 · 等待自动保存', saving: '保存中…', failed: '保存失败', conflict: '版本冲突 · 未保存' }
  function exportDraft() {
    const blob = new Blob([JSON.stringify({ title, content: editor?.getJSON(), exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `${title || '未保存章节'}-草稿.json`; link.click()
    URL.revokeObjectURL(url)
  }
  // Mount selector subscribers with a real editor: the selector store otherwise
  // retains its initial null snapshot until a transaction, hiding loaded counts.
  return <section className="editor-pane">
    <header className="editor-heading"><span>正文编辑</span><span className={`save-status ${state.status}`} role="status" aria-live="polite">{labels[state.status]}</span></header>
    {(state.status === 'failed' || state.status === 'conflict') && <div className="save-error" role="alert"><p>{state.message}</p><p>当前内容仍保留在编辑器中。可复制正文或导出草稿，再重新加载最新版本。</p><div className="button-row">{state.status !== 'conflict' && <button disabled={blocked} onClick={() => { void saver.current?.flush() }}>重试保存</button>}<button onClick={exportDraft}>导出未保存草稿</button><button disabled={blocked} onClick={onReload}>重新加载</button></div></div>}
    <DraftNotice draft={draft} onRestore={value => {
      titleRef.current = value.title; setTitle(value.title)
      editor?.commands.setContent(value.content, { emitUpdate: false })
      protection.change(value); saver.current?.change(value.title, value.content)
    }} />
    <input id="chapter-title" disabled={blocked} className="chapter-title" aria-label="章节标题" maxLength={200} value={title} placeholder="章节标题" onChange={event => { titleRef.current = event.target.value; setTitle(event.target.value); if (editor) { const doc = editor.state.doc; protection.change({ title: event.target.value, content: doc.toJSON() as RichTextDocument }); saver.current?.change(event.target.value, () => doc.toJSON() as RichTextDocument) } }} />
    <div className="editor-tools">{editor && <FormattingToolbar editor={editor} disabled={blocked} />}{editor && <AiWriting editor={editor} chapterId={chapter.id} disabled={blocked || state.status === 'conflict'} />}<button className="save-now" title="Control + Alt/⌥ + Shift + S（Mac 也使用 Control）" disabled={blocked || !state.dirty || state.status === 'saving' || state.status === 'conflict'} onClick={() => { void saver.current?.flush() }}>立即保存</button></div>
    <DocumentBody editor={editor} />
    {children}
    <footer className="editor-footer">{editor && <><WordStatistics editor={editor} /><WritingProgress editor={editor} chapterId={chapter.id} focused={focused} disabled={blocked} /></>}<span title={`SQLite · 版本 ${chapter.version}`}>自动保存至本机</span></footer>
  </section>
})

const DocumentBody = memo(function DocumentBody({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} className="document" />
})

const FormattingToolbar = memo(function FormattingToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const formatting = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const instance = current && !current.isDestroyed ? current : null
      return {
        bold: instance?.isActive('bold') ?? false,
        italic: instance?.isActive('italic') ?? false,
        heading: instance?.isActive('heading', { level: 2 }) ?? false,
        list: instance?.isActive('bulletList') ?? false,
        quote: instance?.isActive('blockquote') ?? false,
        undo: instance?.can().undo() ?? false,
        redo: instance?.can().redo() ?? false,
      }
    },
  })
  return (<fieldset disabled={disabled} className="format-bar" aria-label="正文格式">
      <button aria-label="粗体" aria-pressed={formatting?.bold ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button aria-label="斜体" aria-pressed={formatting?.italic ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button aria-pressed={formatting?.heading ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题</button>
      <button aria-pressed={formatting?.list ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}>列表</button>
      <button aria-pressed={formatting?.quote ?? false} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>引用</button>
      <button disabled={!formatting?.undo} onClick={() => editor?.chain().focus().undo().run()}>撤销</button>
      <button disabled={!formatting?.redo} onClick={() => editor?.chain().focus().redo().run()}>重做</button>
    </fieldset>)
})

const WordStatistics = memo(function WordStatistics({ editor }: { editor: Editor | null }) {
  const count = useEditorState({ editor, selector: ({ editor: current }) => current && !current.isDestroyed ? statisticsKey.getState(current.state) : null })
  return <details className="word-statistics"><summary aria-label="字数统计">{count?.total ?? 0} 字</summary><div className="statistics-details"><p>中文 {count?.chinese ?? 0} 字 · 英文 {count?.english ?? 0} 词 · 数字 {count?.numbers ?? 0} 组 · 其他文字 {count?.other ?? 0} 字</p><p>仅统计正文。汉字逐字计数（含扩展汉字）；英文按单词计数，词内撇号和连字符不拆词；连续数字计 1。其他文字逐字计数。空白、标点、符号与表情不计入；换行分隔单词。</p></div></details>
})
