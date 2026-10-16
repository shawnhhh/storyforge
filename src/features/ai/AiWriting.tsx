import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { aiActions, aiLimits, defaultGeneration, type AiAction, type AiInput, type AiResult, type AiStatus, type AiCatalog, type ContextSelection } from '../../../shared/contracts/ai'
import { request } from '../../shared/api/client'
import { aiTransaction, captureAiSnapshot, type AiSnapshot } from './editor'
import { ContextPicker } from './ContextPicker'
import { ModelCenter } from './ModelCenter'
import { ResultComparison } from './ResultComparison'
import './ai.css'

interface Session { snapshot: AiSnapshot; scroll: number }
export function AiWriting({ editor, chapterId, disabled }: { editor: Editor; chapterId: string; disabled: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  const [receipt, setReceipt] = useState<ProseMirrorNode | null>(null)
  useEffect(() => {
    const changed = () => setReceipt(current => current && current !== editor.state.doc ? null : current)
    editor.on('update', changed)
    return () => { editor.off('update', changed) }
  }, [editor])
  return <>
    <button disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
      if (editor.view.composing) return
      setSession({ snapshot: captureAiSnapshot(editor.state), scroll: editor.view.dom.closest('.document')?.scrollTop ?? 0 })
    }}>AI 辅助</button>
    {receipt && <div className="ai-applied" role="status">AI 修改已应用 · 沿用自动保存<button disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
      if (!editor.isDestroyed && editor.isEditable && editor.state.doc === receipt) {
        const container = editor.view.dom.closest('.document'), scroll = container?.scrollTop ?? 0
        editor.commands.undo(); editor.view.dom.focus({ preventScroll: true })
        if (container) container.scrollTop = scroll
      }
      setReceipt(null)
    }}>撤销本次 AI 修改</button><button aria-label="关闭 AI 应用提示" onClick={() => setReceipt(null)}>×</button></div>}
    {session && <AiDialog editor={editor} chapterId={chapterId} disabled={disabled} session={session} onApplied={setReceipt} onClose={() => setSession(null)} />}
  </>
}

