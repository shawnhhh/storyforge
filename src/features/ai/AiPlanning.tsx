import { useEffect, useRef, useState } from 'react'
import { defaultGeneration, referenceKinds, type AiCatalog, type ContextChoice, type ContextReference } from '../../../shared/contracts/ai'
import { planningKinds, type PlanningGenerationInput, type PlanningGenerationResult, type PlanningKind, type PlanningProposal, type PlanningRequestPreview, type PlanningSaveResult } from '../../../shared/contracts/ai-planning'
import type { PlanningSnapshot } from '../../../shared/contracts/planning'
import type { ChapterSummary } from '../../../shared/contracts/novels'
import { request } from '../../shared/api/client'
import { LocalDialog } from '../../shared/ui/LocalDialog'
import { ModelCenter } from './ModelCenter'
import './ai-planning.css'

export function AiPlanning({ novelId, chapters, disabled, autoFocus, onSaved, onClose }: { novelId: string; chapters: ChapterSummary[]; disabled: boolean; autoFocus: boolean; onSaved: () => void; onClose: () => void }) {
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const restored = useRef(false)
  useEffect(() => { if (autoFocus && !disabled && !restored.current) { trigger.current?.focus({ preventScroll: true }); restored.current = true } }, [autoFocus, disabled])
  return <><button ref={trigger} disabled={disabled} onClick={event => setOpener(event.currentTarget)}>AI 世界观与大纲</button>{opener && <PlanningDialog novelId={novelId} chapters={chapters} opener={opener} onClose={() => { setOpener(null); onClose() }} onSaved={onSaved} />}</>
}
function PlanningDialog({ novelId, chapters, opener, onClose, onSaved }: { novelId: string; chapters: ChapterSummary[]; opener: HTMLElement; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<AiCatalog | null>(null)
  const [choices, setChoices] = useState<ContextChoice[]>([])
  const [plan, setPlan] = useState<PlanningSnapshot | null>(null)
  const [modelId, setModelId] = useState('')
  const [parameters, setParameters] = useState(defaultGeneration)
  const [kind, setKind] = useState<PlanningKind>('world')
  const [instructions, setInstructions] = useState('')
  const [references, setReferences] = useState<ContextReference[]>([])
  const [maxCharacters, setMaxCharacters] = useState(6000)
  const [parentId, setParentId] = useState<string | null>(null)
  const [chapterIds, setChapterIds] = useState<string[]>([])
  const [preview, setPreview] = useState<{ key: string; data: PlanningRequestPreview } | null>(null)
  const [result, setResult] = useState<PlanningGenerationResult | null>(null)
  const [proposal, setProposal] = useState<PlanningProposal | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'generate' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void Promise.all([
      request<AiCatalog>('/ai/models', 'GET', undefined, controller.signal),
      request<ContextChoice[]>(`/ai/novels/${novelId}/context`, 'GET', undefined, controller.signal),
      request<PlanningSnapshot>(`/novels/${novelId}/planning`, 'GET', undefined, controller.signal),
    ]).then(([models, sources, snapshot]) => { if (!controller.signal.aborted) { setCatalog(models); setChoices(sources); setPlan(snapshot) } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法加载生成配置，请关闭后重试') })
    return () => { alive.current = false; controller.abort(); pending.current?.abort() }
  }, [novelId])
  const model = catalog?.models.find(item => item.id === modelId) ?? catalog?.models.find(item => item.configured) ?? catalog?.models[0]
  const effectiveParameters = { ...parameters, maxOutputTokens: Math.min(parameters.maxOutputTokens, model?.maxOutputTokens ?? 4096) }
  const input: PlanningGenerationInput = { novelId, kind, instructions, modelId: model?.id ?? '', parameters: effectiveParameters, context: { references, maxCharacters }, parentId, chapterIds }
  const key = JSON.stringify(input)
  const ready = preview?.key === key
  const currentResult = result && preview?.key === key
  function download() {
    if (!proposal) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind, proposal, expiresAt: result?.expiresAt }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'StoryForge-AI预览.json'; link.click(); URL.revokeObjectURL(url)
  }
  function close() {
    if (busy === 'save') return
    if (proposal && !saved && !window.confirm('关闭将放弃未保存的 AI 预览。可先取消并导出预览。确认关闭？')) return
    pending.current?.abort(); onClose()
  }
  async function perform(action: 'preview' | 'generate' | 'save') {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller
    setBusy(action); setError(''); setNotice('')
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(action === 'generate' ? 125000 : 15000)])
      if (action === 'preview') {
        const data = await request<PlanningRequestPreview>('/ai/planning/preview', 'POST', input, signal)
        if (!signal.aborted && alive.current) { setPreview({ key, data }); setResult(null); setProposal(null); setSaved(false) }
      } else if (action === 'generate' && ready) {
        const data = await request<PlanningGenerationResult>('/ai/planning/generate', 'POST', { ...input, fingerprint: preview.data.fingerprint }, signal)
        if (!signal.aborted && alive.current) { setResult(data); setProposal(data.proposal); setSaved(false) }
      } else if (action === 'save' && result && proposal && currentResult) {
        await request<PlanningSaveResult>('/ai/planning/save', 'POST', { previewId: result.previewId, proposal, confirmed: true }, signal)
        if (alive.current) { setSaved(true); setNotice('已新增保存。点击“完成”返回规划，人物与世界观可到资料库继续编辑。'); onSaved() }
      }
    } catch (reason) {
      if (!controller.signal.aborted && alive.current) setError(reason instanceof Error && reason.name === 'TimeoutError' ? (action === 'save' ? '保存响应超时，结果可能已保存；请使用相同预览重试，系统会避免重复新增。' : '请求超时，请核对本地服务或缩短要求后重试。') : reason instanceof Error ? reason.message : '请求失败，请重试')
    } finally {
      if (pending.current === controller) { pending.current = null; if (alive.current) setBusy(null) }
      if (alive.current) void request<AiCatalog>('/ai/models').then(value => { if (alive.current) setCatalog(value) }).catch(() => {})
    }
  }
  return <LocalDialog title="AI 世界观与大纲" className="ai-planning-dialog ap-dialog" returnFocusTo={opener} onClose={close}>
    <p className="ap-note">一次生成一项设定或大纲。先核对发送内容，再编辑结果并确认新增。已有小说、正文和资料保持原样。</p>
    <ModelCenter catalog={catalog} modelId={model?.id ?? ''} parameters={effectiveParameters} disabled={!!busy || !!result} onModel={setModelId} onParameters={setParameters} />
    <fieldset disabled={!!busy || !!result} className="ap-options">
      <label>生成类型<select value={kind} onChange={event => { setKind(event.target.value as PlanningKind); setParentId(null); setChapterIds([]) }}>{Object.entries(planningKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>创作要求<textarea maxLength={1000} rows={3} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="题材、风格、目标、约束，以及希望生成的这一项内容" /></label>
      {(kind === 'volume' || kind === 'chapter') && <label>归属大纲<select value={parentId ?? ''} onChange={event => setParentId(event.target.value || null)}><option value="">无（顶层）</option>{plan?.outlines.filter(item => item.kind === (kind === 'chapter' ? 'volume' : 'overall')).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      {kind === 'chapter' && <fieldset><legend>关联已有章节（可选）</legend>{chapters.map(chapter => <label className="ap-check" key={chapter.id}><input type="checkbox" checked={chapterIds.includes(chapter.id)} onChange={event => setChapterIds(event.target.checked ? [...chapterIds, chapter.id] : chapterIds.filter(id => id !== chapter.id))} />{chapter.title}</label>)}</fieldset>}
      <details><summary>按需引用已保存资料 · {references.length}/8</summary><p className="ap-note">仅发送勾选的资料，默认不发送原稿、小说简介或资料库内容。</p><label>引用总长度<select value={maxCharacters} onChange={event => setMaxCharacters(Number(event.target.value))}>{[1000, 3000, 6000, 12000].map(n => <option key={n} value={n}>{n} 字符</option>)}</select></label><div className="ap-sources">{choices.map(item => {
        const checked = references.some(ref => ref.kind === item.kind && ref.id === item.id)
        return <label className="ap-check" key={`${item.kind}:${item.id}`}><input type="checkbox" checked={checked} disabled={!checked && references.length >= 8} onChange={() => setReferences(checked ? references.filter(ref => ref.kind !== item.kind || ref.id !== item.id) : [...references, { kind: item.kind, id: item.id }])} />{referenceKinds[item.kind]}：{item.label}</label>
      })}{!choices.length && <p>暂无资料，可从空白世界开始。</p>}</div></details>
    </fieldset>
    {ready && <section aria-label="发送内容预览"><h3>发送内容预览</h3><p>输入上界 {preview.data.estimate.inputTokensUpperBound} tokens · 总预留 {preview.data.estimate.reservedTokens} tokens · {preview.data.estimate.maxUsd === null ? '未配置报价，美元费用未知' : `最高约 $${preview.data.estimate.maxUsd.toFixed(6)}`}</p><p>模型：{model?.label} / {model?.model} · 温度 {effectiveParameters.temperature} · top-p {effectiveParameters.topP} · 输出上限 {effectiveParameters.maxOutputTokens}</p><ul>{preview.data.context.sources.map(source => <li key={`${source.kind}:${source.id}`}>{source.label}：{source.characters}/{source.originalCharacters} 字符{source.truncated ? '（已截断）' : ''}</li>)}</ul><details><summary>查看完整 messages</summary><pre>{JSON.stringify(preview.data.messages, null, 2)}</pre></details><p className="ap-note">点击“确认发送并生成”会将以上内容发送至所选模型服务。失败、取消与重试也计入保守预算。</p></section>}
    {result && proposal && <section aria-label="生成结果预览"><h3>生成结果预览 · {saved ? '已新增保存' : '尚未保存'}</h3><p className="ap-note">{kind === 'world' ? '将新增到世界观「其他设定」。' : kind === 'character' ? '将新增人物，完整档案保存到人物备注；可在人物档案中继续整理字段与关系。' : '将新增到现有创作规划，保留归属与章节关联。'}预览有效至 {new Date(result.expiresAt).toLocaleTimeString()}，请及时保存或导出。</p><fieldset disabled={busy === 'save' || saved} className="ap-options"><label>预览标题<input maxLength={200} value={proposal.title} onChange={event => setProposal({ ...proposal, title: event.target.value })} /></label><label>预览内容<textarea rows={12} maxLength={20000} value={proposal.content} onChange={event => setProposal({ ...proposal, content: event.target.value })} /></label></fieldset><p>输入 {result.usage.inputTokens ?? '未知'} / 输出 {result.usage.outputTokens ?? '未知'} tokens</p></section>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">{busy === 'save' ? '正在确认保存…' : busy === 'generate' ? '正在生成预览…' : '正在核对发送内容…'}</p>}
    <div className="ap-actions">
      {!result && <button disabled={!!busy || !model?.configured || !plan || !instructions.trim()} onClick={() => { void perform('preview') }}>核对发送内容</button>}
      {!result && ready && <button className="primary" disabled={!!busy} onClick={() => { void perform('generate') }}>确认发送并生成</button>}
      {busy && busy !== 'save' && <button onClick={() => { pending.current?.abort(); pending.current = null; setBusy(null); setNotice('请求已取消；已有内容未修改。') }}>取消请求</button>}
      {result && <><button disabled={busy === 'save'} onClick={download}>导出预览</button><button disabled={!!busy || saved} onClick={() => { if (window.confirm('放弃当前预览并重新设置？已有原稿不受影响。')) { setResult(null); setProposal(null); setPreview(null); setSaved(false) } }}>放弃并重新设置</button><button className="primary" disabled={!!busy || saved || !currentResult || !proposal?.title.trim() || !proposal?.content.trim()} onClick={() => { void perform('save') }}>{saved ? '已保存' : '确认新增保存'}</button></>}
    </div>
  </LocalDialog>
}
