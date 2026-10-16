import type { PublicAiModel, GenerationParameters } from '../../../../shared/contracts/ai.js'
import { defaultGeneration } from '../../../../shared/contracts/ai.js'
import { loadAiConfig, type AiConfig } from './config.js'
import { HttpError } from '../novels/store.js'

export interface AiModel extends AiConfig {
  id: string; label: string; provider: 'openai' | 'deepseek' | 'compatible'; maxOutputTokens: number
  inputUsdPerMillion: number | null; outputUsdPerMillion: number | null
}
const keyNames = ['STORYFORGE_AI_API_KEY', 'STORYFORGE_OPENAI_API_KEY', 'STORYFORGE_DEEPSEEK_API_KEY', 'STORYFORGE_LOCAL_API_KEY']
export function legacyModel(config: AiConfig): AiModel {
  return { ...config, id: 'openai-default', label: '默认兼容模型', provider: 'compatible', maxOutputTokens: 4096, inputUsdPerMillion: null, outputUsdPerMillion: null }
}
export function loadAiModels(env: NodeJS.ProcessEnv = process.env): AiModel[] {
  const defaults = [
    { id: 'openai-default', label: 'OpenAI / 兼容服务', provider: 'openai', model: env.STORYFORGE_AI_MODEL ?? 'gpt-4o-mini', baseUrl: env.STORYFORGE_AI_BASE_URL ?? 'https://api.openai.com/v1', keyEnv: env.STORYFORGE_OPENAI_API_KEY?.trim() ? 'STORYFORGE_OPENAI_API_KEY' : 'STORYFORGE_AI_API_KEY' },
    { id: 'deepseek-chat', label: 'DeepSeek', provider: 'deepseek', model: env.STORYFORGE_DEEPSEEK_MODEL ?? 'deepseek-chat', baseUrl: env.STORYFORGE_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1', keyEnv: 'STORYFORGE_DEEPSEEK_API_KEY' },
  ]
  if ((env.STORYFORGE_AI_MODELS_JSON?.length ?? 0) > 32000) throw new Error('Invalid model catalog')
  const entries: unknown = env.STORYFORGE_AI_MODELS_JSON ? JSON.parse(env.STORYFORGE_AI_MODELS_JSON) : defaults
  if (!Array.isArray(entries) || !entries.length || entries.length > 12) throw new Error('Invalid model catalog')
  const ids = new Set<string>()
  return entries.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model')
    const row = value as Record<string, unknown>
    const allowed = ['id', 'label', 'provider', 'model', 'baseUrl', 'keyEnv', 'maxOutputTokens', 'inputUsdPerMillion', 'outputUsdPerMillion']
    if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error('Unknown model option')
    for (const field of ['id', 'label', 'provider', 'model', 'baseUrl', 'keyEnv']) if (typeof row[field] !== 'string') throw new Error('Invalid model option')
    const { id, label, provider, model, baseUrl, keyEnv } = row as Record<string, string>
    if (!/^[a-z0-9-]{1,60}$/.test(id) || ids.has(id) || !label.trim() || label.length > 100 || !['openai', 'deepseek', 'compatible'].includes(provider) || !keyNames.includes(keyEnv)) throw new Error('Invalid model option')
    ids.add(id)
    // Validate URLs even when no secret is configured. No secret is accepted in catalog JSON.
    const apiKey = env[keyEnv]?.trim() ?? ''
    const validated = loadAiConfig({ STORYFORGE_AI_API_KEY: apiKey || 'unconfigured', STORYFORGE_AI_BASE_URL: baseUrl, STORYFORGE_AI_MODEL: model, STORYFORGE_AI_TIMEOUT_MS: env.STORYFORGE_AI_TIMEOUT_MS })!
    const maxOutputTokens = row.maxOutputTokens ?? 4096
    if (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 4096) throw new Error('Invalid output cap')
    const price = (key: string) => {
      const value = row[key]
      if (value === undefined || value === null) return null
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) throw new Error('Invalid price')
      return value
    }
    const inputPrice = price('inputUsdPerMillion'), outputPrice = price('outputUsdPerMillion')
    if ((inputPrice === null) !== (outputPrice === null)) throw new Error('Both prices required')
    return { ...validated, apiKey, id, label, provider: provider as AiModel['provider'], maxOutputTokens, inputUsdPerMillion: inputPrice, outputUsdPerMillion: outputPrice }
  })
}
export function publicModel(model: AiModel): PublicAiModel {
  return { id: model.id, label: model.label, provider: model.provider, model: model.model, configured: !!model.apiKey, maxOutputTokens: model.maxOutputTokens, inputUsdPerMillion: model.inputUsdPerMillion, outputUsdPerMillion: model.outputUsdPerMillion }
}
export function generationParameters(value: unknown, model: AiModel): GenerationParameters {
  const parameters = value ?? { ...defaultGeneration, maxOutputTokens: Math.min(defaultGeneration.maxOutputTokens, model.maxOutputTokens) }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new HttpError(400, '生成参数无效')
  const row = parameters as Record<string, unknown>
  if (Object.keys(row).some(key => !['temperature', 'topP', 'maxOutputTokens'].includes(key)) || typeof row.temperature !== 'number' || !Number.isFinite(row.temperature) || row.temperature < 0 || row.temperature > 2 || typeof row.topP !== 'number' || !Number.isFinite(row.topP) || row.topP < 0.1 || row.topP > 1 || typeof row.maxOutputTokens !== 'number' || !Number.isInteger(row.maxOutputTokens) || row.maxOutputTokens < 64 || row.maxOutputTokens > model.maxOutputTokens) throw new HttpError(400, '生成参数超出模型允许范围')
  return row as unknown as GenerationParameters
}
