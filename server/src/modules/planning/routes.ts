import { Router } from 'express'
import { PlanningStore } from './store.js'
export function planningRoutes(store: PlanningStore) {
  const router = Router()
  router.get('/novels/:id/planning', (req, res) => { res.json(store.read(req.params.id)) })
  router.put('/novels/:id/planning', (req, res) => { res.json(store.save(req.params.id, req.body?.version, req.body)) })
  return router
}
