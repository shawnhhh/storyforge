import { Router } from 'express'
import { aiActions, aiLimits, type AiInput } from '../../../../shared/contracts/ai.js'
import { HttpError, type NovelStore } from '../novels/store.js'
import type { PlanningStore } from '../planning/store.js'
import type { StoryBibleStore } from '../story-bible/store.js'
import { loadAiConfig, type AiConfig } from './config.js'
import { OpenAiProvider, type AiProvider } from './provider.js'

export interface AiDependencies { config?: () => AiConfig | null; provider?: (config: AiConfig) => AiProvider }
export function validateAiInput(value: unknown): AiInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'AI 请求格式无效')
  const data = value as Record<string, unknown>
  if (typeof data.action !== 'string' || !Object.hasOwn(aiActions, data.action) || typeof data.includeStoryContext !== 'boolean') throw new HttpError(400, 'AI 操作或上下文选项无效')
  for (const [field, max] of Object.entries({ chapterId: 100, before: aiLimits.before, selection: aiLimits.selection, after: aiLimits.after, instructions: aiLimits.instructions })) {
    if (typeof data[field] !== 'string' || (data[field] as string).length > max) throw new HttpError(400, `AI ${field} 超出限制或格式无效`)
  }
  if (['polish', 'expand', 'rewrite'].includes(data.action) && !(data.selection as string).trim()) throw new HttpError(400, '请先选择需要处理的正文')
  return data as unknown as AiInput
}
export function aiRoutes(novels: NovelStore, planning: PlanningStore, bible: StoryBibleStore, dependencies: AiDependencies = {}) {
  const router = Router()
  let active = 0
  const configuration = () => {
    try { return (dependencies.config ?? loadAiConfig)() }
    catch { throw new HttpError(503, 'AI 服务端配置无效，请检查接口地址、模型和超时配置') }
  }
  router.use('/ai', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/ai/status', (_req, res) => {
    const config = configuration()
    res.json({ configured: !!config, model: config?.model ?? null, message: config ? 'AI 已就绪' : '未配置 AI API Key。请按 docs/ai-writing.md 配置本地服务端并重启；其他功能可正常使用。' })
  })
  router.post('/ai/generate', async (req, res) => {
    const input = validateAiInput(req.body)
    const config = configuration()
    if (!config) throw new HttpError(503, '未配置 AI API Key，请配置本地服务端并重启')
    if (active >= 2) throw new HttpError(429, '本地 AI 请求正在处理中，请稍后重试')
    const chapter = novels.chapter(input.chapterId)
    let story = ''
    if (input.includeStoryContext) {
      const novel = novels.novel(chapter.novelId)
      const profiles = bible.list(chapter.novelId)
      const outlines = planning.read(chapter.novelId).outlines.filter(item => item.kind !== 'chapter' || item.chapterIds.includes(chapter.id))
      // Allocate a separate budget per category so long profiles cannot erase the outline.
      story = JSON.stringify({
        novel: { title: novel.title, description: novel.description.slice(0, 500) },
        characters: profiles.characters.map(c => `${c.name}: ${c.fields.personality} ${c.fields.identity} ${c.fields.notes}`).join('\n').slice(0, 1600),
        world: profiles.world.map(w => `${w.name}: ${w.description}`).join('\n').slice(0, 1600),
        outlines: outlines.map(o => `${o.title}: ${o.content}`).join('\n').slice(0, 1600),
      }).slice(0, aiLimits.story)
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, config.timeoutMs)
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', disconnect)
    active++
    try {
      const provider = (dependencies.provider ?? (settings => new OpenAiProvider(settings)))(config)
      const result = await provider.generate(input, story, controller.signal)
      if (timedOut) throw new HttpError(504, 'AI 请求超时，请重试或缩短上下文')
      if (!controller.signal.aborted) res.json(result)
    } catch (error) {
      if (timedOut) throw new HttpError(504, 'AI 请求超时，请重试或缩短上下文')
      if (controller.signal.aborted) return
      if (error instanceof HttpError) throw error
      throw new HttpError(502, 'AI 服务请求失败，请稍后重试')
    } finally { clearTimeout(timeout); res.off('close', disconnect); active-- }
  })
  return router
}
