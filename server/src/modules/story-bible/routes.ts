import { requireConfirmation } from '../trash/store.js'
import { KnowledgeStore, knowledgeInput } from './knowledge.js'
import { Router } from 'express'
import type { StoryBibleStore } from './store.js'
import { characterInput } from './validation.js'

export function storyBibleRoutes(store: StoryBibleStore, knowledge: KnowledgeStore) {
  const router = Router()
  router.get('/novels/:novelId/knowledge-links', (req, res) => { res.json(knowledge.read(req.params.novelId)) })
  router.put('/novels/:novelId/knowledge-links', (req, res) => {
    const links = knowledgeInput(req.body?.links), before = knowledge.read(req.params.novelId)
    if (before.links.some(old => !links.some(row => row.id === old.id))) requireConfirmation(req.body?.confirmed)
    res.json(knowledge.save(req.params.novelId, req.body?.version, links))
  })
  router.get('/novels/:novelId/story-bible', (req, res) => { res.json(store.list(req.params.novelId)) })
  router.post('/novels/:novelId/characters', (req, res) => { res.status(201).json(store.saveCharacter(req.params.novelId, req.body)) })
  router.put('/novels/:novelId/characters/:id', (req, res) => {
    const data = characterInput(req.body), old = store.list(req.params.novelId).characters.find(row => row.id === req.params.id)
    if (old && (old.relations.some(link => !data.relations.some(row => row.targetId === link.targetId && row.kind === link.kind)) || old.worldIds.some(id => !data.worldIds.includes(id)))) requireConfirmation(req.body?.confirmed)
    res.json(store.saveCharacter(req.params.novelId, data, req.params.id, req.body?.version))
  })
  router.post('/novels/:novelId/world', (req, res) => { res.status(201).json(store.saveWorld(req.params.novelId, req.body)) })
  router.put('/novels/:novelId/world/:id', (req, res) => { res.json(store.saveWorld(req.params.novelId, req.body, req.params.id, req.body?.version)) })
  for (const kind of ['characters', 'world'] as const) router.delete(`/novels/:novelId/${kind}/:id`, (req, res) => {
    requireConfirmation(req.body?.confirmed)
    store.remove(kind, req.params.novelId, req.params.id, req.body?.version)
    res.status(204).end()
  })
  return router
}
