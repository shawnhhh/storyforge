import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import type { Novel, ChapterResult } from '../../shared/contracts/novels.js'
import { expectChapterReady } from './editor-helpers.js'

// Only the runner's dedicated temporary database is used. Faults are route mocks.
async function seed(request: APIRequestContext) {
  const health = await request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const create = async (path: string, data: unknown) => {
    const response = await request.post(`/api${path}`, { data, headers }); expect(response.ok()).toBeTruthy(); return response.json()
  }
  const suffix = crypto.randomUUID().slice(0, 8)
  const a = await create('/novels', { title: `统一检索甲书-${suffix}`, description: '共同暗号 小说简介' }) as Novel
  const b = await create('/novels', { title: `统一检索乙书-${suffix}`, description: '共同暗号 小说简介' }) as Novel
  const chapter = await create(`/novels/${b.id}/chapters`, { title: '目标章节', version: b.version }) as ChapterResult
  const response = await request.put(`/api/chapters/${chapter.chapter.id}`, { headers, data: { version: 1, title: '目标章节', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '共同暗号 正文 <script>alert(1)</script> 🌕' }] }] } } })
  expect(response.ok()).toBeTruthy()
  await create(`/novels/${b.id}/characters`, { ...newCharacter(), name: '第一人物' })
  await create(`/novels/${b.id}/characters`, { ...newCharacter(), name: '目标人物', fields: { ...newCharacter().fields, background: '共同暗号 人物经历' } })
  await create(`/novels/${b.id}/world`, { ...newWorld(), name: '第一设定' })
  await create(`/novels/${b.id}/world`, { ...newWorld(), name: '目标设定', description: '共同暗号 世界内容' })
  const data = emptyPlanning()
  data.cards.push({ id: 'target-card', title: '目标剧情卡', content: '共同暗号 规划内容', summary: '摘要', status: 'idea', plotlineId: null, storyTime: '', timeOrder: null, chapterIds: [] })
  expect((await request.put(`/api/novels/${b.id}/planning`, { headers, data: { ...data, version: 0 } })).ok()).toBeTruthy()
  return { a, b }
}
async function search(page: Page, query: string, kind = '') {
  await page.getByRole('button', { name: '统一搜索', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '统一搜索' })
  // Set filters before starting the debounced request; selecting an unchanged
  // filter after a fast mocked failure can clear its error without a new query.
  await dialog.getByLabel('搜索类型').selectOption(kind)
  await dialog.getByLabel('统一搜索关键词').fill(query)
  return dialog
}

test('unified search filters across novels and navigates to exact chapter/profile/planning records', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { a, b } = await seed(request)
  await page.goto('/')
  const dialog = await search(page, '共同暗号')
  await dialog.getByLabel('搜索小说范围').selectOption(a.id)
  await expect(dialog.locator('.search-results li')).toHaveCount(1)
  await dialog.getByLabel('搜索小说范围').selectOption(b.id)
  await expect(dialog.locator('.search-results li')).toHaveCount(5)
  await expect(dialog.locator('mark').first()).toHaveText('共同暗号')
  await dialog.getByLabel('搜索类型').selectOption('chapter')
  await expect(dialog.locator('.search-results li')).toHaveCount(1)
  await dialog.locator('.search-results button').click()
  await expectChapterReady(page, '目标章节', '共同暗号 正文 <script>alert(1)</script> 🌕')
  const original = await page.getByRole('textbox', { name: '小说正文' }).elementHandle()
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  const prefs = page.getByRole('dialog', { name: '偏好设置' })
  await prefs.getByLabel('正文字体').selectOption('serif')
  await prefs.getByLabel('正文字号').selectOption('24')
  await prefs.getByLabel('编辑器布局').selectOption('wide')
  await prefs.getByLabel('显示快捷键提示').uncheck()
  await prefs.getByRole('button', { name: '关闭偏好设置' }).click()
  expect(await page.getByRole('textbox', { name: '小说正文' }).evaluate((element, before) => element === before, original)).toBe(true)
  await expect(page.locator('.tiptap')).toHaveCSS('font-size', '24px')
  await expect(page.locator('.shortcut-help')).toBeHidden()
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await expect(prefs).toBeVisible()
  await prefs.press('Escape')
  await page.getByRole('button', { name: '退出专注', exact: true }).click()
  for (const [kind, label, target] of [['character', '姓名', '目标人物'], ['world', '设定名称', '目标设定'], ['cards', '规划标题', '目标剧情卡']]) {
    const current = await search(page, '共同暗号', kind)
    await current.getByLabel('搜索小说范围').selectOption(b.id)
    await expect(current.locator('.search-results li')).toHaveCount(1)
    await current.locator('.search-results button').click()
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(target)
  }
  expect(errors).toEqual([])
})

