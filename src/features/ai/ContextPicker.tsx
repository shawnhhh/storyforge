import { useEffect, useState } from 'react'
import { referenceKinds, type ContextChoice, type ContextReference, type ContextSelection, type ContextPreview } from '../../../shared/contracts/ai'
import { request } from '../../shared/api/client'

export function ContextPicker({ chapterId, disabled, onChange }: { chapterId: string; disabled: boolean; onChange: (value: ContextSelection | undefined) => void }) {
  const [choices, setChoices] = useState<ContextChoice[]>([])
  const [selected, setSelected] = useState<ContextReference[]>([])
  const [budget, setBudget] = useState(6000)
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [preview, setPreview] = useState<{ key: string; data: ContextPreview } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const key = JSON.stringify({ selected, budget, refresh })
  useEffect(() => {
    const controller = new AbortController()
    request<ContextChoice[]>(`/ai/chapters/${chapterId}/context`, 'GET', undefined, controller.signal).then(setChoices).catch(reason => { if (!controller.signal.aborted) setError({ key: 'choices', message: reason instanceof Error ? reason.message : '无法加载引用目录' }) })
    return () => controller.abort()
  }, [chapterId])
  useEffect(() => {
    if (!selected.length) return
    const controller = new AbortController()
    const context = { references: selected, maxCharacters: budget }
    request<ContextPreview>('/ai/context/preview', 'POST', { chapterId, context }, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setPreview({ key, data }); onChange({ ...context, fingerprint: data.fingerprint })
    }).catch(reason => { if (!controller.signal.aborted) setError({ key, message: reason instanceof Error ? reason.message : '引用预览失败' }) })
    return () => controller.abort()
  }, [chapterId, selected, budget, refresh, key, onChange])
  function select(next: ContextReference[]) { setSelected(next); onChange(next.length ? { references: next, maxCharacters: budget } : undefined) }
  const ready = preview?.key === key
  return <details className="ai-settings">
    <summary>按需引用 · 已选 {selected.length}/8 项</summary>
    <p className="ai-note">只把你勾选的本小说资料加入请求。引用正文取已保存版本；当前章节的未保存内容仍使用编辑器快照。片段按选择顺序均分总长度。</p>
    <fieldset disabled={disabled} className="ai-options">
      <label>搜索引用<input aria-label="搜索引用" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>引用总长度<select aria-label="引用总长度" value={budget} onChange={event => { const next = Number(event.target.value); setBudget(next); if (selected.length) onChange({ references: selected, maxCharacters: next }) }}><option value={1000}>1000 字符</option><option value={3000}>3000 字符</option><option value={6000}>6000 字符</option><option value={12000}>12000 字符</option></select></label>
      <div className="ai-reference-list">{Object.entries(referenceKinds).map(([kind, label]) => {
        const items = choices.filter(choice => choice.kind === kind && choice.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        return items.length ? <section key={kind}><h4>{label}</h4>{items.map(choice => {
          const checked = selected.some(ref => ref.kind === choice.kind && ref.id === choice.id)
          return <label className="ai-check" key={choice.id}><input type="checkbox" checked={checked} disabled={!checked && selected.length >= 8} onChange={() => select(checked ? selected.filter(ref => ref.kind !== choice.kind || ref.id !== choice.id) : [...selected, { kind: choice.kind, id: choice.id }])} />{label}：{choice.label}</label>
        })}</section> : null
      })}</div>
      {!choices.length && <p className="ai-note">暂无可引用的已保存资料或其他章节。</p>}
      {!!selected.length && <button type="button" onClick={() => { onChange({ references: selected, maxCharacters: budget }); setRefresh(value => value + 1) }}>刷新引用预览</button>}
    </fieldset>
    {!!selected.length && !ready && error?.key !== key && <p role="status">正在核对引用…</p>}
    {error && (error.key === key || error.key === 'choices') && <p role="alert" className="ai-error">{error.message}</p>}
    {!!selected.length && ready && <section aria-label="引用内容预览"><p>将发送 {preview.data.characters}/{budget} 字符（含标题）。</p><ul>{preview.data.sources.map(source => <li key={`${source.kind}:${source.id}`}>{source.label}：{source.characters}/{source.originalCharacters} 字符{source.truncated ? ' · 已截断' : ''}</li>)}</ul><div className="ai-context">{preview.data.text}</div></section>}
  </details>
}
