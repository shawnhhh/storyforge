import type { ChapterSummary } from '../../../shared/contracts/novels'

interface Props {
  chapters: ChapterSummary[]
  currentId: string
  disabled: boolean
  onSelect: (id: string) => void
}
export function ChapterNavigation({ chapters, currentId, disabled, onSelect }: Props) {
  const index = chapters.findIndex(item => item.id === currentId)
  return <nav className="chapter-navigation" aria-label="章节导航">
    <button disabled={disabled || index <= 0} onClick={() => onSelect(chapters[index - 1].id)}>上一章</button>
    <select aria-label="跳转章节" value={currentId} disabled={disabled} onChange={event => onSelect(event.target.value)}>{chapters.map((item, i) => <option key={item.id} value={item.id}>{i + 1}. {item.title}</option>)}</select>
    <span className="chapter-position" aria-live="polite">{index + 1} / {chapters.length}</span>
    <button disabled={disabled || index < 0 || index >= chapters.length - 1} onClick={() => onSelect(chapters[index + 1].id)}>下一章</button>
    <details className="shortcut-help"><summary>快捷键</summary><div className="shortcut-details"><p>Ctrl/⌘ + Alt/⌥ + Shift + S：保存</p><p>Ctrl/⌘ + Alt/⌥ + Shift + F：切换专注</p><p>Ctrl/⌘ + Alt/⌥ + Shift + ↑ / ↓：上一章 / 下一章</p><p>Esc：退出专注。快捷键仅在当前创作工作区生效，输入法组合输入时不触发。保留浏览器 Ctrl/⌘ + S、F、P 等原有快捷键。</p></div></details>
  </nav>
}
