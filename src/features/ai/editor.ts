import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { type EditorState, type Selection } from '@tiptap/pm/state'
import { aiLimits, type AiAction, type AiInput } from '../../../shared/contracts/ai.js'
import { closeHistory } from '@tiptap/pm/history'

export interface AiSnapshot { doc: ProseMirrorNode; selection: Selection; input: Pick<AiInput, 'before' | 'selection' | 'after'> }
export function captureAiSnapshot(state: EditorState): AiSnapshot {
  const { from, to } = state.selection
  return { doc: state.doc, selection: state.selection, input: {
    before: state.doc.textBetween(0, from, '\n', '\n').slice(-aiLimits.before),
    selection: state.doc.textBetween(from, to, '\n', '\n'),
    after: state.doc.textBetween(to, state.doc.content.size, '\n', '\n').slice(0, aiLimits.after),
  } }
}
export function aiTransaction(state: EditorState, snapshot: AiSnapshot, action: AiAction, text: string) {
  if (state.doc !== snapshot.doc || action === 'inspire' || !text.trim() || text.length > aiLimits.output) return null
  const { from, to } = snapshot.selection
  if (['polish', 'expand', 'rewrite'].includes(action) && snapshot.selection.empty) return null
  const start = action === 'continue' ? to : from
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map(line => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : undefined))
  // Structured text nodes: generated HTML/Markdown is never interpreted as markup.
  const tr = state.tr.replaceRange(start, to, new Slice(Fragment.fromArray(paragraphs), 1, 1))
  tr.setSelection(snapshot.selection.map(tr.doc, tr.mapping))
  return closeHistory(tr)
}
