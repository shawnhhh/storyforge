import { Router, type Response } from 'express'
import type { ReviewTask } from '../../../../shared/contracts/consistency-review.js'
import { validateReviewInput, prepareReview, parseReview } from './review.js'
import { AiPlanning, parseProposal } from './planning.js'
import { aiActions, aiLimits, type AiInput, type AiPolicy } from '../../../../shared/contracts/ai.js'
import { HttpError, type NovelStore } from '../novels/store.js'
import type { PlanningStore } from '../planning/store.js'
import type { StoryBibleStore } from '../story-bible/store.js'
import type { AiConfig } from './config.js'
import { OpenAiProvider, buildMessages, type AiProvider } from './provider.js'
import { generationParameters, legacyModel, loadAiModels, publicModel, type AiModel } from './models.js'
import { AiBudget, estimateRequest, loadAiPolicy } from './budget.js'
import { AiContext, validateContext } from './context.js'

export interface AiDependencies { config?: () => AiConfig | null; models?: () => AiModel[]; policy?: AiPolicy; clock?: () => number; provider?: (config: AiModel) => AiProvider }
export function validateAiInput(value: unknown): AiInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'AI 请求格式无效')
  const data = value as Record<string, unknown>
  if (Object.keys(data).some(key => !['action', 'chapterId', 'before', 'selection', 'after', 'instructions', 'includeStoryContext', 'modelId', 'parameters', 'context'].includes(key))) throw new HttpError(400, 'AI 请求含不支持的选项')
  if (typeof data.action !== 'string' || !Object.hasOwn(aiActions, data.action) || typeof data.includeStoryContext !== 'boolean') throw new HttpError(400, 'AI 操作或上下文选项无效')
  for (const [field, max] of Object.entries({ chapterId: 100, before: aiLimits.before, selection: aiLimits.selection, after: aiLimits.after, instructions: aiLimits.instructions })) {
    if (typeof data[field] !== 'string' || (data[field] as string).length > max) throw new HttpError(400, `AI ${field} 超出限制或格式无效`)
  }
  if (['polish', 'expand', 'rewrite'].includes(data.action) && !(data.selection as string).trim()) throw new HttpError(400, '请先选择需要处理的正文')
  if (data.modelId !== undefined && (typeof data.modelId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(data.modelId))) throw new HttpError(400, '模型标识无效')
  if (data.context !== undefined) {
    validateContext(data.context)
    if (data.includeStoryContext) throw new HttpError(400, '逐项引用与快速摘要不能同时使用')
  }
  return data as unknown as AiInput
}
export function aiRoutes(novels: NovelStore, planning: PlanningStore, bible: StoryBibleStore, dependencies: AiDependencies = {}) {
  const router = Router()
  let active = 0
  const planningRequests = new Set<string>()
  let ledger: AiBudget | undefined
  const contexts = new AiContext(novels, bible, planning)
  const proposals = new AiPlanning(novels, planning, bible, contexts, dependencies.clock, () => ({ models: models(), policy: budget().policy }))
  const models = () => {
    try {
      if (dependencies.models) return dependencies.models()
      if (dependencies.config) { const config = dependencies.config(); return config ? [legacyModel(config)] : loadAiModels({}) }
      return loadAiModels()
    }
    catch { throw new HttpError(503, 'AI 服务端配置无效，请检查接口地址、模型和超时配置') }
  }
  const budget = () => {
    try { return ledger ??= new AiBudget(dependencies.policy ?? loadAiPolicy(), dependencies.clock) }
    catch { throw new HttpError(503, 'AI 服务端预算配置无效，请检查请求与成本上限') }
  }
  router.use('/ai', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/ai/status', (_req, res) => {
    const config = models().find(model => model.apiKey)
    res.json({ configured: !!config, model: config?.model ?? null, message: config ? 'AI 已就绪' : '未配置 AI API Key。请按 docs/ai-writing.md 配置本地服务端并重启；其他功能可正常使用。' })
  })
  router.get('/ai/models', (_req, res) => { res.json({ models: models().map(publicModel), policy: budget().policy, remaining: budget().remaining() }) })
  router.get('/ai/chapters/:id/context', (req, res) => { res.json(contexts.choices(req.params.id)) })
  router.post('/ai/context/preview', (req, res) => {
    if (typeof req.body?.chapterId !== 'string' || !req.body.chapterId || req.body.chapterId.length > 100) throw new HttpError(400, '章节标识无效')
    res.json(contexts.preview(req.body.chapterId, validateContext(req.body.context)))
  })
  router.post('/ai/generate', async (req, res) => {
    const input = validateAiInput(req.body)
    const catalog = models()
    const model = input.modelId ? catalog.find(item => item.id === input.modelId) : catalog.find(item => item.apiKey)
    if (!model) throw new HttpError(input.modelId ? 400 : 503, input.modelId ? '模型不存在，请重新打开模型配置中心' : '未配置 AI API Key，请配置本地服务端并重启')
    if (!model.apiKey) throw new HttpError(503, '所选模型未配置 API Key，请在本地服务端配置')
    const parameters = generationParameters(input.parameters, model)
    if (active >= 2) throw new HttpError(429, '本地 AI 请求正在处理中，请稍后重试')
    const chapter = novels.chapter(input.chapterId)
    let story = ''
    if (input.context) {
      const preview = contexts.preview(input.chapterId, input.context)
      if (input.context.references.length && input.context.fingerprint !== preview.fingerprint) throw new HttpError(409, '引用已变化或尚未预览，请重新核对引用后再生成')
      story = preview.text
    } else if (input.includeStoryContext) {
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
    const result = await generate(input, story, model, parameters, res)
    if (result) res.json(result)
  })
  router.get('/ai/novels/:id/context', (req, res) => { res.json(contexts.choicesNovel(req.params.id)) })
  router.get('/ai/novels/:id/planning-targets', (req, res) => { res.json(planning.summaries(req.params.id).filter(row => row.kind === 'outlines').map(row => ({ id: row.id, kind: row.outlineKind, title: row.title }))) })
  router.post('/ai/planning/preview', (req, res) => {
    const input = proposals.validate(req.body)
    res.json(proposals.preview(input, planningModel(input.modelId)))
  })
  router.post('/ai/planning/generate', async (req, res) => {
    const input = proposals.validate(req.body), model = planningModel(input.modelId)
    const preview = proposals.preview(input, model)
    if (req.body.fingerprint !== preview.fingerprint) throw new HttpError(409, '发送内容、资料或设置已变化，请重新核对请求预览')
    if (planningRequests.has(preview.fingerprint)) throw new HttpError(409, '相同生成请求正在处理中，请等待当前请求或先取消')
    planningRequests.add(preview.fingerprint)
    try {
      const baseline = proposals.baseline(input)
      const story = JSON.stringify({ request: input.instructions, selectedSources: preview.context.text })
      const result = await generate(preview.input, story, model, preview.input.parameters!, res)
      if (!result) return
      if (proposals.baseline(input) !== baseline) throw new HttpError(409, '生成期间资料已变化，请重新生成；原稿未修改')
      if (result.finishReason === 'length') throw new HttpError(502, 'AI 结果达到输出上限，无法保存不完整内容；请增加上限或缩短要求')
      const proposal = parseProposal(result.text, input.kind)
      res.json({ ...result, proposal, ...proposals.retain(input, baseline) })
    } finally { planningRequests.delete(preview.fingerprint) }
  })
  router.post('/ai/planning/check', (req, res) => { res.json(proposals.check(req.body?.previewId)) })
  router.post('/ai/planning/save', (req, res) => { res.json(proposals.save(req.body)) })
  function planningModel(id: string) {
    const model = models().find(item => item.id === id)
    if (!model) throw new HttpError(400, '模型不存在，请重新打开模型配置中心')
    if (!model.apiKey) throw new HttpError(503, '所选模型未配置 API Key，请在本地服务端配置')
    return model
  }
  async function generate(input: AiInput, story: string, model: AiModel, parameters: ReturnType<typeof generationParameters>, res: Response) {
    const config = { ...model, parameters }
    if (active >= 2) throw new HttpError(429, '本地 AI 请求正在处理中，请稍后重试')
    const estimate = estimateRequest(buildMessages(input, story), parameters, model)
    return execute(input, story, config, estimate, res)
  }
  function reviewPreparation(body: unknown) {
    const input = validateReviewInput(body)
    novels.chapter(input.chapterId) // Validate current chapter even when no references were chosen.
    const model = models().find(item => item.id === input.modelId)
    if (!model) throw new HttpError(400, '模型不存在，请重新打开模型配置中心')
    return { input, model, ...prepareReview(input, model, contexts) }
  }
  router.post('/ai/review/preview', (req, res) => { res.json(reviewPreparation(req.body).preview) })
  router.post('/ai/review', async (req, res) => {
    const { input, model, task, parameters, preview } = reviewPreparation(req.body)
    if (!input.fingerprint || input.fingerprint !== preview.fingerprint) throw new HttpError(409, '章节、引用或模型设置已变化或尚未确认，请重新预览并确认')
    if (!model.apiKey) throw new HttpError(503, '所选模型未配置 AI API Key，请在本地服务端配置；其他功能可正常使用')
    if (active >= 2) throw new HttpError(429, '本地 AI 请求正在处理中，请稍后重试')
    const result = await execute(task, '', { ...model, parameters }, preview.estimate, res)
    if (!result) return
    if (result.text.includes(model.apiKey)) throw new HttpError(502, 'AI 审阅响应无效，请重试')
    res.json({ findings: parseReview(result.text, preview.sources), usage: result.usage, finishReason: result.finishReason, modelId: model.id, estimate: preview.estimate, fingerprint: preview.fingerprint })
  })
  async function execute(input: AiInput | ReviewTask, story: string, config: AiModel, estimate: ReturnType<typeof estimateRequest>, res: Response) {
    const model = config
    budget().reserve(estimate)
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, config.timeoutMs)
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', disconnect)
    active++
    try {
      const provider = (dependencies.provider ?? (settings => new OpenAiProvider(settings)))(config)
      const result = await Promise.race([provider.generate(input, story, controller.signal), new Promise<never>((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }) })])
      if (timedOut) throw new HttpError(504, 'AI 请求超时，请重试或缩短上下文')
      if (!controller.signal.aborted) return { ...result, modelId: model.id, estimate }
    } catch (error) {
      if (timedOut) throw new HttpError(504, 'AI 请求超时，请重试或缩短上下文')
      if (controller.signal.aborted) return
      if (error instanceof HttpError) throw error
      throw new HttpError(502, 'AI 服务请求失败，请稍后重试')
    } finally { clearTimeout(timeout); res.off('close', disconnect); active-- }
  }
  return router
}
