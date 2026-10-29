import {createHash} from 'node:crypto'
import type { ProjectSummary } from '../../../../shared/contracts/studio.js'
import type { NovelStore } from '../novels/store.js'
import { Router } from 'express'
import { HttpError } from '../novels/store.js'
import { string, type StudioStore } from './store.js'
export function studioRoutes(store: StudioStore, stories: NovelStore) {
  const router = Router()
  router.get('/costs',(_req,res)=>res.json({models:store.costs.policy.models,monthly:store.costs.month()}))
  router.post('/projects/:id/estimate',(req,res)=>{const project=store.project(req.params.id),input={project,prompt:string(req.body.prompt,'提示词',10000)},provider=String(req.body.provider??'mock'),model=String(req.body.model??'mock-v1'),adapter=store.jobs.providers.find(p=>p.id===provider);if(!adapter)throw new HttpError(400,'服务商未启用');adapter.validate(input,model);res.json(store.costs.quote(input,provider,model))})
  router.get('/providers', (_req, res) => res.json(store.jobs.providers.map(p => ({ id: p.id, models: p.models, capabilities:p.capabilities, keyConfigured:store.keyVault?.configured(p.id)??false }))))
  router.post('/tasks/:id/cancel', (req, res) => res.json(store.jobs.cancel(req.params.id)))
  router.get('/tasks/:id/history', (req, res) => { store.jobs.task(req.params.id); res.json(store.jobs.history(req.params.id)) })
  router.post('/webhooks/:provider', (req, res) => { store.jobs.webhook(req.params.provider, req.body, req.get('x-provider-signature') ?? ''); res.sendStatus(202) })
  router.post('/projects/:id/uploads',(req,res)=>res.status(201).json(store.media.start(req.params.id,req.body,req.body.kind==='backup'?'backup':'media')))
  router.get('/uploads/:id',(req,res)=>res.json(store.media.upload(req.params.id)))
  router.put('/uploads/:id',(req,res)=>res.json(store.media.chunk(req.params.id,req.body)))
  router.post('/uploads/:id/complete',async(req,res)=>res.status(201).json(await store.media.complete(req.params.id)))
  router.get('/projects/:id/media',(req,res)=>{store.project(req.params.id);res.json(store.media.list(req.params.id))})
  router.get('/media/:id/content',(req,res)=>{const asset=store.media.ref(req.params.id);res.set('Content-Type',String(asset.mime)).set('X-Content-Type-Options','nosniff').set('Content-Security-Policy',"default-src 'none'; sandbox").set('Cache-Control','no-store').sendFile(store.media.safe(store.media.objectPath(String(asset.digest))))})
  router.get('/media/:id/verify',async(req,res)=>{const r=store.media.ref(req.params.id);await store.media.verify(String(r.digest));res.json({digest:r.digest,references:store.media.references(String(r.digest))})})
  router.delete('/media/:id',(req,res)=>{store.media.unlink(req.params.id);res.sendStatus(204)})
  router.post('/media-gc',(_req,res)=>res.json(store.media.gc()))
  const importer = store.importer()
  router.post('/import/preview', (req, res) => res.json(importer.prepare(req.body.archive)))
  router.post('/import/confirm', (req, res) => res.status(201).json(importer.restore(req.body.archive, req.body.token, req.body.confirmation)))
  router.get('/catalog', (_req, res) => {
    const catalog: ProjectSummary[] = [
      ...stories.list().map(p => ({ id: p.id, module: 'story' as const, title: p.title, version: p.version, updatedAt: p.updatedAt })),
      ...(['music', 'video'] as const).flatMap(kind => store.list(kind).map(p => ({ id: p.id, module: kind, title: p.title, version: p.version, updatedAt: p.updatedAt }))),
    ]
    res.json(catalog)
  })
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
    const data=Buffer.from(asset.data as Uint8Array),etag='"'+createHash('sha256').update(data).digest('hex')+'"'
    res.set('Cache-Control','no-store').set('Accept-Ranges','bytes').set('ETag',etag)
    if(req.get('range')&&(!req.get('if-range')||req.get('if-range')===etag)){
      const ranges=req.range(data.length,{combine:true})
      if(!ranges||typeof ranges==='number'||ranges.type!=='bytes'||ranges.length!==1){res.set('Content-Range',`bytes */${data.length}`).status(416).end();return}
      const {start,end}=ranges[0];res.set('Content-Range',`bytes ${start}-${end}/${data.length}`).status(206).send(data.subarray(start,end+1));return
    }
    res.send(data)
  })
  router.get('/projects/:id/tasks', (req, res) => res.json(store.tasks(req.params.id)))
  router.post('/projects/:id/generate', async (req, res) => res.status(202).json(await store.generate(req.params.id, req.body ?? {})))
  router.get('/projects/:id/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="storyforge-project.json"')
    res.setHeader('Cache-Control', 'no-store'); res.json(store.export(req.params.id))
  })
  return router
}
