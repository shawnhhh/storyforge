export interface WordCount { total: number; chinese: number; english: number; numbers: number; other: number }

// Count prose, not markup: Han code points, Latin words (internal apostrophes/hyphens
// allowed), number runs and remaining letters. Whitespace/punctuation/symbols count 0.
export function countWords(text: string): WordCount {
  let chinese = 0, english = 0, numbers = 0
  const remaining = text
    .replace(/\p{Script=Han}/gu, () => { chinese++; return ' ' })
    .replace(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*/gu, () => { english++; return ' ' })
    .replace(/\p{N}+/gu, () => { numbers++; return ' ' })
  const other = remaining.match(/\p{L}/gu)?.length ?? 0
  return { total: chinese + english + numbers + other, chinese, english, numbers, other }
}

import type { RichTextNode } from '../contracts/novels.js'

// Match the editor's textblock counting: separate blocks and hard breaks so
// adjacent Latin words in different paragraphs never merge into one word.
export function countDocument(node: RichTextNode): number {
  if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '')) {
    const text = (item: RichTextNode): string => item.text ?? (item.type === 'hardBreak' ? '\n' : (item.content ?? []).map(text).join(''))
    return countWords(text(node)).total
  }
  return (node.content ?? []).reduce((sum, child) => sum + countDocument(child), 0)
}
