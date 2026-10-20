import type { AiEstimate, AiInput, AiResult, ContextPreview, ContextSelection, GenerationParameters } from './ai.js'

export const planningKinds = { world: '世界观', character: '人物设定', volume: '分卷大纲', chapter: '章节大纲' } as const
export type PlanningKind = keyof typeof planningKinds
export interface PlanningGenerationInput {
  novelId: string; kind: PlanningKind; instructions: string; modelId: string
  parameters: GenerationParameters; context: ContextSelection
  parentId: string | null; chapterIds: string[]
}
export interface PlanningProposal { title: string; content: string }
export interface PlanningRequestPreview {
  fingerprint: string; messages: { role: string; content: string }[]; context: ContextPreview
  estimate: AiEstimate; input: AiInput
}
export interface PlanningGenerationResult extends AiResult {
  proposal: PlanningProposal; previewId: string; expiresAt: string
}
export interface PlanningSaveResult { id: string; kind: PlanningKind; novelId: string }
