import { requireConfirmation } from '../trash/store.js'
import { Router } from 'express'
import { PlanningStore } from './store.js'
import { planningInput } from './validation.js'

function removesReferences(before: object, after: object) {
  const previous = before as Record<string, unknown>, next = after as Record<string, unknown>
  return ['parentId', 'plotlineId'].some(key => previous[key] && previous[key] !== next[key]) ||
    ['cardIds', 'chapterIds', 'plantedChapterIds', 'plannedChapterIds', 'resolvedChapterIds'].some(key =>
      Array.isArray(previous[key]) && (previous[key] as string[]).some(id => !(next[key] as string[] | undefined)?.includes(id)))
}
export function planningRoutes(store: PlanningStore) {
  const router = Router()
  router.get('/novels/:id/planning', (req, res) => { res.json(store.read(req.params.id)) })
  router.put('/novels/:id/planning', (req, res) => {
    const data = planningInput(req.body), before = store.read(req.params.id)
    for (const kind of ['outlines', 'plotlines', 'cards', 'foreshadows'] as const) {
      for (const old of before[kind]) {
        const next = data[kind].find(row => row.id === old.id)
        if (!next || removesReferences(old, next)) requireConfirmation(req.body?.confirmed)
      }
    }
    res.json(store.save(req.params.id, req.body?.version, data))
  })
  return router
}
