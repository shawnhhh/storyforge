import express from 'express'
import { generatedCharacter } from '../fixtures/ai-planning.js'
// Test-only composition root: no OpenAiProvider, credentials, .env or external transport.
import { isAbsolute, basename } from 'node:path'
import { createApp } from '../../server/src/app.js'
import { openDatabase } from '../../server/src/db/database.js'
import { BackupService } from '../../server/src/modules/backups/service.js'
import { HttpError } from '../../server/src/modules/novels/store.js'
import { loadAiPolicy } from '../../server/src/modules/ai/budget.js'
import type { AiModel } from '../../server/src/modules/ai/models.js'
const directory = process.env.STORYFORGE_DATA_DIR
if (process.env.E2E_PLANNING_MOCK !== '1' || !directory || !isAbsolute(directory) || !basename(directory).startsWith('storyforge-e2e-') || !process.env.STORYFORGE_BACKUP_DIR) throw new Error('Mock server requires an isolated E2E directory')
const db = openDatabase(directory), backups = new BackupService(db, process.env.STORYFORGE_BACKUP_DIR)
const model: AiModel = { id: 'planning-mock', label: '虚构测试模型', model: 'fiction-only', provider: 'compatible', apiKey: 'fake-test-key', baseUrl: 'https://example.invalid/v1', timeoutMs: 5000, maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
let currentModel = { ...model }
const policy = { ...loadAiPolicy({}), requestsPerMinute: 120, sessionRequests: 1000, sessionTokens: 10000000 }
const app = express()
app.use(express.json())
app.post('/api/__test/control', (req, res) => {
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.get('host') ?? '')) { res.status(403).end(); return }
  const action = req.body?.action
  if (action === 'reset') { currentModel = { ...model }; Object.assign(policy, { ...loadAiPolicy({}), requestsPerMinute: 120, sessionRequests: 1000, sessionTokens: 10000000 }) }
  else if (action === 'rotate-model') currentModel = { ...currentModel, model: currentModel.model + '-rotated' }
  else if (action === 'timeout') currentModel = { ...currentModel, timeoutMs: 50 }
  else if (action === 'budget') policy.sessionTokens = 1
  else if (action === 'large' && typeof req.body?.novelId === 'string' && db.prepare('SELECT id FROM novels WHERE id=?').get(req.body.novelId)) {
    const statement = db.prepare('INSERT INTO characters(id,novel_id,name,fields,created_at,updated_at) VALUES (?,?,?,?,?,?)'), now = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (let i = 0; i < 2000; i++) statement.run(req.body.novelId + '-ui-person-' + i, req.body.novelId, '大库人物' + String(i).padStart(5, '0'), JSON.stringify({ ...generatedCharacter.fields, notes: '' }), now, now)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  } else { res.status(400).json({ message: 'Unknown isolated fixture action' }); return }
  res.json({ ok: true })
})
app.use(createApp(db, backups, { models: () => [currentModel], policy, provider: () => ({ generate: async (input, story, signal) => {
  if (input.action === 'consistency-review') return { text: JSON.stringify({ findings: [{ category: 'world', certainty: 'conflict', explanation: '集成引用规则待核实', suggestion: '核对设定中的例外', evidence: input.sources.slice(0, 2).map(source => ({ sourceId: source.id, quote: source.text.slice(0, 12) })) }] }), finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 80 } }
  if (story.includes('mock-error')) throw new HttpError(502, '模拟模型服务暂时不可用')
  if (story.includes('mock-slow')) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 1500); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')) }, { once: true }) })
  return { text: JSON.stringify({ title: 'AI 虚构预览', content: '虚构设定：浮空岛上的文明。目标、冲突、转折与悬念。<script>仅为文本</script>', ...(input.instructions.includes('人物设定') ? { character: generatedCharacter } : {}) }), finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 80 } }
} }) }))
const server = app.listen(Number(process.env.SERVER_PORT), '127.0.0.1')
const shutdown = () => server.close(() => { db.close() })
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown)
