import { Router } from 'express'
import { BackupService } from './service.js'

export function backupRoutes(service: BackupService) {
  const router = Router()
  router.get('/backups', (_req, res) => { res.json(service.history()) })
  router.put('/backups/settings', (req, res) => { res.json(service.configure(req.body)) })
  router.post('/backups', async (_req, res) => { res.status(201).json(await service.create()) })
  router.post('/backups/:id/verify', (req, res) => { res.json(service.verify(req.params.id)) })
  router.post('/backups/:id/prepare-restore', (req, res) => { res.json(service.prepare(req.params.id)) })
  router.post('/backups/:id/restore', async (req, res) => { res.json(await service.restore(req.params.id, req.body?.token, req.body?.confirmation)) })
  return router
}
