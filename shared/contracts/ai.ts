export const aiActions = { continue: 'AI 续写', polish: 'AI 润色', expand: 'AI 扩写', rewrite: 'AI 改写', inspire: 'AI 灵感' } as const
export type AiAction = keyof typeof aiActions
export const aiLimits = { before: 6000, selection: 6000, after: 3000, instructions: 1000, story: 6000, output: 20000 } as const
export interface AiInput {
  action: AiAction
  chapterId: string
  before: string
  selection: string
  after: string
  instructions: string
  includeStoryContext: boolean
  modelId?: string
  parameters?: GenerationParameters
  context?: ContextSelection
}
export interface GenerationParameters { temperature: number; topP: number; maxOutputTokens: number }
export const defaultGeneration: GenerationParameters = { temperature: 0.7, topP: 1, maxOutputTokens: 2000 }
export const referenceKinds = { character: '人物', world: '世界观', outline: '大纲', plotline: '剧情线', card: '剧情卡', foreshadow: '伏笔', chapter: '已有章节' } as const
export type ReferenceKind = keyof typeof referenceKinds
export interface ContextReference { kind: ReferenceKind; id: string }
export interface ContextSelection { references: ContextReference[]; maxCharacters: number; fingerprint?: string }
export interface ContextChoice extends ContextReference { label: string }
export interface ContextPreview {
  text: string
  fingerprint: string
  characters: number
  sources: (ContextChoice & { characters: number; originalCharacters: number; truncated: boolean })[]
}
export interface PublicAiModel {
  id: string; label: string; provider: string; model: string; configured: boolean; maxOutputTokens: number
  inputUsdPerMillion: number | null; outputUsdPerMillion: number | null
}
export interface AiPolicy {
  requestsPerMinute: number; sessionRequests: number; sessionTokens: number; maxInputTokens: number
  maxRequestUsd: number; sessionUsd: number
}
export interface AiCatalog { models: PublicAiModel[]; policy: AiPolicy; remaining: { requests: number; tokens: number; usd: number } }
export interface AiEstimate { inputTokensUpperBound: number; reservedTokens: number; maxUsd: number | null }
export interface AiStatus { configured: boolean; model: string | null; message: string }
export interface AiResult {
  text: string
  usage: { inputTokens: number | null; outputTokens: number | null }
  finishReason: 'stop' | 'length'
  modelId?: string
  estimate?: AiEstimate
}
