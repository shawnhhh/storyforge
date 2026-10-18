import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { countWords } from '../../src/features/novels/word-count.js'
import { createStatisticsPlugin, statisticsKey } from '../../src/features/novels/editor-statistics.js'
import { editorShortcut } from '../../src/features/novels/editor-shortcuts.js'

test('prose count defines Chinese, Latin words, number runs and excluded punctuation', () => {
  assert.deepEqual(countWords('你好，世界！Hello world, don’t stop. 2026 10 15 😀'), { total: 11, chinese: 4, english: 4, numbers: 3, other: 0 })
  assert.deepEqual(countWords('𠮷 e\u0301lan café mother-in-law 日本語かな'), { total: 9, chinese: 4, english: 3, numbers: 0, other: 2 })
  assert.equal(countWords(' \n\t，。！？…—「」+-😀👩‍💻').total, 0)
  assert.equal(countWords('one\ntwo\tthree').total, 3)
})

test('statistics respect rich-text boundaries and reuse the result for selection changes', () => {
  const schema = getSchema([StarterKit])
  const doc = schema.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hel' }, { type: 'text', text: 'lo', marks: [{ type: 'bold' }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '世界' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] }] }] },
  ] })
  let state = EditorState.create({ schema, doc, plugins: [createStatisticsPlugin()] })
  assert.equal(statisticsKey.getState(state)?.total, 5)
  const previous = statisticsKey.getState(state)
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
  assert.equal(statisticsKey.getState(state), previous)
  state = state.apply(state.tr.insertText('中', 1))
  assert.equal(statisticsKey.getState(state)?.total, 6)
  state = state.apply(state.tr.delete(1, 2))
  assert.equal(statisticsKey.getState(state)?.total, 5)
})

test('a long document retains its count through editing and undo-like deletion', () => {
  const schema = getSchema([StarterKit])
  const doc = schema.nodeFromJSON({ type: 'doc', content: Array.from({ length: 2000 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: '长篇正文 Hello world 123。' }] })) })
  let state = EditorState.create({ schema, doc, plugins: [createStatisticsPlugin()] })
  assert.equal(statisticsKey.getState(state)?.total, 14000)
  for (let i = 0; i < 30; i++) state = state.apply(state.tr.insertText('字', 1))
  assert.equal(statisticsKey.getState(state)?.total, 14030)
  state = state.apply(state.tr.delete(1, 31))
  assert.equal(statisticsKey.getState(state)?.total, 14000)
})

test('shortcuts leave browser/OS bindings and IME alone and accept physical macOS keys', () => {
  const event = { key: 's', code: 'KeyS', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false }
  for (const key of ['s', 'f', 'p', 'r', 'w', 't', 'Tab', 'F11']) {
    assert.equal(editorShortcut({ ...event, key, code: '', ctrlKey: true }), null)
    assert.equal(editorShortcut({ ...event, key, code: '', metaKey: true }), null)
  }
  const shortcut = { ...event, ctrlKey: true, altKey: true, shiftKey: true }
  assert.equal(editorShortcut(shortcut), 'save')
  assert.equal(editorShortcut({ ...shortcut, key: 'f', code: 'KeyF' }), 'focus')
  assert.equal(editorShortcut({ ...shortcut, key: 'ArrowUp', code: 'ArrowUp' }), 'previous')
  assert.equal(editorShortcut({ ...shortcut, key: 'ArrowDown', code: 'ArrowDown' }), 'next')
  assert.equal(editorShortcut({ ...shortcut, ctrlKey: false, metaKey: true, key: 'Í' }), null)
  assert.equal(editorShortcut({ ...shortcut, key: 'Í' }), 'save')
  assert.equal(editorShortcut({ ...shortcut, isComposing: true }), null)
  assert.equal(editorShortcut({ ...shortcut, repeat: true }), null)
  assert.equal(editorShortcut({ ...shortcut, defaultPrevented: true }), null)
  assert.equal(editorShortcut({ ...event, key: 'Escape' }), 'escape')
})
