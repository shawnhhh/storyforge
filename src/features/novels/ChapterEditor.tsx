import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Chapter, ChapterResult, RichTextDocument } from '../../../shared/contracts/novels'
import { createEditorExtensions } from '../../shared/editor/extensions'
import { api } from './api'
import { ChapterSaver } from './autosave'

interface Props {
  chapter: Chapter
  onSaved: (result: ChapterResult) => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
  disabled: boolean
}
export function ChapterEditor({ chapter, onSaved, onDirty, onReload, disabled }: Props) {
  const [initial] = useState(chapter)
  const [saver] = useState(() => new ChapterSaver(chapter, api.save))
  const [state, setState] = useState(saver.state)
  const [title, setTitle] = useState(chapter.title)
  const titleRef = useRef(chapter.title)
  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: initial.content,
    onUpdate: ({ editor: instance }) => { saver.change(titleRef.current, instance.getJSON() as RichTextDocument) },
    editorProps: { attributes: { 'aria-label': '小说正文', role: 'textbox', 'aria-multiline': 'true' } },
  })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => saver.subscribe((next, result) => {
    setState(next)
    onDirty(next.dirty)
    if (result) onSaved(result)
  }), [saver, onDirty, onSaved])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.state.dirty) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [saver])
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
    {(state.status === 'failed' || state.status === 'conflict') && <div className="save-error" role="alert"><p>{state.message}</p><p>当前内容仍保留在编辑器中。可复制正文或导出草稿，再重新加载最新版本。</p><div className="button-row">{state.status !== 'conflict' && <button onClick={() => { void saver.flush() }}>重试保存</button>}<button onClick={exportDraft}>导出未保存草稿</button><button onClick={onReload}>重新加载</button></div></div>}
    <input id="chapter-title" disabled={disabled} className="chapter-title" aria-label="章节标题" maxLength={200} value={title} placeholder="章节标题" onChange={event => { titleRef.current = event.target.value; setTitle(event.target.value); if (editor) saver.change(event.target.value, editor.getJSON() as RichTextDocument) }} />
    <fieldset disabled={disabled} className="format-bar" aria-label="正文格式">
      <button aria-label="粗体" onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button aria-label="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题</button>
      <button onClick={() => editor?.chain().focus().toggleBulletList().run()}>列表</button>
      <button onClick={() => editor?.chain().focus().toggleBlockquote().run()}>引用</button>
      <button onClick={() => editor?.chain().focus().undo().run()}>撤销</button>
      <button onClick={() => editor?.chain().focus().redo().run()}>重做</button>
      <button className="save-now" disabled={!state.dirty || state.status === 'saving' || state.status === 'conflict'} onClick={() => { void saver.flush() }}>立即保存</button>
    </fieldset>
    <EditorContent editor={editor} className="document" />
    <footer className="editor-footer"><span>{editor?.getText().replace(/\s/g, '').length ?? 0} 字</span><span>本机 SQLite · 版本 {chapter.version}</span></footer>
  </section>
}
