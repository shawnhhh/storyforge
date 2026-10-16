import type { AiEstimate, AiPolicy, GenerationParameters } from '../../../../shared/contracts/ai.js'
import type { AiModel } from './models.js'
import { HttpError } from '../novels/store.js'

export function loadAiPolicy(env: NodeJS.ProcessEnv = process.env): AiPolicy {
  const read = (key: string, fallback: number, max: number, integer = true) => {
    const value = Number(env[`STORYFORGE_AI_${key}`] ?? fallback)
    if (!Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) throw new Error('Invalid AI policy')
    return value
  }
  return { requestsPerMinute: read('REQUESTS_PER_MINUTE', 20, 120), sessionRequests: read('SESSION_REQUESTS', 100, 1000), sessionTokens: read('SESSION_TOKENS', 200000, 10000000), maxInputTokens: read('MAX_INPUT_TOKENS', 64000, 128000), maxRequestUsd: read('MAX_REQUEST_USD', 1, 100, false), sessionUsd: read('SESSION_USD', 5, 1000, false) }
}
export function estimateRequest(messages: unknown, parameters: GenerationParameters, model: AiModel): AiEstimate {
  // UTF-8 bytes plus message overhead are a conservative proxy, not a tokenizer.
  const inputTokensUpperBound = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 256
  const reservedTokens = inputTokensUpperBound + parameters.maxOutputTokens
  const maxUsd = model.inputUsdPerMillion === null || model.outputUsdPerMillion === null ? null : (inputTokensUpperBound * model.inputUsdPerMillion + parameters.maxOutputTokens * model.outputUsdPerMillion) / 1000000
  return { inputTokensUpperBound, reservedTokens, maxUsd }
}
export class AiBudget {
  private times: number[] = []
  private requests = 0
  private tokens = 0
  private usd = 0
  constructor(readonly policy: AiPolicy, private clock = Date.now) {}
  remaining() { return { requests: Math.max(0, this.policy.sessionRequests - this.requests), tokens: Math.max(0, this.policy.sessionTokens - this.tokens), usd: Math.max(0, this.policy.sessionUsd - this.usd) } }
  reserve(estimate: AiEstimate) {
    const now = this.clock()
    this.times = this.times.filter(time => now - time < 60000)
    if (this.times.length >= this.policy.requestsPerMinute) throw new HttpError(429, '本机 AI 每分钟请求限额已达到，请稍后再试')
    if (this.requests >= this.policy.sessionRequests || this.tokens + estimate.reservedTokens > this.policy.sessionTokens) throw new HttpError(429, '本机 AI 会话预算已用完，请检查服务端预算配置')
    if (estimate.inputTokensUpperBound > this.policy.maxInputTokens) throw new HttpError(413, 'AI 输入预算超限，请缩短附近正文或减少引用')
    if (estimate.maxUsd !== null && (estimate.maxUsd > this.policy.maxRequestUsd || this.usd + estimate.maxUsd > this.policy.sessionUsd)) throw new HttpError(429, 'AI 预计费用超出服务端成本上限，请减少输入或输出长度')
    this.times.push(now); this.requests++; this.tokens += estimate.reservedTokens; this.usd += estimate.maxUsd ?? 0
    // Failed/cancelled requests still reserve their full budget: providers may bill them.
  }
}
