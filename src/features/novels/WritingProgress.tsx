import { memo, useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { statisticsKey } from './editor-statistics'

const defaultGoal = 2000
const validGoal = (value: number) => Number.isInteger(value) && value >= 1 && value <= 1000000

// Presentation-only target; chapter content and the autosave queue are untouched.
export const WritingProgress = memo(function WritingProgress({ editor, chapterId, focused, disabled }: { editor: Editor; chapterId: string; focused: boolean; disabled: boolean }) {
  const key = `storyforge:writing-goal:v1:${chapterId}`
  const [goal, setGoal] = useState(() => {
    try { const stored = Number(localStorage.getItem(key)); return validGoal(stored) ? stored : defaultGoal }
    catch { return defaultGoal }
  })
  const [input, setInput] = useState(String(goal))
  const [notice, setNotice] = useState('')
  const total = useEditorState({ editor, selector: ({ editor: current }) => current && !current.isDestroyed ? statisticsKey.getState(current.state)?.total ?? 0 : 0 }) ?? 0
  const percent = Math.min(100, Math.floor(total / goal * 100))
  return <div className="writing-progress">
    <details className="chapter-goal">
      <summary aria-label="当前章节写作进度">本章 {total} / {goal} 字 · {percent}%</summary>
      <div className="goal-settings">
        <form onSubmit={event => {
          event.preventDefault()
          const next = Number(input)
          if (!validGoal(next)) { setNotice('请输入 1 至 1000000 的整数字数目标'); return }
          setGoal(next)
          try { localStorage.setItem(key, String(next)); setNotice('已保存本章目标') }
          catch { setNotice('浏览器存储不可用，目标仅在当前章节会话生效') }
        }}>
          <label>本章目标字数<input type="number" min="1" max="1000000" step="1" required value={input} onChange={event => setInput(event.target.value)} /></label>
          <button type="submit">设置目标</button>
        </form>
        <p>按正文总字数计算，沿用字数统计规则；目标只保存在当前浏览器。</p>
        {notice && <p role="status">{notice}</p>}
      </div>
    </details>
    <progress aria-label="本章目标完成度" max={goal} value={Math.min(total, goal)} />
    <WritingTimer active={focused && !disabled} />
  </div>
})

const WritingTimer = memo(function WritingTimer({ active }: { active: boolean }) {
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [visible, setVisible] = useState(() => !document.hidden)
  const accumulated = useRef(0)
  const startedAt = useRef<number | null>(null)
  const running = active && !paused && visible
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    if (!running) return
    startedAt.current = performance.now()
    const tick = () => setElapsed(accumulated.current + performance.now() - startedAt.current!)
    const interval = window.setInterval(tick, 1000)
    return () => {
      accumulated.current += performance.now() - startedAt.current!
      startedAt.current = null
      setElapsed(accumulated.current)
      window.clearInterval(interval)
    }
  }, [running])
  const seconds = Math.floor(elapsed / 1000)
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':')
  return <div className="writing-timer" title="当前章节本次会话的专注时长；退出专注、页面隐藏或切章加载时暂停，切换章节或刷新后重置。">
    <span>{running ? '专注计时' : '计时暂停'}</span>
    <span aria-label="写作计时" aria-live="off">{time}</span>
    <button disabled={!active} aria-label={paused ? '继续计时' : '暂停计时'} onClick={() => setPaused(value => !value)}>{paused ? '继续' : '暂停'}</button>
    <button aria-label="重置计时" onClick={() => {
      accumulated.current = 0
      if (startedAt.current !== null) startedAt.current = performance.now()
      setElapsed(0)
    }}>重置</button>
  </div>
})
