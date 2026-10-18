import { requireConfirmation } from '../trash/store.js'
import { Router } from 'express'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { RichTextDocument } from '../../../../shared/contracts/novels.js'
import { HttpError, NovelStore } from './store.js'

const schema = getSchema([StarterKit])
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `请输入${required ? '非空' : ''}文本（最多 ${max} 字符）`)
  return required ? value.trim() : value
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new HttpError(400, '缺少有效的数据版本号')
  return value
}
function content(value: unknown): RichTextDocument {
  try {
    if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'doc') throw new Error('Invalid document')
    const doc = schema.nodeFromJSON(value)
    doc.check()
    return value as RichTextDocument
  } catch { throw new HttpError(400, '正文格式无效，请使用当前版本的编辑器') }
}
export function novelRoutes(store: NovelStore) {
  const router = Router()
  router.get('/novels', (_req, res) => { res.json(store.list()) })
  router.post('/novels', (req, res) => { res.status(201).json(store.create(text(req.body?.title, 200, true), text(req.body?.description ?? '', 4000))) })
  router.get('/novels/:id', (req, res) => { res.json(store.detail(req.params.id)) })
  router.patch('/novels/:id', (req, res) => { res.json(store.update(req.params.id, version(req.body?.version), text(req.body?.title, 200, true), text(req.body?.description, 4000))) })
  router.delete('/novels/:id', (req, res) => { requireConfirmation(req.body?.confirmed); if (req.body?.name !== store.novel(req.params.id).title) throw new HttpError(400, '请输入完全匹配的小说名称'); store.remove(req.params.id, version(req.body?.version)); res.status(204).end() })
  router.post('/novels/:id/chapters', (req, res) => { res.status(201).json(store.createChapter(req.params.id, version(req.body?.version), text(req.body?.title, 200, true))) })
  router.put('/novels/:id/chapter-order', (req, res) => {
    const ids: unknown = req.body?.chapterIds
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new HttpError(400, '章节顺序格式无效')
    res.json(store.reorder(req.params.id, version(req.body?.version), ids))
  })
  router.get('/chapters/:id', (req, res) => { res.json(store.chapter(req.params.id)) })
  router.put('/chapters/:id', (req, res) => { res.json(store.saveChapter(req.params.id, version(req.body?.version), text(req.body?.title, 200, true), content(req.body?.content))) })
  router.delete('/chapters/:id', (req, res) => { requireConfirmation(req.body?.confirmed); res.json(store.removeChapter(req.params.id, version(req.body?.version), version(req.body?.novelVersion))) })
  return router
}
