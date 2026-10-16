import { useState } from 'react'
import { compareText } from './comparison'

export function ResultComparison({ before, after }: { before: string; after: string }) {
  const [mode, setMode] = useState<'parallel' | 'changes'>('parallel')
  const diff = compareText(before, after)
  return <section aria-label="原文与生成稿对比">
    <div className="ai-segments" role="group" aria-label="对比视图"><button aria-pressed={mode === 'parallel'} onClick={() => setMode('parallel')}>并排对比</button><button aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>变更概览</button></div>
    {mode === 'parallel' ? <div className="ai-comparison"><section><h4>原文</h4><div className="ai-context">{before || '在光标或选文末尾插入，不删除原文'}</div></section><section><h4>生成稿</h4><div className="ai-preview">{after}</div></section></div> : <div className="ai-preview">{diff.identical ? '内容与原文相同' : <>{diff.prefix}{diff.removed && <del>{diff.removed}</del>}{diff.added && <ins>{diff.added}</ins>}{diff.suffix}</>}</div>}
    <p className="ai-note">原文 {Array.from(before).length} / 生成稿 {Array.from(after).length} 字符。变更概览合并显示首尾之间的修改区间，接受后按纯文本应用。</p>
  </section>
}
