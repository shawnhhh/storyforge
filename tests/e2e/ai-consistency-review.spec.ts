import { expect, test, type Page, type Locator } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import type { Novel } from '../../shared/contracts/novels.js'
import type { WorldEntry } from '../../shared/contracts/story-bible.js'
import type { ReviewPreview, ReviewResult } from '../../shared/contracts/consistency-review.js'
import { newWorld } from '../../src/features/story-bible/model.js'
import { expectChapterReady } from './editor-helpers.js'

const originalText = '林舟是老师。云城允许飞行。'
const errors = new WeakMap<Page, string[]>()
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存到数据库')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'AI 章节一致性审阅' })
const confirmation = (panel: Locator) => panel.getByRole('checkbox', { name: '我已核对以上实际发送内容，同意发送至所选模型' })
async function start(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建作品', exact: true }).click()
  await page.getByRole('dialog').getByLabel('小说名称').fill('一致性虚构测试-' + name)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '创建第一章' }).click()
  const body = await expectChapterReady(page, '第 1 章')
  await body.fill(originalText); await saved(page)
  return body
}
async function open(page: Page) {
  await page.getByRole('button', { name: '一致性审阅', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: '预览发送上下文' })).toBeEnabled()
  return dialog(page)
}
async function preview(panel: Locator) {
  await panel.getByRole('button', { name: '预览发送上下文' }).click()
  await expect(panel.getByLabel('实际发送的上下文')).toBeVisible()
  await confirmation(panel).check()
}
async function worldFixture(page: Page, name: string, description = '云城禁止飞行') {
  const health = await page.request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const novels = await (await page.request.get('/api/novels')).json() as Novel[]
  const novel = novels.find(item => item.title === '一致性虚构测试-' + name)!
  const response = await page.request.post(`/api/novels/${novel.id}/world`, { headers, data: { ...newWorld(), name: '云城规则', description } })
  expect(response.ok()).toBe(true)
  return { headers, novel, world: await response.json() as WorldEntry }
}
function result(fingerprint: string, label = '可能存在规则矛盾'): ReviewResult {
  return { fingerprint, modelId: 'openai-default', usage: { inputTokens: 30, outputTokens: 20 }, finishReason: 'stop', findings: [{ category: 'world', certainty: 'conflict', explanation: label, suggestion: '核实是否存在例外规则', evidence: [{ sourceId: 'current', quote: '云城允许飞行' }], evidenceIncomplete: false }, { category: 'plot', certainty: 'suggestion', explanation: '可能需要补充动机 <script>literal</script>', suggestion: '考虑补充过渡', evidence: [], evidenceIncomplete: true }] }
}

test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message))
  await page.route('**/api/ai/models', route => route.fulfill({ json: {
    models: [{ id: 'openai-default', label: 'Mock 模型', provider: 'openai', model: 'mock-model', configured: true, maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }],
    policy: { requestsPerMinute: 20, sessionRequests: 100, sessionTokens: 200000, maxInputTokens: 64000, maxRequestUsd: 1, sessionUsd: 5 }, remaining: { requests: 100, tokens: 200000, usd: 5 },
  } }))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

