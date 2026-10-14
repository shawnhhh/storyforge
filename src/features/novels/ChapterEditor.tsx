import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Chapter, ChapterResult, RichTextDocument } from '../../../shared/contracts/novels'
import { createEditorExtensions } from '../../shared/editor/extensions'
import { api } from './api'
import { ChapterSaver, type SaveState } from './autosave'

interface Props {
  chapter: Chapter
  onSaved: (result: ChapterResult) => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
  disabled: boolean
}
export function ChapterEditor({ chapter, onSaved, onDirty, onReload, disabled }: Props) {
  const [initial] = useState(chapter)
  const saver = useRef<ChapterSaver | null>(null)
  const [state, setState] = useState<SaveState>({ status: 'saved', dirty: false, message: '' })
  const [title, setTitle] = useState(chapter.title)
  const titleRef = useRef(chapter.title)
  const editor = useEditor({
    // Create after commit: a suspended/StrictMode render may be abandoned.
    immediatelyRender: false,
    extensions: createEditorExtensions(),
    content: initial.content,
    onUpdate: ({ editor: instance }) => { saver.current?.change(titleRef.current, instance.getJSON() as RichTextDocument) },
    editorProps: { attributes: { 'aria-label': '小说正文', role: 'textbox', 'aria-multiline': 'true' } },
  })
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
        words: instance?.getText().replace(/\s/g, '').length ?? 0,
      }
    },
  })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => {
    // Create the queue within the effect so StrictMode can clean up and recreate it.
    const queue = new ChapterSaver(initial, api.save)
    saver.current = queue
    const unsubscribe = queue.subscribe((next, result) => {
      setState(next)
      onDirty(next.dirty)
      if (result) onSaved(result)
    })
    return () => { unsubscribe(); queue.dispose(); saver.current = null }
  }, [initial, onDirty, onSaved])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.current?.state.dirty) { event.preventDefault(); event.returnValue = '' }
    }
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!disabled) void saver.current?.flush()
      }
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('keydown', saveShortcut)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', saveShortcut) }
  }, [disabled])
  // Only document edits enter the queue; changing editability must not emit an update.
  const labels = { saved: '已保存', pending: '等待保存…', saving: '保存中…', failed: '保存失败', conflict: '版本冲突 · 未保存' }
  function exportDraft() {
    const blob = new Blob([JSON.stringify({ title, content: editor?.getJSON(), exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `${title || '未保存章节'}-草稿.json`; link.click()
    URL.revokeObjectURL(url)
  }
  return <section className="editor-pane">
    <header className="editor-heading"><span>正文编辑</span><span className={`save-status ${state.status}`} role="status" aria-live="polite">{labels[state.status]}</span></header>
    {(state.status === 'failed' || state.status === 'conflict') && <div className="save-error" role="alert"><p>{state.message}</p><p>当前内容仍保留在编辑器中。可复制正文或导出草稿，再重新加载最新版本。</p><div className="button-row">{state.status !== 'conflict' && <button disabled={disabled} onClick={() => { void saver.current?.flush() }}>重试保存</button>}<button onClick={exportDraft}>导出未保存草稿</button><button disabled={disabled} onClick={onReload}>重新加载</button></div></div>}
    <input id="chapter-title" disabled={disabled} className="chapter-title" aria-label="章节标题" maxLength={200} value={title} placeholder="章节标题" onChange={event => { titleRef.current = event.target.value; setTitle(event.target.value); if (editor) saver.current?.change(event.target.value, editor.getJSON() as RichTextDocument) }} />
    <fieldset disabled={disabled} className="format-bar" aria-label="正文格式">
      <button aria-label="粗体" aria-pressed={formatting?.bold ?? false} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button aria-label="斜体" aria-pressed={formatting?.italic ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button aria-pressed={formatting?.heading ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题</button>
      <button aria-pressed={formatting?.list ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()}>列表</button>
      <button aria-pressed={formatting?.quote ?? false} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>引用</button>
      <button disabled={!formatting?.undo} onClick={() => editor?.chain().focus().undo().run()}>撤销</button>
      <button disabled={!formatting?.redo} onClick={() => editor?.chain().focus().redo().run()}>重做</button>
      <button className="save-now" title="⌘S / Ctrl+S" disabled={!state.dirty || state.status === 'saving' || state.status === 'conflict'} onClick={() => { void saver.current?.flush() }}>立即保存</button>
    </fieldset>
    <EditorContent editor={editor} className="document" />
    <footer className="editor-footer"><span>{formatting?.words ?? 0} 字</span><span title={`SQLite · 版本 ${chapter.version}`}>自动保存至本机</span></footer>
  </section>
}