function AiDialog({ editor, chapterId, disabled, session, onClose, onApplied }: { editor: Editor; chapterId: string; disabled: boolean; session: Session; onClose: () => void; onApplied: (doc: ProseMirrorNode) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController | null>(null)
  const lifecycle = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [catalog, setCatalog] = useState<AiCatalog | null>(null)
  const [modelId, setModelId] = useState('')
  const [parameters, setParameters] = useState(defaultGeneration)
  const [context, setContext] = useState<ContextSelection | undefined>(undefined)
  const [nearby, setNearby] = useState(9000)
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
    lifecycle.current = controller
    request<AiStatus>('/ai/status', 'GET', undefined, controller.signal).then(setStatus).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取 AI 配置')
    })
    request<AiCatalog>('/ai/models', 'GET', undefined, controller.signal).then(setCatalog).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法加载模型配置中心') })
    const changed = () => { if (editor.state.doc !== session.snapshot.doc) setStale(true) }
    editor.on('update', changed)
    return () => { controller.abort(); lifecycle.current = null; pending.current?.abort(); editor.off('update', changed); element.close() }
  }, [editor, session])
  const tooLong = session.snapshot.input.selection.length > aiLimits.selection
  const needsSelection = ['polish', 'expand', 'rewrite'].includes(action) && !session.snapshot.input.selection.trim()
  const model = catalog?.models.find(item => item.id === modelId) ?? catalog?.models.find(item => item.configured) ?? catalog?.models[0]
  const effectiveParameters = { ...parameters, maxOutputTokens: Math.min(parameters.maxOutputTokens, model?.maxOutputTokens ?? 4096) }
  const parametersValid = Number.isFinite(parameters.temperature) && parameters.temperature >= 0 && parameters.temperature <= 2 && Number.isFinite(parameters.topP) && parameters.topP >= 0.1 && parameters.topP <= 1 && Number.isInteger(effectiveParameters.maxOutputTokens) && effectiveParameters.maxOutputTokens >= 64
  const referencesReady = !context?.references.length || !!context.fingerprint
  const canGenerate = !disabled && !stale && !tooLong && !needsSelection && !!status?.configured && !!model?.configured && parametersValid && referencesReady
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
    if (pending.current || !canGenerate || !model) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError('')
    const input: AiInput = { action, chapterId, ...session.snapshot.input, before: nearby ? session.snapshot.input.before.slice(-Math.ceil(nearby * 2 / 3)) : '', after: session.snapshot.input.after.slice(0, Math.floor(nearby / 3)), instructions, includeStoryContext: context?.references.length ? false : includeStoryContext, context, modelId: model.id, parameters: effectiveParameters }
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(125000)])
      const next = await request<AiResult>('/ai/generate', 'POST', input, signal)
      if (pending.current === controller) { setResult(next); setResultAction(action) }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error && reason.name === 'TimeoutError' ? '等待 AI 响应超时，请核对本地服务后重试' : reason instanceof Error ? reason.message : 'AI 请求失败，请检查本地服务后重试')
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false) }
      const current = lifecycle.current
      if (current && !current.signal.aborted) void request<AiCatalog>('/ai/models', 'GET', undefined, current.signal).then(next => { if (!current.signal.aborted) setCatalog(next) }).catch(() => {})
    }
  }
  function accept() {
    if (!result || !resultAction || disabled || stale || editor.isDestroyed || !editor.isEditable) return
    const tr = aiTransaction(editor.state, session.snapshot, resultAction, result.text)
    if (!tr) { setStale(true); return }
    editor.view.dispatch(tr)
    // Isolate this change from preceding and following typing in undo history.
    editor.view.dispatch(closeHistory(editor.state.tr))
    onApplied(editor.state.doc)
    close()
  }
  return <dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-title" onCancel={event => { event.preventDefault(); close() }}>
    <h2 id="ai-title">AI 辅助写作</h2>
    <p className="ai-note">点击生成后，选文与附近上下文会经本机服务发送至你配置的模型服务。请确认内容适合发送。结果仅供预览，接受后才会修改正文并自动保存。</p>
    <p role="status">{status?.message ?? '正在检查 AI 配置…'}{status?.model ? ` · ${status.model}` : ''}</p>
    {status && !status.configured && <p>在本地 .env 中设置 STORYFORGE_AI_API_KEY；可配置 STORYFORGE_AI_MODEL 与 STORYFORGE_AI_BASE_URL，然后重启后端。不要使用 VITE_ 前缀。详见 docs/ai-writing.md。</p>}
    <ModelCenter catalog={catalog} modelId={model?.id ?? ''} parameters={effectiveParameters} disabled={loading} onModel={setModelId} onParameters={setParameters} />
    <ContextPicker chapterId={chapterId} disabled={loading} onChange={setContext} />
    <fieldset disabled={loading} className="ai-options">
      <label>写作操作<select aria-label="写作操作" value={action} onChange={event => { setAction(event.target.value as AiAction); setResult(null); setResultAction(null) }}>{Object.entries(aiActions).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>写作要求<textarea aria-label="写作要求" maxLength={aiLimits.instructions} rows={3} value={instructions} placeholder="例如：克制、悬疑，放慢节奏，保持人物口吻" onChange={event => setInstructions(event.target.value)} /></label>
      <label>附近正文总长度<select aria-label="附近正文总长度" value={nearby} onChange={event => setNearby(Number(event.target.value))}><option value={0}>不发送附近正文</option><option value={1500}>最多 1500 字符</option><option value={3000}>最多 3000 字符</option><option value={9000}>最多 9000 字符</option></select></label>
      <label className="ai-check"><input type="checkbox" checked={includeStoryContext && !context?.references.length} disabled={!!context?.references.length} onChange={event => setIncludeStoryContext(event.target.checked)} />附带本小说已保存的人物、世界观与大纲摘要（最多 {aiLimits.story} 字符）</label>
      <p className="ai-note">快速摘要与逐项引用互斥。未勾选摘要、未选择引用时，只发送选文、附近正文与写作要求。</p>
    </fieldset>
    <details><summary>查看将发送的正文片段（选文 {session.snapshot.input.selection.length} 字符）</summary><div className="ai-context">前文：{(nearby ? session.snapshot.input.before.slice(-Math.ceil(nearby * 2 / 3)) : '') || '无'}{'\n\n'}选文：{session.snapshot.input.selection || '无（使用当前光标）'}{'\n\n'}后文：{session.snapshot.input.after.slice(0, Math.floor(nearby / 3)) || '无'}</div></details>
    {needsSelection && <p role="alert">请关闭预览，先选择需要处理的正文。</p>}
    {tooLong && <p role="alert">选文超过 {aiLimits.selection} 字符，请缩小选区后重试。</p>}
    {stale && <p role="alert">正文已变化，当前结果不能接受。请关闭后基于新正文重新生成。</p>}
    {!parametersValid && <p role="alert">请在模型配置中心填写范围内的生成参数。</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {loading && <p role="status">正在生成… 可随时取消；模型服务可能仍计费用量。</p>}
    {result && <section aria-label="AI 结果预览"><h3>{resultAction === 'inspire' ? '创作建议' : '正文预览'}</h3>{resultAction === 'inspire' ? <div className="ai-preview">{result.text}</div> : <ResultComparison before={resultAction === 'continue' ? '' : session.snapshot.input.selection} after={result.text} />}<p className="ai-note">{result.modelId ? `模型 ${result.modelId} · ` : ''}输入 {result.usage.inputTokens ?? '未知'} / 输出 {result.usage.outputTokens ?? '未知'} tokens · 费用以模型服务账单为准{result.finishReason === 'length' ? ' · 已达到输出上限，结果可能不完整' : ''}</p>{result.estimate && <p className="ai-note">本次保守预留 {result.estimate.reservedTokens} tokens{result.estimate.maxUsd === null ? ' · 美元费用未知' : ` · 按配置报价最多约 $${result.estimate.maxUsd.toFixed(6)}`}。取消重新生成会保留上一份预览。</p>}</section>}
    {action === 'inspire' && <p className="ai-note">灵感仅作参考，不提供替换正文；可自行选择建议继续创作。</p>}
    <div className="button-row">
      <button onClick={close}>{result ? '放弃' : '关闭'}</button>
      {loading ? <button onClick={() => { pending.current?.abort(); pending.current = null; setLoading(false); setError('请求已取消；正文未修改。') }}>取消请求</button> : <button className="primary" disabled={!canGenerate} onClick={() => { void generate() }}>{result ? '重新生成' : '生成预览'}</button>}
      {result && resultAction !== 'inspire' && <button className="primary" disabled={disabled || stale || loading} onClick={accept}>{resultAction === 'continue' ? '接受并插入' : '接受并替换选文'}</button>}
    </div>
  </dialog>
}
