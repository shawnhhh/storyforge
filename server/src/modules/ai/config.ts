import type { GenerationParameters } from '../../../../shared/contracts/ai.js'
export interface AiConfig { apiKey: string; baseUrl: string; model: string; timeoutMs: number; parameters?: GenerationParameters }

// Server-only environment. Never persist credentials in SQLite or expose them via status.
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const apiKey = env.STORYFORGE_AI_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl = new URL(env.STORYFORGE_AI_BASE_URL ?? 'https://api.openai.com/v1')
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
    (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(baseUrl.hostname)))) throw new Error('Invalid AI endpoint')
  const model = (env.STORYFORGE_AI_MODEL ?? 'gpt-4o-mini').trim()
  const timeoutMs = Number(env.STORYFORGE_AI_TIMEOUT_MS ?? 60000)
  if (!model || model.length > 200 || /[\r\n]/.test(model + apiKey) || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('Invalid AI configuration')
  return { apiKey, baseUrl: baseUrl.href.replace(/\/$/, ''), model, timeoutMs }
}
