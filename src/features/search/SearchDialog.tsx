import { useEffect, useState } from 'react'
import { searchKinds, type SearchHit, type SearchKind, type SearchResults } from '../../../shared/contracts/search'
import type { Novel } from '../../../shared/contracts/novels'
import { request } from '../../shared/api/client'
import { LocalDialog } from '../../shared/ui/LocalDialog'

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  if (!needle) return text
  const parts = []; let from = 0, index = text.toLowerCase().indexOf(needle)
  while (index >= 0) {
    parts.push(text.slice(from, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>)
    from = index + needle.length; index = text.toLowerCase().indexOf(needle, from)
  }
  return <>{parts}{text.slice(from)}</>
}
export function SearchDialog({ novels, blocked, onSelect, onClose }: { novels: Novel[]; blocked: boolean; onSelect: (hit: SearchHit) => Promise<boolean>; onClose: () => void }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState<SearchKind | ''>(''), [novelId, setNovelId] = useState('')
  const [offset, setOffset] = useState(0), [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<SearchResults | null>(null), [loading, setLoading] = useState(false), [opening, setOpening] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setError('')
      if (!query.trim()) { setResult(null); setLoading(false); return }
      setLoading(true)
      request<SearchResults>(`/search?${new URLSearchParams({ q: query, kind, novelId, offset: String(offset) })}`, 'GET', undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) setResult(value) })
        .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '搜索失败') })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, kind, novelId, offset, attempt])
  function reset() { setOffset(0); setResult(null); setLoading(true); setError('') }
  return <LocalDialog title="统一搜索" onClose={onClose} className="search-dialog">
    <p className="local-note">搜索本机已保存的作品与资料 · 标题和内容均可检索</p>
    <input autoFocus type="search" aria-label="统一搜索关键词" placeholder="搜索小说、正文、人物、世界观与规划…" maxLength={200} value={query} onChange={event => { reset(); setQuery(event.target.value) }} />
    <div className="search-filters"><select aria-label="搜索类型" value={kind} onChange={event => { reset(); setKind(event.target.value as SearchKind | '') }}><option value="">全部类型</option>{Object.entries(searchKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="搜索小说范围" value={novelId} onChange={event => { reset(); setNovelId(event.target.value) }}><option value="">全部小说</option>{novels.map(novel => <option key={novel.id} value={novel.id}>{novel.title}</option>)}</select></div>
    {blocked && <p className="local-note">当前存在未保存修改或正在操作。保存完成后即可打开搜索结果。</p>}
    {error && <p role="alert">{error}<button onClick={() => { setResult(null); setAttempt(value => value + 1) }}>重试搜索</button></p>}
    <div role="status" className="search-status">{loading ? '正在搜索…' : !query.trim() ? '输入关键词开始搜索' : result ? result.hits.length ? `第 ${offset + 1}–${offset + result.hits.length} 条${result.hasMore ? ' · 还有更多结果' : ''}` : '没有匹配的结果' : ''}</div>
    <ul className="search-results">{!loading && result?.hits.map(hit => <li key={`${hit.novelId}:${hit.kind}:${hit.id}`}><button disabled={blocked || opening || !!error} onClick={() => {
      setOpening(true); setError('')
      void onSelect(hit).then(success => { if (success) onClose() }).catch(reason => setError(reason instanceof Error ? reason.message : '条目可能已删除，请重试搜索')).finally(() => setOpening(false))
    }}><small>{hit.novelTitle} · {searchKinds[hit.kind]}</small><strong><Highlight text={hit.title} query={query} /></strong><span><Highlight text={hit.excerpt} query={query} /></span></button></li>)}</ul>
    <div className="search-pagination"><button disabled={loading || offset === 0} onClick={() => { setResult(null); setOffset(value => Math.max(0, value - 50)) }}>上一页</button><button disabled={loading || !result?.hasMore} onClick={() => { setResult(null); setOffset(value => value + 50) }}>下一页</button></div>
  </LocalDialog>
}
