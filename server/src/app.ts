import { TrashStore } from './modules/trash/store.js'
import { trashRoutes } from './modules/trash/routes.js'
import { DashboardStore } from './modules/dashboard/store.js'
import { dashboardRoutes } from './modules/dashboard/routes.js'
import { KnowledgeStore } from './modules/story-bible/knowledge.js'
import { PlanningStore } from './modules/planning/store.js'
import { planningRoutes } from './modules/planning/routes.js'
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import type { HealthResponse } from '../../shared/contracts/health.js'
import { novelRoutes } from './modules/novels/routes.js'
import { HttpError, NovelStore } from './modules/novels/store.js'
import { BackupService } from './modules/backups/service.js'
import { backupRoutes } from './modules/backups/routes.js'
import { exportNovel } from './modules/novels/export.js'
import { storyBibleRoutes } from './modules/story-bible/routes.js'
import { StoryBibleStore } from './modules/story-bible/store.js'
import { aiRoutes, type AiDependencies } from './modules/ai/routes.js'
import { searchRoutes } from './modules/search/routes.js'

export function createApp(database: DatabaseSync, backups?: BackupService, ai?: AiDependencies) {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    // Prevent DNS rebinding; Vite forwards the original loopback Host.
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.get('host') ?? '')) { res.status(403).json({ message: '只允许 127.0.0.1 访问本地服务' }); return }
    if (backups) res.setHeader('X-StoryForge-Generation', backups.generation)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin')
      if (origin) {
        try {
          const url = new URL(origin)
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Untrusted origin')
        } catch { res.status(403).json({ message: '只允许本机工作台修改数据' }); return }
      }
      if (!req.is('application/json')) { res.status(415).json({ message: '请求必须使用 JSON' }); return }
      if (backups?.busy) { res.status(423).json({ message: '备份或恢复正在进行，请稍后重试' }); return }
      if (backups && req.get('X-StoryForge-Generation') !== backups.generation) { res.status(409).json({ message: '服务已重启或数据库已恢复。请先导出未保存草稿，再刷新整个页面。' }); return }
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))
  app.get('/api/health', (_request, response) => {
    const health: HealthResponse = { status: 'ok' }
    response.json(health)
  })
  const novels = new NovelStore(database)
  const planning = new PlanningStore(database)
  const profiles = new StoryBibleStore(database)
  const knowledge = new KnowledgeStore(database)
  app.use('/api', aiRoutes(novels, planning, profiles, ai))
  app.get('/api/novels/:id/export', (req, res) => {
    const exported = exportNovel(novels, req.params.id, req.query.format, planning.read(req.params.id), { profiles: profiles.list(req.params.id), references: knowledge.read(req.params.id) })
    res.setHeader('Content-Type', exported.mime)
    res.setHeader('Content-Disposition', `attachment; filename="novel.${exported.extension}"; filename*=UTF-8''${encodeURIComponent(exported.filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(exported.body)
  })
  if (backups) app.use('/api', backupRoutes(backups))
  app.use('/api', trashRoutes(new TrashStore(database)))
  app.use('/api', searchRoutes(database))
  app.use('/api', planningRoutes(planning))
  app.use('/api', dashboardRoutes(new DashboardStore(database)))
  app.use('/api', novelRoutes(novels))
  app.use('/api', storyBibleRoutes(profiles, knowledge))
  app.use('/api', (_req, res) => { res.status(404).json({ message: '接口不存在' }) })
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next
    if (error instanceof HttpError) { res.status(error.status).json({ message: error.message }); return }
    if (error instanceof SyntaxError) { res.status(400).json({ message: 'JSON 格式无效' }); return }
    if (typeof error === 'object' && error && 'status' in error && error.status === 413) { res.status(413).json({ message: '正文超过 1MB，请拆分章节' }); return }
    console.error(error)
    res.status(500).json({ message: '本地服务操作失败，请检查服务日志与磁盘后重试；恢复事务失败会回滚当前数据' })
  }
  app.use(errors)
  return app
}
