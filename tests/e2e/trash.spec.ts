import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Novel, NovelDetail, ChapterResult } from '../../shared/contracts/novels.js'
import type { TrashEntry } from '../../shared/contracts/trash.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { readFileSync } from 'node:fs'
import { openDeleteMenu } from './trash-helpers.js'

async function seed(request: APIRequestContext) {
  const headers = { 'X-StoryForge-Generation': (await request.get('/api/health')).headers()['x-storyforge-generation'] }
  const novel = await (await request.post('/api/novels', { headers, data: { title: `虚构回收站-${crypto.randomUUID().slice(0, 8)}`, description: '仅临时测试数据库' } })).json() as Novel
  const created = await (await request.post(`/api/novels/${novel.id}/chapters`, { headers, data: { version: novel.version, title: '虚构安全章节' } })).json() as ChapterResult
  expect((await request.put(`/api/chapters/${created.chapter.id}`, { headers, data: { version: 1, title: created.chapter.title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '仅用于隔离验收的虚构正文' }] }] } } })).ok()).toBeTruthy()
  const detail = await (await request.get(`/api/novels/${novel.id}`)).json() as NovelDetail
  return { novel: detail.novel, chapter: created.chapter, headers }
}
async function openNovel(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toBeVisible()
}
const trash = (page: Page) => page.getByRole('region', { name: '回收站内容', exact: true })
const row = (page: Page, name: string) => trash(page).locator('.trash-list>li').filter({ has: page.getByText(name, { exact: true }) })
async function openTrash(page: Page) { await page.getByRole('button', { name: '回收站', exact: true }).click(); await expect(trash(page)).toBeVisible() }
async function restore(page: Page, name: string) {
  page.once('dialog', dialog => dialog.accept())
  await row(page, name).getByRole('button', { name: '恢复', exact: true }).click()
}

test('trash: a legacy protected planning draft cannot recreate a purged event and remains exportable', async ({ page, request }) => {
  const f = await seed(request), root = `/api/novels/${f.novel.id}/planning`, data = emptyPlanning()
  data.cards.push({ id: 'purged-event', title: '已永久删除的虚构事件', content: '旧草稿正文必须仍能导出', summary: '', status: 'planned', plotlineId: null, storyTime: '元年', timeOrder: 1, chapterIds: [f.chapter.id], characterIds: [], worldIds: [] })
  const saved = await (await request.put(root, { headers: f.headers, data: { ...data, version: 0 } })).json()
  expect(saved.version).toBe(1)
  expect((await request.put(root, { headers: f.headers, data: { ...emptyPlanning(), version: saved.version, confirmed: true } })).ok()).toBeTruthy()
  const archives = await (await request.get('/api/trash')).json() as TrashEntry[]
  const entry = archives.find(row => row.novelId === f.novel.id && row.kind === 'planning')!
  expect(entry).toBeTruthy()
  expect((await request.delete(`/api/trash/${entry.id}`, { headers: f.headers, data: { confirmed: true, name: entry.name } })).ok()).toBeTruthy()
  await page.goto('/')
  await page.evaluate(({ snapshot, generation }) => localStorage.setItem(`storyforge:planning:draft:${snapshot.novelId}`, JSON.stringify({ snapshot, generation })), { snapshot: saved, generation: f.headers['X-StoryForge-Generation'] })
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: new RegExp(f.novel.title) }).click()
  await page.getByRole('button', { name: '创作规划', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  expect((await (await request.get(root)).json()).cards).toEqual([])
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(page.locator('.planning-status')).toHaveText('版本冲突 · 草稿已保留')
  expect((await (await request.get(root)).json()).cards).toEqual([])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出规划草稿', exact: true }).click()
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'))
  expect(exported.cards[0].id).toBe('purged-event')
  expect(exported.cards[0].content).toBe('旧草稿正文必须仍能导出')
})

