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
}
export interface AiStatus { configured: boolean; model: string | null; message: string }
export interface AiResult {
  text: string
  usage: { inputTokens: number | null; outputTokens: number | null }
  finishReason: 'stop' | 'length'
}
