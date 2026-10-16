import { Router } from 'express'
import { DashboardStore } from './store.js'

export function dashboardRoutes(store: DashboardStore) {
  const router = Router()
  router.get('/dashboard', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(store.read()) })
  router.put('/dashboard/goal', (req, res) => { res.json(store.setGoal(req.body?.dailyGoal)) })
  return router
}
