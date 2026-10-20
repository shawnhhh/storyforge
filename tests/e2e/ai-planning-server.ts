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
const app = createApp(db, backups, { models: () => [model], policy: { ...loadAiPolicy({}), requestsPerMinute: 120, sessionRequests: 1000, sessionTokens: 10000000 }, provider: () => ({ generate: async (_input, story, signal) => {
  if (story.includes('mock-error')) throw new HttpError(502, '模拟模型服务暂时不可用')
  if (story.includes('mock-slow')) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 1500); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')) }, { once: true }) })
  return { text: JSON.stringify({ title: 'AI 虚构预览', content: '虚构设定：浮空岛上的文明。目标、冲突、转折与悬念。<script>仅为文本</script>' }), finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 80 } }
} }) })
const server = app.listen(Number(process.env.SERVER_PORT), '127.0.0.1')
const shutdown = () => server.close(() => { db.close() })
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown)
