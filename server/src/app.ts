import express from 'express'
import type { ErrorRequestHandler } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import type { HealthResponse } from '../../shared/contracts/health.js'
import { novelRoutes } from './modules/novels/routes.js'
import { HttpError, NovelStore } from './modules/novels/store.js'

export function createApp(database: DatabaseSync) {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin')
      if (origin) {
        try {
          const url = new URL(origin)
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Untrusted origin')
        } catch { res.status(403).json({ message: '只允许本机工作台修改数据' }); return }
      }
      if (!req.is('application/json')) { res.status(415).json({ message: '请求必须使用 JSON' }); return }
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))
  app.get('/api/health', (_request, response) => {
    const health: HealthResponse = { status: 'ok' }
    response.json(health)
  })
  app.use('/api', novelRoutes(new NovelStore(database)))
  app.use('/api', (_req, res) => { res.status(404).json({ message: '接口不存在' }) })
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next
    if (error instanceof HttpError) { res.status(error.status).json({ message: error.message }); return }
    if (error instanceof SyntaxError) { res.status(400).json({ message: 'JSON 格式无效' }); return }
    if (typeof error === 'object' && error && 'status' in error && error.status === 413) { res.status(413).json({ message: '正文超过 1MB，请拆分章节' }); return }
    console.error(error)
    res.status(500).json({ message: '本地服务保存失败，请检查服务和磁盘后重试' })
  }
  app.use(errors)
  return app
}