test('search handles empty results, mocked failure, stale responses and deleted targets', async ({ page }) => {
  await page.goto('/')
  let fail = true
  await page.route('**/api/search?**', async route => {
    if (fail) await route.fulfill({ status: 503, json: { message: 'Mock 搜索服务暂时不可用' } })
    else await route.fulfill({ json: { hits: [], hasMore: false } })
  })
  const dialog = await search(page, '不存在')
  await expect(dialog.getByRole('alert')).toContainText('Mock 搜索服务暂时不可用')
  fail = false; await dialog.getByRole('button', { name: '重试搜索' }).click()
  await expect(dialog.getByRole('status')).toHaveText('没有匹配的结果')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === '旧查询') await gate
    await route.fulfill({ json: { hits: [{ id: 'gone', novelId: 'gone', kind: 'novel', novelTitle: '已删除', title: '已删除', excerpt: '' }], hasMore: false } })
  })
  await dialog.getByLabel('统一搜索关键词').fill('旧查询')
  await page.waitForRequest(request => request.url().includes('q=%E6%97%A7'))
  await dialog.getByLabel('统一搜索关键词').fill('')
  release()
  await expect(dialog.getByRole('status')).toHaveText('输入关键词开始搜索')
  await expect(dialog.locator('.search-results li')).toHaveCount(0)
  await dialog.getByLabel('统一搜索关键词').fill('已删除')
  await dialog.locator('.search-results button').click()
  await expect(dialog.getByRole('alert')).toContainText('不存在')
  await expect(dialog).toBeVisible()
})

test('preferences follow system, persist, sync tabs, hide hints and recover from storage failure', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const opener = page.getByRole('button', { name: '偏好设置', exact: true }).first()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '偏好设置' })
  await dialog.getByLabel('外观主题').selectOption('light')
  await dialog.getByLabel('正文字体').selectOption('mono')
  await dialog.getByLabel('正文字号').selectOption('22')
  await dialog.getByLabel('编辑器布局').selectOption('compact')
  await dialog.getByLabel('显示快捷键提示').uncheck()
  await dialog.press('Escape'); await expect(opener).toBeFocused()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('.workspace')).toHaveAttribute('data-font', 'mono')
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'compact')
  await expect(page.locator('.workspace')).toHaveAttribute('data-shortcut-hints', 'false')
  const second = await context.newPage(); await second.goto('/')
  await opener.click(); await dialog.getByLabel('外观主题').selectOption('dark')
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Wait for the existing button background transition before the visual artifact.
  await expect(dialog.getByRole('button', { name: '关闭偏好设置' })).toHaveCSS('background-color', 'rgb(44, 44, 48)')
  await page.screenshot({ path: test.info().outputPath('preferences-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await dialog.getByRole('button', { name: '恢复默认偏好' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Mock quota exceeded', 'QuotaExceededError') } })
  await dialog.getByLabel('正文字号').selectOption('26')
  await expect(dialog.getByRole('alert')).toContainText('仅在当前页面生效')
  await expect(page.locator('.preference-preview')).toHaveCSS('font-size', '26px')
})

test('search never discards an unsaved chapter when saves fail', async ({ page, request }) => {
  const { b } = await seed(request)
  await page.goto('/')
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: b.title }).click()
  const body = await expectChapterReady(page, '目标章节')
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { message: 'Mock 保存失败' } }) : route.continue())
  await body.fill('应当保留的未保存草稿')
  const dialog = await search(page, '共同暗号', 'novel')
  await expect(dialog.locator('.search-results button').first()).toBeDisabled()
  await dialog.press('Escape')
  await expect(body).toHaveText('应当保留的未保存草稿')
  await expect(page.locator('.save-status')).toContainText('保存失败')
})
