import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { defaultGeneration, type AiCatalog, type ContextSelection } from '../../../shared/contracts/ai'
import { reviewCategories, reviewChapterLimit, type ReviewInput, type ReviewPreview, type ReviewResult } from '../../../shared/contracts/consistency-review'
import { request, ApiError } from '../../shared/api/client'
import { ContextPicker } from './ContextPicker'
import { ModelCenter } from './ModelCenter'

interface Snapshot { doc: ProseMirrorNode; text: string; scroll: number }
export function ConsistencyReview({ editor, chapterId, disabled }: { editor: Editor; chapterId: string; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  return <>
    <button disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
      if (editor.view.composing) return
      const doc = editor.state.doc
      setSnapshot({ doc, text: doc.textBetween(0, doc.content.size, '\n', '\n'), scroll: editor.view.dom.closest('.document')?.scrollTop ?? 0 })
    }}>一致性审阅</button>
    {snapshot && <ReviewDialog editor={editor} chapterId={chapterId} disabled={disabled} snapshot={snapshot} onClose={() => setSnapshot(null)} />}
  </>
}
function ReviewDialog({ editor, chapterId, disabled, snapshot, onClose }: { editor: Editor; chapterId: string; disabled: boolean; snapshot: Snapshot; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController | null>(null)
  const lifecycle = useRef<AbortController | null>(null)
  const [catalog, setCatalog] = useState<AiCatalog | null>(null)
  const [modelId, setModelId] = useState('')
  const [parameters, setParameters] = useState({ ...defaultGeneration, temperature: 0.2 })
  const [context, setContext] = useState<ContextSelection | undefined>()
  const [preview, setPreview] = useState<{ key: string; data: ReviewPreview } | null>(null)
  const [confirmed, setConfirmed] = useState('')
  const [result, setResult] = useState<{ key: string; data: ReviewResult; sources: ReviewPreview['sources'] } | null>(null)
  const [loading, setLoading] = useState<'preview' | 'review' | null>(null)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const changeContext = useCallback((next: ContextSelection | undefined) => { setContext(next); setPreview(null); setConfirmed('') }, [])
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const controller = new AbortController()
    lifecycle.current = controller
    request<AiCatalog>('/ai/models', 'GET', undefined, controller.signal).then(data => { if (!controller.signal.aborted) setCatalog(data) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取模型目录') })
    const changed = () => {
      if (editor.state.doc !== snapshot.doc) {
        pending.current?.abort(); pending.current = null
        setLoading(null); setStale(true); setConfirmed('')
      }
    }
    editor.on('update', changed)
    return () => { controller.abort(); lifecycle.current = null; pending.current?.abort(); pending.current = null; editor.off('update', changed); element.close() }
  }, [editor, snapshot])
  const model = catalog?.models.find(item => item.id === modelId) ?? catalog?.models.find(item => item.configured) ?? catalog?.models[0]
  const effectiveParameters = { ...parameters, maxOutputTokens: Math.min(parameters.maxOutputTokens, model?.maxOutputTokens ?? 4096) }
  const input: ReviewInput = { chapterId, chapterText: snapshot.text, context: context ?? { references: [], maxCharacters: 6000 }, modelId: model?.id ?? '', parameters: effectiveParameters }
  const key = JSON.stringify(input)
  const ready = preview?.key === key ? preview.data : null
  const validParameters = Number.isFinite(parameters.temperature) && parameters.temperature >= 0 && parameters.temperature <= 2 && Number.isFinite(parameters.topP) && parameters.topP >= 0.1 && parameters.topP <= 1 && Number.isInteger(effectiveParameters.maxOutputTokens) && effectiveParameters.maxOutputTokens >= 64
  const canPreview = !disabled && !stale && !!model && validParameters && !!snapshot.text.trim() && snapshot.text.length <= reviewChapterLimit && (!context?.references.length || !!context.fingerprint)
  function close() {
    pending.current?.abort(); pending.current = null
    dialog.current?.close()
    if (!editor.isDestroyed) {
      editor.view.focus()
      const container = editor.view.dom.closest('.document')
      if (container) container.scrollTop = snapshot.scroll
    }
    onClose()
  }
  async function run(kind: 'preview' | 'review') {
    if (pending.current || !canPreview || (kind === 'review' && (!ready || confirmed !== ready.fingerprint || !model?.configured))) return
    const controller = new AbortController()
    pending.current = controller; setLoading(kind); setError('')
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(125000)])
      if (kind === 'preview') {
        const next = await request<ReviewPreview>('/ai/review/preview', 'POST', input, signal)
        if (!controller.signal.aborted && pending.current === controller) { setPreview({ key, data: next }); setConfirmed('') }
      } else {
        const next = await request<ReviewResult>('/ai/review', 'POST', { ...input, fingerprint: ready!.fingerprint }, signal)
        if (!controller.signal.aborted && pending.current === controller && next.fingerprint === ready!.fingerprint) setResult({ key, data: next, sources: ready!.sources })
      }
    } catch (reason) {
      if (!controller.signal.aborted && pending.current === controller) {
        if (reason instanceof ApiError && [404, 409].includes(reason.status)) { setPreview(null); setConfirmed(''); setResult(null) }
        setError(reason instanceof Error && reason.name === 'TimeoutError' ? '等待审阅超时，请重新预览后重试' : reason instanceof Error ? reason.message : '审阅请求失败')
      }
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(null) }
      const current = lifecycle.current
      if (kind === 'review' && current && !current.signal.aborted) void request<AiCatalog>('/ai/models', 'GET', undefined, current.signal).then(data => { if (!current.signal.aborted) setCatalog(data) }).catch(() => {})
    }
  }
  return <dialog ref={dialog} className="ai-dialog review-dialog" aria-labelledby="review-title" onCancel={event => { event.preventDefault(); close() }}>
    <h2 id="review-title">AI 章节一致性审阅</h2>
    <p className="ai-note">检查人物身份、性格、关系，世界观与规则，章节逻辑与剧情衔接。只发送当前章节快照和你勾选的本作品资料。结果只读，建议需作者核实；未选择的章节与设定不会发送。</p>
    <p role="status">{!catalog ? '正在读取模型目录…' : !model?.configured ? '未配置 AI API Key。请在本地服务端配置后重启；仍可预览上下文，其他功能可正常使用。' : '模型已就绪 · 预览不会调用模型或消耗 AI 预算'}</p>
    <ModelCenter catalog={catalog} modelId={model?.id ?? ''} parameters={effectiveParameters} disabled={!!loading} onModel={next => { setModelId(next); setPreview(null); setConfirmed('') }} onParameters={next => { setParameters(next); setPreview(null); setConfirmed('') }} />
    <ContextPicker chapterId={chapterId} disabled={!!loading} onChange={changeContext} />
    <p className="ai-note">当前章节 {snapshot.text.length}/{reviewChapterLimit} 字符，完整发送，不自动截断。其他章节仅在逐项勾选后发送；截断资料无法代表完整背景。</p>
    {!snapshot.text.trim() && <p role="alert">当前章节为空，请先填写正文。</p>}
    {snapshot.text.length > reviewChapterLimit && <p role="alert">章节过长，无法完整审阅；不会自动截断正文。</p>}
    {!validParameters && <p role="alert">请填写范围内的模型参数。</p>}
    {stale && <p role="alert">正文已变化，已停止请求。旧结果已过期，请关闭后重新审阅。</p>}
    {ready && <section aria-label="实际发送的上下文" className="review-send">
      <h3>核对实际发送内容</h3>
      <p className="ai-note">模型：{model?.label} · {model?.model}；参数：{JSON.stringify(effectiveParameters)}</p>
      {ready.sources.map(source => <p className="ai-note" key={source.id}>{source.label} · {source.text.length} 字符{source.truncated ? ' · 已截断，仅审阅所示片段' : ''}</p>)}
      {ready.messages.map((message, index) => <details key={index} open><summary>{message.role === 'system' ? '审阅系统指令' : '当前章节与所选资料（完整请求内容）'}</summary><div className="ai-context">{message.content}</div></details>)}
      <p className="ai-note">保守输入估算 {ready.estimate.inputTokensUpperBound} tokens；共预留 {ready.estimate.reservedTokens} tokens；{ready.estimate.maxUsd === null ? '美元费用未知' : `按配置报价最多约 $${ready.estimate.maxUsd.toFixed(6)}`}。实际账单以提供商为准。</p>
      <label className="ai-check"><input type="checkbox" disabled={!!loading || stale} checked={confirmed === ready.fingerprint} onChange={event => setConfirmed(event.target.checked ? ready.fingerprint : '')} />我已核对以上实际发送内容，同意发送至所选模型</label>
    </section>}
    {!ready && preview && <p role="status">引用或模型设置已变化，请重新预览并确认。</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {loading && <p role="status">{loading === 'preview' ? '正在核对上下文…' : '正在审阅… 取消或失败仍计入保守预算，模型服务可能继续计费。'}</p>}
    {result && <section aria-label="一致性审阅结果" className="review-results">
      <h3>只读审阅结果</h3>
      {(stale || result.key !== key || !ready || result.data.fingerprint !== ready.fingerprint) && <p role="alert">这份旧结果基于先前的正文或引用，不能代表当前内容。</p>}
      <p className="ai-note">引用校验仅确认原文存在，不证明模型判断正确。所有结论均需作者核实；审阅范围仅限已发送内容。</p>
      {(['conflict', 'suggestion'] as const).map(certainty => <section key={certainty} aria-label={certainty === 'conflict' ? '有引用依据的疑似冲突' : '不确定建议'}>
        <h4>{certainty === 'conflict' ? '有引用依据的疑似冲突' : '不确定建议'}</h4>
        {!result.data.findings.some(finding => finding.certainty === certainty) && <p className="ai-note">本次未报告此类问题，不表示作品没有问题。</p>}
        {result.data.findings.filter(finding => finding.certainty === certainty).map((finding, index) => <article className="review-finding" key={index}>
          <strong>{reviewCategories[finding.category]}</strong>
          {certainty === 'suggestion' && <p className="ai-note">待核实的可能问题，以下为模型建议，不能视为事实。</p>}
          <p>{finding.explanation}</p>
          {finding.evidenceIncomplete && <p className="ai-note">引用缺失或未通过原文校验，已降为不确定建议。</p>}
          {finding.evidence.map((evidence, i) => <blockquote key={i}><small>{result.sources.find(source => source.id === evidence.sourceId)?.label ?? '已发送资料'}</small><p>{evidence.quote}</p></blockquote>)}
          <p>修改建议：{finding.suggestion}</p>
        </article>)}
      </section>)}
      <p className="ai-note">模型 {result.data.modelId} · 输入 {result.data.usage.inputTokens ?? '未知'} / 输出 {result.data.usage.outputTokens ?? '未知'} tokens{result.data.finishReason === 'length' ? ' · 达到输出上限，结果可能不完整' : ''}。结果不持久保存，关闭后清除。</p>
    </section>}
    <div className="button-row"><button onClick={close}>关闭</button>{loading ? <button onClick={() => { pending.current?.abort(); pending.current = null; setLoading(null); setError('请求已取消；正文未修改，保留上一份审阅结果。') }}>取消请求</button> : <>
      <button disabled={!canPreview} onClick={() => { void run('preview') }}>预览发送上下文</button>
      <button className="primary" disabled={!canPreview || !ready || confirmed !== ready.fingerprint || !model?.configured} onClick={() => { void run('review') }}>{result ? '确认并重新审阅' : '确认并开始审阅'}</button>
    </>}</div>
  </dialog>
}
