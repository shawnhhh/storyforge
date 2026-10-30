import type { KnowledgeSnapshot } from '../../../shared/contracts/knowledge'

interface Change { novelId: string; snapshot: KnowledgeSnapshot }
const eventName = 'storyforge:knowledge-changed'
// Both reference editors share acknowledged versions without duplicate reads or
// a stale whole-snapshot write when the other panel updates the same novel.
export function notifyKnowledgeChange(novelId: string, snapshot: KnowledgeSnapshot) {
  window.dispatchEvent(new CustomEvent<Change>(eventName, { detail: { novelId, snapshot } }))
}
export function listenKnowledgeChanges(novelId: string, accept: (snapshot: KnowledgeSnapshot) => void) {
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<Change>).detail
    if (detail?.novelId === novelId) accept(detail.snapshot)
  }
  window.addEventListener(eventName, changed)
  return () => window.removeEventListener(eventName, changed)
}
