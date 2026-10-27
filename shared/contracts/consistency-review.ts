import type { AiEstimate, AiResult, ContextSelection, GenerationParameters } from './ai.js'

export const reviewChapterLimit = 40000
export const reviewCategories = { character: '人物身份、性格与关系', world: '世界观与规则', plot: '前后文逻辑与剧情衔接' } as const
export interface ReviewInput {
  chapterId: string
  chapterText: string
  context: ContextSelection
  modelId: string
  parameters: GenerationParameters
}
export interface ReviewSource { id: string; label: string; text: string; truncated: boolean }
export interface ReviewTask { action: 'consistency-review'; sources: ReviewSource[] }
export interface ReviewPreview {
  fingerprint: string
  messages: { role: string; content: string }[]
  sources: ReviewSource[]
  estimate: AiEstimate
}
export interface ReviewEvidence { sourceId: string; quote: string }
export interface ReviewFinding {
  category: keyof typeof reviewCategories
  certainty: 'conflict' | 'suggestion'
  explanation: string
  suggestion: string
  evidence: ReviewEvidence[]
  evidenceIncomplete: boolean
}
export interface ReviewResult extends Omit<AiResult, 'text'> {
  findings: ReviewFinding[]
  fingerprint: string
}
