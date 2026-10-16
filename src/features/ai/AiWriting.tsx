import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { aiActions, aiLimits, type AiAction, type AiInput, type AiResult, type AiStatus } from '../../../shared/contracts/ai'
import { request } from '../../shared/api/client'
import { aiTransaction, captureAiSnapshot, type AiSnapshot } from './editor'
import './ai.css'

interface Session { snapshot: AiSnapshot; scroll: number }
export function AiWriting({ editor, chapterId, disabled }: { editor: Editor; chapterId: string; disabled: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  return <>
    <button disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
      if (editor.view.composing) return
      setSession({ snapshot: captureAiSnapshot(editor.state), scroll: editor.view.dom.closest('.document')?.scrollTop ?? 0 })
    }}>AI 辅助</button>
    {session && <AiDialog editor={editor} chapterId={chapterId} disabled={disabled} session={session} onClose={() => setSession(null)} />}
  </>
}

function AiDialog({ editor, chapterId, disabled, session, onClose }: { editor: Editor; chapterId: string; disabled: boolean; session: Session; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [action, setAction] = useState<AiAction>('continue')
  const [instructions, setInstructions] = useState('')
  const [includeStoryContext, setIncludeStoryContext] = useState(false)
  const [result, setResult] = useState<AiResult | null>(null)
  const [resultAction, setResultAction] = useState<AiAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const controller = new AbortController()
    request<AiStatus>('/ai/status', 'GET', undefined, controller.signal).then(setStatus).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取 AI 配置')
    })
    const changed = () => { if (editor.state.doc !== session.snapshot.doc) setStale(true) }
    editor.on('update', changed)
    return () => { controller.abort(); pending.current?.abort(); editor.off('update', changed); element.close() }
  }, [editor, session])
  const tooLong = session.snapshot.input.selection.length > aiLimits.selection
  const needsSelection = ['polish', 'expand', 'rewrite'].includes(action) && !session.snapshot.input.selection.trim()
  function close() {
    pending.current?.abort(); pending.current = null
    dialog.current?.close()
    if (!editor.isDestroyed) {
      editor.view.dom.focus({ preventScroll: true })
      const container = editor.view.dom.closest('.document')
      if (container) container.scrollTop = session.scroll
    }
    onClose()
  }
  async function generate() {
    if (pending.current || disabled || stale || tooLong || needsSelection || !status?.configured) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError(''); setResult(null); setResultAction(null)
    const input: AiInput = { action, chapterId, ...session.snapshot.input, instructions, includeStoryContext }
    try {
      const next = await request<AiResult>('/ai/generate', 'POST', input, controller.signal)
      if (pending.current === controller) { setResult(next); setResultAction(action) }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'AI 请求失败，请检查本地服务后重试')
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false) }
    }
  }
  function accept() {
    if (!result || !resultAction || disabled || stale || editor.isDestroyed || !editor.isEditable) return
    const tr = aiTransaction(editor.state, session.snapshot, resultAction, result.text)
    if (!tr) { setStale(true); return }
    editor.view.dispatch(tr)
    close()
  }
  return <dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-title" onCancel={event => { event.preventDefault(); close() }}>
    <h2 id="ai-title">AI 辅助写作</h2>
    <p className="ai-note">点击生成后，选文与附近上下文会经本机服务发送至你配置的模型服务。请确认内容适合发送。结果仅供预览，接受后才会修改正文并自动保存。</p>
    <p role="status">{status?.message ?? '正在检查 AI 配置…'}{status?.model ? ` · ${status.model}` : ''}</p>
    {status && !status.configured && <p>在本地 .env 中设置 STORYFORGE_AI_API_KEY；可配置 STORYFORGE_AI_MODEL 与 STORYFORGE_AI_BASE_URL，然后重启后端。不要使用 VITE_ 前缀。详见 docs/ai-writing.md。</p>}
    <fieldset disabled={loading} className="ai-options">
      <label>写作操作<select aria-label="写作操作" value={action} onChange={event => { setAction(event.target.value as AiAction); setResult(null); setResultAction(null) }}>{Object.entries(aiActions).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>写作要求<textarea aria-label="写作要求" maxLength={aiLimits.instructions} rows={3} value={instructions} placeholder="例如：克制、悬疑，放慢节奏，保持人物口吻" onChange={event => setInstructions(event.target.value)} /></label>
      <label className="ai-check"><input type="checkbox" checked={includeStoryContext} onChange={event => setIncludeStoryContext(event.target.checked)} />附带本小说已保存的人物、世界观与大纲摘要（最多 {aiLimits.story} 字符）</label>
    </fieldset>
    <details><summary>查看将发送的正文片段（选文 {session.snapshot.input.selection.length} 字符）</summary><div className="ai-context">前文：{session.snapshot.input.before || '无'}{'\n\n'}选文：{session.snapshot.input.selection || '无（使用当前光标）'}{'\n\n'}后文：{session.snapshot.input.after || '无'}</div></details>
    {needsSelection && <p role="alert">请关闭预览，先选择需要处理的正文。</p>}
    {tooLong && <p role="alert">选文超过 {aiLimits.selection} 字符，请缩小选区后重试。</p>}
    {stale && <p role="alert">正文已变化，当前结果不能接受。请关闭后基于新正文重新生成。</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {loading && <p role="status">正在生成… 可随时取消；模型服务可能仍计费用量。</p>}
    {result && <section aria-label="AI 结果预览"><h3>{resultAction === 'inspire' ? '创作建议' : '正文预览'}</h3><div className="ai-preview">{result.text}</div><p className="ai-note">输入 {result.usage.inputTokens ?? '未知'} / 输出 {result.usage.outputTokens ?? '未知'} tokens · 费用以模型服务账单为准{result.finishReason === 'length' ? ' · 已达到输出上限，结果可能不完整' : ''}</p></section>}
    {action === 'inspire' && <p className="ai-note">灵感仅作参考，不提供替换正文；可自行选择建议继续创作。</p>}
    <div className="button-row">
      <button onClick={close}>{result ? '放弃' : '关闭'}</button>
      {loading ? <button onClick={() => { pending.current?.abort(); pending.current = null; setLoading(false); setError('请求已取消；正文未修改。') }}>取消请求</button> : <button className="primary" disabled={disabled || stale || tooLong || needsSelection || !status?.configured} onClick={() => { void generate() }}>{result ? '重新生成' : '生成预览'}</button>}
      {result && resultAction !== 'inspire' && <button className="primary" disabled={disabled || stale || loading} onClick={accept}>{resultAction === 'continue' ? '接受并插入' : '接受并替换选文'}</button>}
    </div>
  </dialog>
}
