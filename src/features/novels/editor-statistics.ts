import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { countWords, type WordCount } from './word-count.js'

export const statisticsKey = new PluginKey<WordCount>('storyforge-word-count')
export function createStatisticsPlugin() {
  // ProseMirror nodes are immutable: count only changed top-level blocks. Selection
  // transactions reuse the entire result; formatting changes preserve word boundaries.
  const cache = new WeakMap<Node, WordCount>()
  function measure(doc: Node): WordCount {
    const sum: WordCount = { total: 0, chinese: 0, english: 0, numbers: 0, other: 0 }
    doc.forEach(block => {
      let count = cache.get(block)
      if (!count) {
        count = countWords(block.textBetween(0, block.content.size, '\n', '\n'))
        cache.set(block, count)
      }
      for (const key of Object.keys(sum) as (keyof WordCount)[]) sum[key] += count[key]
    })
    return sum
  }
  return new Plugin({
    key: statisticsKey,
    state: {
      init: (_, state) => measure(state.doc),
      apply: (transaction, previous) => transaction.docChanged ? measure(transaction.doc) : previous,
    },
  })
}

export const EditorStatistics = Extension.create({
  name: 'storyforgeStatistics',
  addProseMirrorPlugins: () => [createStatisticsPlugin()],
})
