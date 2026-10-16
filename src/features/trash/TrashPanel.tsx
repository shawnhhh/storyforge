import type { TrashEntry as Entry, TrashPreview } from '../../../shared/contracts/trash'
import { LocalDialog } from '../../shared/ui/LocalDialog'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { NameConfirmation } from './DeleteNovelDialog'
import './trash.css'

const kinds: Record<string, string> = { novel: '小说', chapter: '章节', characters: '人物', world: '世界设定', planning: '创作规划', relation: '人物关系与关联', reference: '资料引用' }
const tables: Record<string, string> = { novels: '小说', chapters: '章节', characters: '人物', world_entries: '世界设定', planning_records: '规划', planning_chapter_links: '规划章节引用', character_relations: '人物关系', character_world_links: '人物设定关联', knowledge_links: '资料引用', planningReferences: '规划关联变更' }
export function TrashPanel({ onChange }: { onChange: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<TrashPreview | null>(null)
  const [purge, setPurge] = useState<Entry | null>(null)
  const active = useRef(false)
  useEffect(() => {
    let mounted = true
    request<Entry[]>('/trash').then(rows => { if (mounted) setEntries(rows) }).catch(reason => { if (mounted) setError(String(reason.message)) }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])
  async function run(operation: () => Promise<void>) {
    if (active.current) return
    active.current = true; setNow(Date.now()); setBusy(true); setError(''); setNotice('')
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，回收站记录已保留') }
    finally { active.current = false; setBusy(false) }
  }
  return <section className="trash-panel" aria-label="回收站内容" aria-busy={loading || busy}>
    <p>已删除的创作内容保留 30 天。恢复会同时检查关联；请先恢复所属小说及关联目标。到期后由本地服务自动清理，备份按独立策略保留。</p>
    <button disabled={busy} onClick={() => { void run(async () => { setEntries(await request<Entry[]>('/trash')); setLoading(false) }) }}>刷新回收站</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">正在读取回收站…</p> : !entries.length ? <p className="trash-empty">回收站为空</p> : <ul className="trash-list">{entries.map(entry => {
      const expired = Date.parse(entry.expiresAt) <= now
      const scope = Object.entries(entry.affected).filter(([key]) => tables[key]).map(([key, count]) => `${tables[key]} ${count} 项`).join('、')
      return <li key={entry.id}><div><strong>{entry.name}</strong><small>{kinds[entry.kind] ?? entry.kind} · 删除于 {new Date(entry.deletedAt).toLocaleString('zh-CN')}</small><small>{expired ? '已到期，等待清理' : `保留至 ${new Date(entry.expiresAt).toLocaleString('zh-CN')}`}</small><p>影响范围：{scope}</p></div><div className="button-row">
        <button disabled={busy} onClick={() => { void run(async () => { setPreview(await request<TrashPreview>(`/trash/${entry.id}`)) }) }}>查看内容</button>
        <button disabled={busy || expired} onClick={() => { if (!window.confirm(`恢复“${entry.name}”？将恢复${scope}。关联不完整或数据已变化时将阻止恢复。`)) return; void run(async () => { await request(`/trash/${entry.id}/restore`, 'POST', { confirmed: true }); setEntries(rows => rows.filter(row => row.id !== entry.id)); onChange(); setNotice(`已恢复“${entry.name}”`) }) }}>恢复</button>
        <details className="delete-menu"><summary>···</summary><button className="danger" disabled={busy} onClick={() => { setError(''); setPurge(entry) }}>永久删除</button></details>
      </div></li>
    })}</ul>}
    {preview && <LocalDialog title={`回收站内容：${preview.name}`} onClose={() => setPreview(null)}>{preview.documents.map((doc, index) => <article className="trash-preview" key={index}><h3>{doc.title}</h3><p>{doc.text || '暂无正文内容'}</p></article>)}</LocalDialog>}
    {purge && <NameConfirmation name={purge.name} title="永久删除" action="永久删除" description="将彻底移除这一回收站记录及其中的关联快照，无法从回收站恢复。活动创作内容不受影响。请再次核对名称。" busy={busy} error={error} onClose={() => { setPurge(null); setError('') }} onConfirm={name => { void run(async () => { await request(`/trash/${purge.id}`, 'DELETE', { confirmed: true, name }); setEntries(rows => rows.filter(row => row.id !== purge.id)); setPurge(null); setNotice('已永久删除') }) }} />}
  </section>
}
