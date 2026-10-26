import { Router } from 'express'
import type { TrashStore } from './store.js'
export function trashRoutes(store: TrashStore) {
  const router = Router()
  router.get('/trash', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(store.list()) })
  router.get('/trash/:id', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(store.preview(req.params.id)) })
  router.post('/trash/:id/restore', (req, res) => { store.restore(req.params.id, req.body?.confirmed); res.status(204).end() })
  router.delete('/trash/:id', (req, res) => { store.purge(req.params.id, req.body?.confirmed, req.body?.name); res.status(204).end() })
  return router
}
