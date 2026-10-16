import { useEffect, useRef, useState } from 'react'
import type { WritingDashboard } from '../../../shared/contracts/dashboard'
import type { Novel } from '../../../shared/contracts/novels'
import { dashboardApi } from './api'

const number = (value: number) => value.toLocaleString('zh-CN')
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export function Dashboard({ disabled, revision, onOpen, onCreate }: {
  disabled: boolean
  revision: number
  onOpen: (novel: Novel, chapterId?: string) => void
  onCreate: () => void
}) {
  const [data, setData] = useState<WritingDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [goalError, setGoalError] = useState('')
  const [goal, setGoal] = useState('')
  const goalDirty = useRef(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    dashboardApi.read(controller.signal).then(result => {
      setData(result); if (!goalDirty.current) setGoal(String(result.dailyGoal)); setError('')
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取创作统计')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, retry])
  // Refresh on return to this tab and across UTC midnight, without touching drafts.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRetry(value => value + 1) }
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { document.removeEventListener('visibilitychange', refresh); window.clearInterval(timer) }
  }, [])
  async function saveGoal(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setGoalError(''); setNotice('')
    const value = Number(goal)
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) { setGoalError('请输入 1 至 1,000,000 的整数'); return }
    setSaving(true)
    try {
      const result = await dashboardApi.setGoal(value)
      setData(current => current ? { ...current, dailyGoal: result.dailyGoal } : current)
      goalDirty.current = false
      setNotice('每日目标已保存')
    } catch (reason) { setGoalError(reason instanceof Error ? reason.message : '目标保存失败，请重试') }
    finally { setSaving(false) }
  }
  const recent = data?.recent[0]
  const resume = recent && data?.novels.find(item => item.novel.id === recent.novelId)
  const progress = data ? Math.min(100, Math.round(data.todayWords / data.dailyGoal * 100)) : 0
  return <div className="dashboard" aria-busy={loading}>
    <div className="dashboard-intro"><div><span className="eyebrow">每一笔，都让故事更近一步</span><h2>留一点时间，给你的故事。</h2><p>把灵感写成章节，让创作成为日常。</p></div><button className="primary" disabled={disabled} onClick={onCreate}>新建作品</button></div>
    {error && <div className="dashboard-error" role="alert">{error}<button disabled={loading} onClick={() => { setLoading(true); setRetry(value => value + 1) }}>重试读取工作台</button></div>}
    {loading && !data && <p role="status">正在整理创作工作台…</p>}
    {data && <>
      <section className="dashboard-metrics" aria-label="创作概览">
        {[['作品', data.novels.length, '个故事世界'], ['总字数', data.totalWords, '与编辑器统计一致'], ['章节进度', data.writtenChapters, `/ ${number(data.totalChapters)} 章已有正文`], ['连续写作', data.streak, `天 · 最长 ${number(data.longestStreak)} 天`]].map(([label, value, hint]) => <div className="metric" key={label}><span>{label}</span><strong>{number(Number(value))}</strong><small>{hint}</small></div>)}
      </section>
      <div className="dashboard-columns">
        <section className="dashboard-card resume-card" aria-labelledby="resume-title"><span className="eyebrow">从上次落笔的地方</span><h3 id="resume-title">继续写作</h3>{recent && resume ? <><h4>{recent.novelTitle}</h4><p>{recent.title} · {number(recent.words)} 字</p><small>最近编辑于 {timestamp(recent.updatedAt)}</small><button className="primary" disabled={disabled} onClick={() => onOpen(resume.novel, recent.id)}>继续写作 →</button></> : <><p>{data.novels.length ? '选一部作品，写下新的篇章。' : '你的故事，值得一个开始。'}</p><button className="primary" disabled={disabled} onClick={() => data.novels[0] ? onOpen(data.novels[0].novel) : onCreate()}>{data.novels.length ? '开始写作 →' : '创建第一部作品'}</button></>}</section>
        <section className="dashboard-card" aria-labelledby="goal-title"><div className="card-heading"><h3 id="goal-title">每日写作目标</h3><span>{progress}%</span></div><p className="goal-total"><strong>{number(data.todayWords)}</strong> / {number(data.dailyGoal)} 字</p><progress aria-label="每日写作目标进度" value={data.todayWords} max={Math.max(data.dailyGoal, data.todayWords)} /><p className="goal-caption">{data.todayWords >= data.dailyGoal ? '今日目标已达成，给坚持的自己一点掌声。' : `再写 ${number(data.dailyGoal - data.todayWords)} 字，完成今天的小目标。`}</p><form className="goal-form" onSubmit={saveGoal} noValidate><label htmlFor="daily-goal">每日目标（字）</label><div><input id="daily-goal" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={goal} disabled={saving} aria-describedby={goalError ? 'goal-error' : undefined} aria-invalid={!!goalError} onChange={event => { goalDirty.current = true; setGoal(event.target.value); setNotice('') }} /><button disabled={disabled || saving} type="submit">{saving ? '保存中…' : '保存目标'}</button></div></form>{goalError && <p id="goal-error" className="goal-error" role="alert">{goalError}</p>}{notice && <p role="status" className="goal-caption">{notice}</p>}</section>
      </div>
      <section className="dashboard-card" aria-labelledby="history-title"><div className="card-heading"><h3 id="history-title">写作足迹</h3><small>最近 14 天 · UTC</small></div><div className="writing-history">{data.days.map(day => <div key={day.day} className={`writing-day ${day.words > 0 ? 'has-writing' : ''}`}><span className="day-words">{number(day.words)}</span><div className="day-bar" style={{ height: `${Math.max(4, Math.min(64, day.words / Math.max(...data.days.map(row => row.words), 1) * 64))}px` }} /><time dateTime={day.day}>{day.day.slice(5).replace('-', '/')}</time></div>)}</div><p className="dashboard-note">按 UTC 自然日累计成功保存时新增的字数；删减不扣除，等字数替换与格式修改不计入。记录从此功能启用后开始；今日未写时，连续天数延续至昨日。</p></section>
      <section className="dashboard-card" aria-labelledby="works-title"><div className="card-heading"><h3 id="works-title">我的作品</h3><small>{data.novels.length} 部作品</small></div>{!data.novels.length ? <div className="dashboard-empty"><p>还没有作品，先为灵感起个名字。</p><button disabled={disabled} onClick={onCreate}>创建小说</button></div> : <div className="dashboard-works">{data.novels.map(item => <article className="dashboard-work" key={item.novel.id}><div className="work-cover" aria-hidden="true">{item.novel.title.slice(0, 1)}</div><div className="work-info"><h4>{item.novel.title}</h4><p>{item.novel.description || '故事正在生长。'}</p><small>{number(item.words)} 字 · {item.writtenChapters} / {item.chapters} 章已有正文</small><progress aria-label={`${item.novel.title}章节正文进度`} value={item.writtenChapters} max={Math.max(1, item.chapters)} /><small>最近更新 {timestamp(item.novel.updatedAt)}</small></div><button disabled={disabled} onClick={() => onOpen(item.novel, item.continueChapterId ?? undefined)}>打开作品</button></article>)}</div>}</section>
      <section className="dashboard-card" aria-labelledby="recent-title"><h3 id="recent-title">最近编辑</h3>{data.recent.length ? <ul className="dashboard-recent">{data.recent.map(item => <li key={item.id}><div><strong>{item.title}</strong><small>{item.novelTitle} · {number(item.words)} 字 · {timestamp(item.updatedAt)}</small></div><button disabled={disabled} onClick={() => { const novel = data.novels.find(row => row.novel.id === item.novelId); if (novel) onOpen(novel.novel, item.id) }}>继续编辑<span className="sr-only"> {item.title}</span></button></li>)}</ul> : <p className="dashboard-note">还没有章节。创建章节后，可在这里快速返回。</p>}</section>
    </>}
  </div>
}