test('trash: cancel/confirm chapter deletion, preview, restore and exact-name whole-novel deletion', async ({ page, request }) => {
  const f = await seed(request)
  await openNovel(page, f.novel.title)
  await openDeleteMenu(page, '删除当前章节')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '删除当前章节' }).click()
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('仅用于隔离验收的虚构正文')
  page.once('dialog', async dialog => { expect(dialog.message()).toContain(f.chapter.title); expect(dialog.message()).toContain('规划'); await dialog.accept() })
  await page.getByRole('button', { name: '删除当前章节' }).click()
  await expect(page.getByRole('button', { name: '创建第一章' })).toBeVisible()
  await openTrash(page)
  await expect(row(page, f.chapter.title)).toContainText('保留至')
  await row(page, f.chapter.title).getByRole('button', { name: '查看内容' }).click()
  await expect(page.getByRole('dialog')).toContainText('仅用于隔离验收的虚构正文')
  await page.getByRole('dialog').getByRole('button', { name: /^关闭回收站内容/ }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await row(page, f.chapter.title).getByRole('button', { name: '恢复', exact: true }).click()
  await expect(row(page, f.chapter.title)).toBeVisible()
  await restore(page, f.chapter.title)
  await expect(row(page, f.chapter.title)).toHaveCount(0)
  await openNovel(page, f.novel.title)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('仅用于隔离验收的虚构正文')
  await openDeleteMenu(page, '删除小说')
  await page.getByRole('button', { name: '删除小说', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '删除整本小说' })
  await dialog.getByLabel('输入完整名称确认').fill(f.novel.title + ' ')
  await expect(dialog.getByRole('button', { name: '移入回收站' })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(f.novel.title)
  await page.getByRole('button', { name: '删除小说', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除整本小说' })
  await dialog.getByLabel('输入完整名称确认').fill(f.novel.title)
  await dialog.getByRole('button', { name: '移入回收站' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('创作工作台')
  await openTrash(page)
  await expect(row(page, f.novel.title)).toContainText('章节 1 项')
  await restore(page, f.novel.title)
  await expect(row(page, f.novel.title)).toHaveCount(0)
  await openNovel(page, f.novel.title)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toHaveText('仅用于隔离验收的虚构正文')
})

test('trash: parent restoration and permanent-deletion protection are enforced by the server', async ({ page, request }) => {
  const f = await seed(request)
  expect((await request.delete(`/api/chapters/${f.chapter.id}`, { headers: f.headers, data: { version: 2, novelVersion: f.novel.version, confirmed: true } })).ok()).toBeTruthy()
  const novel = (await (await request.get(`/api/novels/${f.novel.id}`)).json() as NovelDetail).novel
  expect((await request.delete(`/api/novels/${novel.id}`, { headers: f.headers, data: { version: novel.version, name: novel.title, confirmed: true } })).ok()).toBeTruthy()
  await page.goto('/'); await openTrash(page)
  await restore(page, f.chapter.title)
  await expect(trash(page).getByRole('alert')).toContainText('先恢复所属小说')
  const parent = row(page, novel.title)
  await parent.locator('.delete-menu summary').click()
  await parent.getByRole('button', { name: '永久删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '永久删除', exact: true })
  await dialog.getByLabel('输入完整名称确认').fill(novel.title)
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他回收站项目')
  await dialog.getByRole('button', { name: '取消' }).click()
  await restore(page, novel.title); await expect(parent).toHaveCount(0)
  await restore(page, f.chapter.title); await expect(row(page, f.chapter.title)).toHaveCount(0)
  await openNovel(page, novel.title)
  await expect(page.getByRole('textbox', { name: '小说正文' })).toContainText('虚构正文')
})

test('trash: planning association conflict blocks restore, preserves the archive and rolls back inserted parents', async ({ page, request }) => {
  const f = await seed(request), data = emptyPlanning()
  data.outlines = [{ id: 'parent', title: '虚构大纲父项', content: '', kind: 'overall', parentId: null, chapterIds: [] }, { id: 'child', title: '虚构大纲子项', content: '', kind: 'chapter', parentId: 'parent', chapterIds: [] }]
  const root = `/api/novels/${f.novel.id}/planning`
  expect((await request.put(root, { headers: f.headers, data: { ...data, version: 0 } })).ok()).toBeTruthy()
  expect((await request.put(root, { headers: f.headers, data: { ...data, version: 1, confirmed: true, outlines: [{ ...data.outlines[1], parentId: null }] } })).ok()).toBeTruthy()
  expect((await request.put(root, { headers: f.headers, data: { ...data, version: 2, outlines: [{ ...data.outlines[1], parentId: null, content: '后续新编辑必须保留' }] } })).ok()).toBeTruthy()
  await page.goto('/'); await openTrash(page)
  await restore(page, '虚构大纲父项')
  await expect(trash(page).getByRole('alert')).toContainText('规划已修改')
  await expect(row(page, '虚构大纲父项')).toBeVisible()
  const result = await (await request.get(root)).json()
  expect(result.outlines).toHaveLength(1); expect(result.outlines[0].content).toBe('后续新编辑必须保留')
  expect((await request.put(root, { headers: f.headers, data: { ...result, outlines: [{ ...result.outlines[0], content: '' }] } })).ok()).toBeTruthy()
  await restore(page, '虚构大纲父项'); await expect(row(page, '虚构大纲父项')).toHaveCount(0)
  expect((await (await request.get(root)).json()).outlines.find((item: { id: string }) => item.id === 'child').parentId).toBe('parent')
})

test('trash: permanent deletion requires exact name, cancellation keeps data, and mobile layout stays within viewport', async ({ page, request }) => {
  const f = await seed(request)
  expect((await request.delete(`/api/novels/${f.novel.id}`, { headers: f.headers, data: { version: f.novel.version, confirmed: true, name: f.novel.title } })).ok()).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await openTrash(page)
  const item = row(page, f.novel.title)
  await item.locator('.delete-menu summary').click()
  await item.getByRole('button', { name: '永久删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '永久删除', exact: true })
  await dialog.getByLabel('输入完整名称确认').fill('错误名称')
  await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消' }).click(); await expect(item).toBeVisible()
  await item.getByRole('button', { name: '永久删除', exact: true }).click()
  await dialog.getByLabel('输入完整名称确认').fill(f.novel.title)
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(item).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const entries = await (await request.get('/api/trash')).json() as TrashEntry[]
  expect(entries.some(entry => entry.novelId === f.novel.id)).toBe(false)
})

test('trash: expired entries show their deadline and disable restoration (service boundary is covered by SQLite tests)', async ({ page }) => {
  await page.route('**/api/trash', route => route.fulfill({ json: [{ id: 'expired-mock', novelId: 'fictional', kind: 'chapter', name: '虚构到期章节', deletedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-31T00:00:00.000Z', affected: { chapters: 1 } }] }))
  await page.goto('/'); await openTrash(page)
  await expect(row(page, '虚构到期章节')).toContainText('已到期，等待清理')
  await expect(row(page, '虚构到期章节').getByRole('button', { name: '恢复', exact: true })).toBeDisabled()
})
