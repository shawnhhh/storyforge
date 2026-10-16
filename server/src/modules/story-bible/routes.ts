import { KnowledgeStore } from './knowledge.js'
import { Router } from 'express'
import type { StoryBibleStore } from './store.js'

export function storyBibleRoutes(store: StoryBibleStore, knowledge: KnowledgeStore) {
  const router = Router()
  router.get('/novels/:novelId/knowledge-links', (req, res) => { res.json(knowledge.read(req.params.novelId)) })
  router.put('/novels/:novelId/knowledge-links', (req, res) => { res.json(knowledge.save(req.params.novelId, req.body?.version, req.body?.links)) })
  router.get('/novels/:novelId/story-bible', (req, res) => { res.json(store.list(req.params.novelId)) })
  router.post('/novels/:novelId/characters', (req, res) => { res.status(201).json(store.saveCharacter(req.params.novelId, req.body)) })
  router.put('/novels/:novelId/characters/:id', (req, res) => { res.json(store.saveCharacter(req.params.novelId, req.body, req.params.id, req.body?.version)) })
  router.post('/novels/:novelId/world', (req, res) => { res.status(201).json(store.saveWorld(req.params.novelId, req.body)) })
  router.put('/novels/:novelId/world/:id', (req, res) => { res.json(store.saveWorld(req.params.novelId, req.body, req.params.id, req.body?.version)) })
  for (const kind of ['characters', 'world'] as const) router.delete(`/novels/:novelId/${kind}/:id`, (req, res) => {
    store.remove(kind, req.params.novelId, req.params.id, req.body?.version); res.status(204).end()
  })
  return router
}
