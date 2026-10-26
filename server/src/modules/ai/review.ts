import { createHash } from 'node:crypto'
import { reviewChapterLimit, reviewCategories, type ReviewInput, type ReviewSource, type ReviewFinding, type ReviewTask } from '../../../../shared/contracts/consistency-review.js'
import { HttpError } from '../novels/store.js'
import { validateContext, type AiContext } from './context.js'
import { buildMessages } from './provider.js'
import { generationParameters, type AiModel } from './models.js'
import { estimateRequest } from './budget.js'

export function validateReviewInput(value: unknown): ReviewInput & { fingerprint?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '审阅请求格式无效')
  const data = value as Record<string, unknown>
  if (Object.keys(data).some(key => !['chapterId', 'chapterText', 'context', 'modelId', 'parameters', 'fingerprint'].includes(key))) throw new HttpError(400, '审阅只允许当前章节与明确选择的引用')
  if (typeof data.chapterId !== 'string' || !data.chapterId || data.chapterId.length > 100 || typeof data.chapterText !== 'string' || !data.chapterText.trim()) throw new HttpError(400, '请提供当前章节正文')
  if (data.chapterText.length > reviewChapterLimit) throw new HttpError(413, `当前章节超过 ${reviewChapterLimit} 字符，无法完整审阅；不会自动截断正文`)
  if (typeof data.modelId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(data.modelId)) throw new HttpError(400, '模型标识无效')
  if (data.fingerprint !== undefined && (typeof data.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.fingerprint))) throw new HttpError(400, '审阅确认无效，请重新预览')
  validateContext(data.context)
  return data as unknown as ReviewInput & { fingerprint?: string }
}
export function prepareReview(input: ReviewInput, model: AiModel, contexts: AiContext) {
  const parameters = generationParameters(input.parameters, model)
  const sources: ReviewSource[] = [{ id: 'current', label: '当前章节（编辑器快照）', text: input.chapterText, truncated: false }]
  const context = contexts.preview(input.chapterId, input.context, (id, label, text, truncated) => { sources.push({ id, label, text, truncated }) })
  const task: ReviewTask = { action: 'consistency-review', sources }
  const messages = buildMessages(task, '')
  const fingerprint = createHash('sha256').update(JSON.stringify({ chapterId: input.chapterId, contextFingerprint: context.fingerprint, model: { id: model.id, model: model.model, provider: model.provider, baseUrl: model.baseUrl }, parameters, messages })).digest('hex')
  return { task, parameters, preview: { fingerprint, messages, sources, estimate: estimateRequest(messages, parameters, model) } }
}
export function parseReview(text: string, sources: ReviewSource[]): ReviewFinding[] {
  const invalid = () => new HttpError(502, 'AI 审阅结果格式无效，请重新审阅；正文未修改')
  let data: unknown
  try { data = JSON.parse(text) } catch { throw invalid() }
  if (!data || typeof data !== 'object' || !('findings' in data) || !Array.isArray(data.findings) || data.findings.length > 20) throw invalid()
  return data.findings.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw invalid()
    const row = item as Record<string, unknown>
    if (typeof row.category !== 'string' || !Object.hasOwn(reviewCategories, row.category) || !['conflict', 'suggestion'].includes(String(row.certainty)) || typeof row.explanation !== 'string' || !row.explanation.trim() || row.explanation.length > 2000 || typeof row.suggestion !== 'string' || !row.suggestion.trim() || row.suggestion.length > 2000 || !Array.isArray(row.evidence) || row.evidence.length > 8) throw invalid()
    const evidence: ReviewFinding['evidence'] = []
    let incomplete = false
    for (const raw of row.evidence) {
      if (!raw || typeof raw !== 'object' || typeof raw.sourceId !== 'string' || typeof raw.quote !== 'string' || !raw.quote.trim() || raw.quote.length > 2000) { incomplete = true; continue }
      const source = sources.find(source => source.id === raw.sourceId)
      if (!source || !source.text.includes(raw.quote)) { incomplete = true; continue }
      if (!evidence.some(item => item.sourceId === raw.sourceId && item.quote === raw.quote)) evidence.push({ sourceId: raw.sourceId, quote: raw.quote })
    }
    // Exact citations establish provenance, not semantic truth; authors still verify conflicts.
    const supported = !incomplete && new Set(evidence.map(item => item.quote)).size >= 2
    return { category: row.category as ReviewFinding['category'], certainty: row.certainty === 'conflict' && supported ? 'conflict' : 'suggestion', explanation: row.explanation, suggestion: row.suggestion, evidence, evidenceIncomplete: incomplete || (row.certainty === 'conflict' && !supported) }
  })
}
