import { Router } from 'express'
import type { StudioStore } from './store.js'
export function studioRoutes(store: StudioStore) {
  const router = Router()
  router.get('/projects', (req, res) => res.json(store.list(req.query.kind)))
  router.post('/projects', (req, res) => res.status(201).json(store.create(req.body ?? {})))
  router.get('/projects/:id', (req, res) => res.json(store.project(req.params.id)))
  router.put('/projects/:id', (req, res) => res.json(store.save(req.params.id, req.body ?? {})))
  router.get('/projects/:id/history', (req, res) => res.json(store.history(req.params.id)))
  router.get('/projects/:id/assets', (req, res) => res.json(store.assets(req.params.id)))
  router.post('/projects/:id/assets', (req, res) => res.status(201).json(store.addAsset(req.params.id, req.body ?? {})))
  router.get('/assets/:id/content', (req, res) => {
    const asset = store.asset(req.params.id)
    res.setHeader('Content-Type', String(asset.mime)); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'no-store'); res.send(Buffer.from(asset.data as Uint8Array))
  })
  router.get('/projects/:id/tasks', (req, res) => res.json(store.tasks(req.params.id)))
  router.post('/projects/:id/generate', async (req, res) => res.status(202).json(await store.generate(req.params.id, req.body ?? {})))
  router.get('/projects/:id/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="storyforge-project.json"')
    res.setHeader('Cache-Control', 'no-store'); res.json(store.export(req.params.id))
  })
  return router
}
