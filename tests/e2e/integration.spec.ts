import { expect, test, type APIRequestContext } from '@playwright/test'
import type { ChapterResult, Novel } from '../../shared/contracts/novels.js'
import type { WritingDashboard } from '../../shared/contracts/dashboard.js'
import { newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { expectChapterReady } from './editor-helpers.js'

async function seed(request: APIRequestContext) {
  const health = await request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const post = async (path: string, data: unknown) => {
    const response = await request.post('/api' + path, { headers, data })
    expect(response.ok()).toBe(true); return response.json()
  }
  const novel = await post('/novels', { title: `集成 Mock-${crypto.randomUUID()}`, description: '' }) as Novel
  const first = await post(`/novels/${novel.id}/chapters`, { title: '集成首章', version: novel.version }) as ChapterResult
  const second = await post(`/novels/${novel.id}/chapters`, { title: '集成续写章', version: first.novel.version }) as ChapterResult
  const world = await post(`/novels/${novel.id}/world`, { ...newWorld(), name: '集成参考地点', description: 'Mock 港口' })
  expect((await request.put(`/api/chapters/${second.chapter.id}`, { headers, data: { version: 1, title: second.chapter.title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '集成基线正文' }] }] } } })).ok()).toBe(true)
  expect((await request.put(`/api/novels/${novel.id}/knowledge-links`, { headers, data: { version: 0, links: [{ id: 'reference', source: { kind: 'chapter', id: second.chapter.id }, target: { kind: 'world', id: world.id }, label: '场景', note: '集成引用' }] } })).ok()).toBe(true)
  const plan = emptyPlanning()
  plan.cards.push({ id: 'integration-card', title: '集成剧情卡', content: '集成规划暗号', summary: '', status: 'idea', plotlineId: null, storyTime: '', timeOrder: null, chapterIds: [second.chapter.id] })
  expect((await request.put(`/api/novels/${novel.id}/planning`, { headers, data: { ...plan, version: 0 } })).ok()).toBe(true)
  return { novel, second }
}

test('integration: dashboard continuation, AI autosave, references, search and preferences share one chapter safely', async ({ page, request }) => {
  const { novel, second } = await seed(request)
  const before = await (await request.get('/api/dashboard')).json() as WritingDashboard
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/ai/status', route => route.fulfill({ json: { configured: true, message: 'Mock 已就绪' } }))
  await page.route('**/api/ai/models', route => route.fulfill({ json: { models: [{ id: 'mock', label: 'Mock', model: 'mock', provider: 'openai', configured: true, maxOutputTokens: 4096 }], policy: {}, remaining: { requests: 10, tokens: 10000, usd: 0 } } }))
  await page.route('**/api/ai/generate', route => route.fulfill({ json: { text: '集成生成片段', usage: {}, finishReason: 'stop' } }))
  await page.goto('/')
  await page.locator('.dashboard-work').filter({ hasText: novel.title }).getByRole('button', { name: '打开作品' }).click()
  const body = await expectChapterReady(page, second.chapter.title, '集成基线正文')
  await body.click(); await body.press('ControlOrMeta+End')
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const ai = page.getByRole('dialog', { name: 'AI 辅助写作' })
  await ai.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(ai.getByLabel('AI 结果预览')).toContainText('集成生成片段')
  await expect(body).toHaveText('集成基线正文')
  await ai.getByRole('button', { name: '接受并插入' }).click()
  await expect(body).toHaveText('集成基线正文集成生成片段')
  await expect(page.locator('.save-status')).toHaveText('已保存')
  const after = await (await request.get('/api/dashboard')).json() as WritingDashboard
  expect(after.totalWords - before.totalWords).toBe(6)
  expect(after.todayWords - before.todayWords).toBe(6)
  await page.getByRole('button', { name: '查阅与引用创作资料' }).click()
  await page.getByRole('region', { name: '章节资料引用' }).getByRole('button', { name: '集成参考地点', exact: true }).click()
  await expect(page.getByLabel('设定名称', { exact: true })).toHaveValue('集成参考地点')
  await page.getByRole('region', { name: '资料关联与引用' }).getByRole('button', { name: second.chapter.title, exact: true }).click()
  await expectChapterReady(page, second.chapter.title, '集成基线正文集成生成片段')
  const original = await body.elementHandle()
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  const prefs = page.getByRole('dialog', { name: '偏好设置' })
  await prefs.getByLabel('正文字号').selectOption('24'); await prefs.press('Escape')
  expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
  await page.getByRole('button', { name: '统一搜索', exact: true }).first().click()
  const search = page.getByRole('dialog', { name: '统一搜索' })
  await search.getByLabel('统一搜索关键词').fill('集成规划暗号')
  await search.locator('.search-results button').click()
  await expect(page.getByLabel('规划标题', { exact: true })).toHaveValue('集成剧情卡')
  const exported = await (await request.get(`/api/novels/${novel.id}/export?format=json`)).json()
  expect(exported.knowledge.references.links).toHaveLength(1)
  expect(exported.chapters.find((item: { id: string }) => item.id === second.chapter.id).content.content[0].content[0].text).toBe('集成基线正文集成生成片段')
  expect(errors).toEqual([])
})

test('integration: failed prose save blocks home, module, references and search until explicit recovery', async ({ page, request }) => {
  const { novel } = await seed(request)
  await page.goto('/')
  await page.locator('.dashboard-work').filter({ hasText: novel.title }).getByRole('button', { name: '打开作品' }).click()
  const body = await expectChapterReady(page, '集成续写章')
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { message: 'Mock 集成保存失败' } }) : route.continue())
  await body.fill('必须保留的集成草稿')
  await expect(page.locator('.save-status')).toHaveText('保存失败')
  await expect(page.getByRole('button', { name: '⌂ 创作工作台', exact: true })).toBeDisabled()
  await expect(page.getByRole('navigation', { name: '小说工作台模块' }).getByRole('button', { name: '创作资料库', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '查阅与引用创作资料' })).toBeDisabled()
  await page.getByRole('button', { name: '统一搜索', exact: true }).first().click()
  const search = page.getByRole('dialog', { name: '统一搜索' })
  await search.getByLabel('统一搜索关键词').fill(novel.title)
  await expect(search.locator('.search-results button')).toBeDisabled(); await search.press('Escape')
  await expect(body).toHaveText('必须保留的集成草稿')
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.locator('.save-status')).toHaveText('已保存')
  await page.getByRole('button', { name: '⌂ 创作工作台', exact: true }).click()
  await page.locator('.dashboard-work').filter({ hasText: novel.title }).getByRole('button', { name: '打开作品' }).click()
  await expectChapterReady(page, '集成续写章', '必须保留的集成草稿')
})

test('integration: explicit light overrides system dark, explicit dark covers dashboard under system light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/')
  await expect(page.locator('.metric').first()).toHaveCSS('background-color', 'rgb(34, 39, 47)')
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  const prefs = page.getByRole('dialog', { name: '偏好设置' })
  await prefs.getByLabel('外观主题').selectOption('light'); await prefs.press('Escape')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 248, 250)')
  await expect(page.locator('.metric').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  await prefs.getByLabel('外观主题').selectOption('dark'); await prefs.press('Escape')
  await expect(page.locator('.metric').first()).toHaveCSS('background-color', 'rgb(34, 39, 47)')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '偏好设置', exact: true }).first()).toBeVisible()
  }
})
