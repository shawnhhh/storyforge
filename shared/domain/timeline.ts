import type { PlanningData, PlotCard } from '../contracts/planning.js'
import type { StoryBible } from '../contracts/story-bible.js'
import type { KnowledgeSnapshot } from '../contracts/knowledge.js'

export interface TimelineEvent {
  id: string; source: 'card' | 'world'; title: string; description: string
  storyTime: string; order: number | null; characterIds: string[]; worldIds: string[]; chapterIds: string[]
  status?: PlotCard['status']; plotlineId?: string | null
}
// Cards are events, not copies. Existing important world events remain their original records.
export function storyTimeline(plan: PlanningData, bible: StoryBible, knowledge: KnowledgeSnapshot): TimelineEvent[] {
  const cards: TimelineEvent[] = plan.cards.map(card => ({
    id: card.id, source: 'card', title: card.title, description: card.content || card.summary,
    storyTime: card.storyTime, order: card.timeOrder, characterIds: card.characterIds ?? [],
    worldIds: card.worldIds ?? [], chapterIds: card.chapterIds, status: card.status, plotlineId: card.plotlineId,
  }))
  const history: TimelineEvent[] = bible.world.filter(row => row.onTimeline).map(row => ({
    id: row.id, source: 'world', title: row.name, description: row.description,
    storyTime: row.timeText, order: row.sortOrder,
    characterIds: bible.characters.filter(character => character.worldIds.includes(row.id)).map(character => character.id),
    worldIds: knowledge.links.filter(link => link.source.kind === 'world' && link.source.id === row.id && link.target.kind === 'world').map(link => link.target.id),
    chapterIds: knowledge.links.filter(link => link.target.kind === 'world' && link.target.id === row.id && link.source.kind === 'chapter').map(link => link.source.id),
  }))
  // Stable ties preserve the authors' card order; undated events are always last.
  return [...cards, ...history].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
}
