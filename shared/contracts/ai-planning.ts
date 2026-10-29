import type { AiEstimate, AiInput, AiResult, ContextPreview, ContextSelection, GenerationParameters } from './ai.js'
import type { CharacterFields, CharacterInput } from './story-bible.js'
import type { Outline } from './planning.js'

export const planningKinds = { world: '世界观', character: '人物设定', volume: '分卷大纲', chapter: '章节大纲' } as const
export type PlanningKind = keyof typeof planningKinds
export interface PlanningGenerationInput {
  novelId: string; kind: PlanningKind; instructions: string; modelId: string
  parameters: GenerationParameters; context: ContextSelection
  parentId: string | null; chapterIds: string[]
}
export type GeneratedCharacter = Pick<CharacterInput, 'category' | 'tags'> & { fields: Omit<CharacterFields, 'notes'> }
// For characters, content is the editable notes field; all other biography fields
// are saved individually through the existing character store.
export interface PlanningProposal { title: string; content: string; character?: GeneratedCharacter }
export interface PlanningPreviewValidity { valid: true; state: 'pending' | 'saved'; expiresAt: string }
export type PlanningOutlineTarget = Pick<Outline, 'id' | 'kind' | 'title'>
export interface PlanningRequestPreview {
  fingerprint: string; messages: { role: string; content: string }[]; context: ContextPreview
  estimate: AiEstimate; input: AiInput
}
export interface PlanningGenerationResult extends AiResult {
  proposal: PlanningProposal; previewId: string; expiresAt: string
}
export interface PlanningSaveResult { id: string; kind: PlanningKind; novelId: string }