test('explicit preview and confirmation precede any model call; results stay read-only and preserve undo', async ({ page }) => {
  const body = await start(page, '确认只读')
  const original = await body.elementHandle()
  let calls = 0, writes = 0, fullPreview: ReviewPreview | undefined
  page.on('request', request => { if (request.method() === 'PUT' && /\/api\/chapters\//.test(request.url())) writes++ })
  page.on('response', async response => { if (response.url().endsWith('/api/ai/review/preview') && response.ok()) fullPreview = await response.json() })
  await page.route('**/api/ai/review', route => { calls++; return route.fulfill({ json: result(route.request().postDataJSON().fingerprint) }) })
  const panel = await open(page)
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await panel.getByRole('button', { name: '预览发送上下文' }).click()
  await expect(panel.getByLabel('实际发送的上下文')).toContainText(originalText)
  await expect(panel.getByLabel('实际发送的上下文')).toContainText('审阅系统指令')
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  expect(calls).toBe(0)
  await confirmation(panel).check()
  await panel.getByRole('button', { name: '确认并开始审阅' }).click()
  await expect(panel.getByLabel('有引用依据的疑似冲突', { exact: true })).toContainText('可能存在规则矛盾')
  await expect(panel.getByLabel('不确定建议', { exact: true })).toContainText('待核实的可能问题')
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('<script>literal</script>')
  expect(fullPreview?.sources).toHaveLength(1)
  expect(fullPreview?.sources[0].text).toBe(originalText)
  expect(calls).toBe(1); expect(writes).toBe(0)
  await expect(panel.getByRole('button', { name: /接受|替换|插入/ })).toHaveCount(0)
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(body).toHaveText(originalText)
  expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
  await expect(body).toBeFocused()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(body).toHaveText('')
  await saved(page)
})

test('only selected own-work references are previewed, truncation is visible and changing parameters invalidates consent', async ({ page }) => {
  await start(page, '引用截断')
  await worldFixture(page, '引用截断', '云城禁止飞行。'.repeat(600))
  const panel = await open(page)
  await panel.locator('summary').filter({ hasText: '按需引用' }).click()
  await panel.getByLabel('引用总长度', { exact: true }).selectOption('1000')
  await panel.getByLabel('世界观：云城规则', { exact: true }).check()
  await expect(panel.getByLabel('引用内容预览')).toContainText('已截断')
  await preview(panel)
  await expect(panel.getByLabel('实际发送的上下文')).toContainText('云城禁止飞行')
  await expect(panel.getByLabel('实际发送的上下文')).toContainText('已截断')
  await panel.locator('summary').filter({ hasText: '模型配置中心' }).click()
  await panel.getByLabel('创意程度', { exact: true }).fill('0.4')
  await expect(panel.getByLabel('实际发送的上下文')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await panel.getByLabel('创意程度', { exact: true }).fill('0.2')
  await expect(panel.getByLabel('实际发送的上下文')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await panel.getByRole('button', { name: '预览发送上下文' }).click()
  await expect(confirmation(panel)).not.toBeChecked()
  await page.keyboard.press('Escape')
})

test('changed references require a fresh preview and deleted references cannot be sent', async ({ page }) => {
  const body = await start(page, '失效引用')
  const { headers, novel, world } = await worldFixture(page, '失效引用')
  const panel = await open(page)
  await panel.locator('summary').filter({ hasText: '按需引用' }).click()
  await panel.getByLabel('世界观：云城规则', { exact: true }).check()
  await expect(panel.getByLabel('引用内容预览')).toBeVisible()
  await preview(panel)
  await page.route('**/api/ai/review', route => route.fulfill({ json: result(route.request().postDataJSON().fingerprint, '基于旧引用的结果') }))
  await panel.getByRole('button', { name: '确认并开始审阅' }).click()
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('基于旧引用的结果')
  await page.unroute('**/api/ai/review')
  const changed = await page.request.put(`/api/novels/${novel.id}/world/${world.id}`, { headers, data: { ...world, description: '规则更新：允许飞行' } })
  expect(changed.ok()).toBe(true)
  const updated = await changed.json() as WorldEntry
  // The real isolated backend rejects stale confirmation before checking its absent key.
  await panel.getByRole('button', { name: '确认并重新审阅' }).click()
  await expect(panel.getByRole('alert')).toContainText('重新预览并确认')
  await expect(panel.getByLabel('一致性审阅结果')).toHaveCount(0)
  await expect(panel.getByLabel('实际发送的上下文')).toHaveCount(0)
  await preview(panel)
  await expect(panel.getByLabel('实际发送的上下文')).toContainText('规则更新')
  expect((await page.request.delete(`/api/novels/${novel.id}/world/${world.id}`, { headers, data: { version: updated.version } })).ok()).toBe(true)
  await panel.getByRole('button', { name: '确认并开始审阅' }).click()
  await expect(panel.getByRole('alert')).toContainText('引用世界观不存在')
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(body).toHaveText(originalText)
})

test('cancellation, late responses, quota failure and changed settings preserve and label earlier results', async ({ page }) => {
  const body = await start(page, '取消旧结果')
  let calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ai/review', async route => {
    calls++
    const fingerprint = route.request().postDataJSON().fingerprint
    if (calls === 1) return route.fulfill({ json: result(fingerprint, '保留的上一份结果') })
    if (calls === 2) { await gate; await route.fulfill({ json: result(fingerprint, '取消的迟到结果') }).catch(() => {}); return }
    return route.fulfill({ status: 429, json: { message: '本机 AI 会话预算已用完' } })
  })
  const panel = await open(page); await preview(panel)
  await panel.getByRole('button', { name: '确认并开始审阅' }).click()
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('保留的上一份结果')
  await panel.getByRole('button', { name: '确认并重新审阅' }).click()
  await expect.poll(() => calls).toBe(2)
  await panel.getByRole('button', { name: '取消请求' }).click(); release()
  await expect(panel.getByRole('alert')).toContainText('请求已取消')
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('保留的上一份结果')
  await expect(panel.getByLabel('一致性审阅结果')).not.toContainText('取消的迟到结果')
  await panel.getByRole('button', { name: '确认并重新审阅' }).click()
  await expect(panel.getByRole('alert')).toContainText('会话预算已用完')
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('保留的上一份结果')
  await panel.locator('summary').filter({ hasText: '模型配置中心' }).click()
  await panel.getByLabel('最大输出 tokens', { exact: true }).fill('512')
  await expect(panel.getByLabel('一致性审阅结果')).toContainText('这份旧结果')
  await expect(panel.getByRole('button', { name: '确认并重新审阅' })).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(body).toHaveText(originalText)
})

test('switching chapters aborts review and reopening never shows another chapter result', async ({ page }) => {
  const body = await start(page, '切章隔离')
  await page.getByRole('button', { name: '添加章节' }).click(); await expectChapterReady(page, '第 2 章')
  await page.getByRole('button', { name: '上一章', exact: true }).click(); await expectChapterReady(page, '第 1 章', originalText)
  let release!: () => void, arrived!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), arrival = new Promise<void>(resolve => { arrived = resolve })
  await page.route('**/api/ai/review', async route => { arrived(); await gate; await route.fulfill({ json: result(route.request().postDataJSON().fingerprint, '第一章迟到结果') }).catch(() => {}) })
  const panel = await open(page); await preview(panel)
  await panel.getByRole('button', { name: '确认并开始审阅' }).click(); await arrival
  await page.getByRole('button', { name: '下一章', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
  await expectChapterReady(page, '第 2 章', ''); release()
  await expect(panel).not.toBeVisible()
  await page.getByRole('button', { name: '一致性审阅', exact: true }).click()
  await expect(panel).toContainText('当前章节为空')
  await expect(panel.getByLabel('一致性审阅结果')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(body).toHaveText('')
  await page.getByRole('button', { name: '上一章', exact: true }).click(); await expectChapterReady(page, '第 1 章', originalText)
})

test('document edits abort an active review and invalidate its snapshot', async ({ page }) => {
  const body = await start(page, '正文变化')
  let release!: () => void, arrived!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), arrival = new Promise<void>(resolve => { arrived = resolve })
  await page.route('**/api/ai/review', async route => { arrived(); await gate; await route.fulfill({ json: result(route.request().postDataJSON().fingerprint) }).catch(() => {}) })
  const panel = await open(page); await preview(panel)
  await panel.getByRole('button', { name: '确认并开始审阅' }).click(); await arrival
  await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.view.dispatch(editor.state.tr.insertText('新内容', 1))
  })
  await expect(panel).toContainText('正文已变化，已停止请求')
  release()
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await expect(panel.getByLabel('一致性审阅结果')).toHaveCount(0)
  await page.keyboard.press('Escape'); await expect(body).toHaveText('新内容' + originalText); await saved(page)
})

test('missing key still permits preview and normal writing, while oversized chapters are never silently clipped', async ({ page }) => {
  const body = await start(page, '无密钥上限')
  await page.unroute('**/api/ai/models')
  const panel = await open(page)
  await expect(panel).toContainText('未配置 AI API Key')
  await preview(panel)
  await expect(panel.getByRole('button', { name: '确认并开始审阅' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await body.fill('字'.repeat(40001)); await saved(page)
  await page.getByRole('button', { name: '一致性审阅', exact: true }).click()
  await expect(panel).toContainText('不会自动截断正文')
  await expect(panel.getByRole('button', { name: '预览发送上下文' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await body.fill('没有 AI 仍可正常写作'); await saved(page)
})

for (const width of [1440, 390]) test(`review is readable in dark mode and preserves node, selection and scroll at width ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const body = await start(page, '深色选区-' + width)
  await body.fill('虚构长文。'.repeat(300)); await body.press('ControlOrMeta+End'); await body.press('Shift+ArrowLeft'); await saved(page)
  const original = await body.elementHandle()
  const scroll = await page.locator('.document').evaluate(element => element.scrollTop)
  const selection = await page.evaluate(() => window.getSelection()?.toString())
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  const panel = await open(page); await preview(panel)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await panel.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(32, 32, 36)')
  expect(await page.locator('.document').evaluate(element => element.scrollTop)).toBe(scroll)
  await page.keyboard.press('Escape'); await expect(body).toBeFocused()
  expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
  expect(await page.locator('.document').evaluate(element => element.scrollTop)).toBe(scroll)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection)
})
