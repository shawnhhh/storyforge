import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { chapterBody, expectChapterReady } from './editor-helpers.js'
import type { AiInput } from '../../shared/contracts/ai.js'
import type { Novel, ChapterResult } from '../../shared/contracts/novels.js'
import { newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'

const result = (text = 'Mock 生成文字') => ({ text, usage: { inputTokens: 48, outputTokens: 9 }, finishReason: 'stop' })
const browserErrors = new WeakMap<Page, string[]>()
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存')
async function start(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '创建小说', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('小说名称').fill('AI 虚构测试-' + name)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '创建第一章' }).click()
  const body = await expectChapterReady(page, '第 1 章')
  await body.fill('前文目标后文')
  await saved(page)
  return body
}
async function selectTarget(page: Page) {
  await chapterBody(page).evaluate(element => {
    const text = element.querySelector('p')!.firstChild!
    const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 4)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    ;(element as HTMLElement).focus()
  })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('目标')
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/ai/status', route => route.fulfill({ json: { configured: true, model: 'mock-model', message: 'AI 已就绪' } }))
  await page.route('**/api/ai/models', route => route.fulfill({ json: {
    models: [{ id: 'openai-default', label: 'Mock OpenAI', model: 'mock-model', provider: 'openai', configured: true, maxOutputTokens: 4096, inputUsdPerMillion: null, outputUsdPerMillion: null }, { id: 'deepseek-mock', label: 'Mock DeepSeek', model: 'deepseek-mock', provider: 'deepseek', configured: true, maxOutputTokens: 1024, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }],
    policy: { requestsPerMinute: 20, sessionRequests: 100, sessionTokens: 200000, maxInputTokens: 64000, maxRequestUsd: 1, sessionUsd: 5 }, remaining: { requests: 100, tokens: 200000, usd: 5 },
  } }))
})
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]) })
for (const [action, label] of [['polish', '润色'], ['expand', '扩写'], ['rewrite', '改写']] as const) {
  test(`${label} previews selected text, regenerates without writes, then accepts through autosave and undo`, async ({ page }) => {
    const body = await start(page, label)
    let generations = 0, writes = 0
    const inputs: AiInput[] = []
    page.on('request', request => { if (request.method() === 'PUT' && /\/api\/chapters\//.test(request.url())) writes++ })
    await page.route('**/api/ai/generate', route => { inputs.push(route.request().postDataJSON()); generations++; return route.fulfill({ json: result(generations === 1 ? '初稿' : '<img src=x onerror=alert(1)>定稿') }) })
    await selectTarget(page)
    const original = await body.elementHandle()
    await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'AI 辅助写作' })
    await dialog.getByLabel('写作操作').selectOption(action)
    await dialog.getByLabel('写作要求').fill('放慢节奏，保持人物口吻')
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
    await expect(dialog.getByLabel('AI 结果预览')).toContainText('初稿')
    await expect(body).toHaveText('前文目标后文')
    expect(writes).toBe(0)
    expect(inputs[0]).toMatchObject({ action, selection: '目标', before: '前文', after: '后文', includeStoryContext: false })
    await dialog.getByRole('button', { name: '重新生成' }).click()
    await expect(dialog.getByLabel('AI 结果预览')).toContainText('定稿')
    expect(writes).toBe(0)
    await dialog.getByRole('button', { name: '接受并替换选文' }).click()
    await expect(body).toHaveText('前文<img src=x onerror=alert(1)>定稿后文')
    await expect(body.locator('img')).toHaveCount(0)
    expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
    await saved(page)
    expect(writes).toBe(1)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(body).toHaveText('前文目标后文')
    await saved(page)
  })
}
test('continuation inserts after selection; inspiration includes opt-in context and never offers replacement', async ({ page }) => {
  const body = await start(page, '续写灵感')
  const inputs: AiInput[] = []
  await page.route('**/api/ai/generate', route => { inputs.push(route.request().postDataJSON()); return route.fulfill({ json: result('新增正文') }) })
  await selectTarget(page)
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(body).toHaveText('前文目标后文')
  await dialog.getByRole('button', { name: '接受并插入' }).click()
  await expect(body).toHaveText('前文目标新增正文后文')
  await saved(page)
  await page.reload()
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: 'AI 虚构测试-续写灵感' }).click()
  await expectChapterReady(page, '第 1 章', '前文目标新增正文后文')
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  await dialog.getByLabel('写作操作').selectOption('inspire')
  await dialog.getByLabel('附带本小说已保存的人物、世界观与大纲摘要', { exact: false }).check()
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByLabel('AI 结果预览')).toContainText('新增正文')
  expect(inputs[1]).toMatchObject({ action: 'inspire', includeStoryContext: true })
  await expect(dialog.getByRole('button', { name: /接受并/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: '放弃', exact: true }).click()
  await expect(body).toHaveText('前文目标新增正文后文')
})
test('missing key and missing selection explain the issue while normal writing still saves', async ({ page }) => {
  const body = await start(page, '未配置')
  await page.unroute('**/api/ai/status') // Real backend explicitly runs without a key.
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('未配置 AI API Key')
  await expect(dialog.getByRole('button', { name: '生成预览' })).toBeDisabled()
  await dialog.getByLabel('写作操作').selectOption('polish')
  await expect(dialog).toContainText('先选择需要处理的正文')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await body.fill('没有 AI 仍可正常写作')
  await saved(page)
})
test('errors, cancellation and closing before a late result preserve original content', async ({ page }) => {
  const body = await start(page, '错误取消')
  let count = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ai/generate', async route => {
    count++
    if (count === 1) { await route.fulfill({ status: 504, json: { message: 'AI 请求超时，请重试' } }); return }
    await gate
    await route.fulfill({ json: result('过期结果') }).catch(() => {})
  })
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await expect(dialog.getByRole('alert')).toContainText('AI 请求超时')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await expect.poll(() => count).toBe(2)
  await dialog.getByRole('button', { name: '取消请求' }).click()
  await expect(dialog.getByRole('alert')).toContainText('请求已取消')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await expect.poll(() => count).toBe(3)
  await page.keyboard.press('Escape')
  release()
  await expect(body).toHaveText('前文目标后文')
  await expect(page.locator('.save-status')).toHaveText('已保存')
  await expect(dialog).not.toBeVisible()
})
test('stale preview cannot overwrite edits made since the snapshot', async ({ page }) => {
  const body = await start(page, '过期保护')
  await page.route('**/api/ai/generate', route => route.fulfill({ json: result() }))
  await selectTarget(page)
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await expect(dialog.getByLabel('AI 结果预览')).toBeVisible()
  await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.view.dispatch(editor.state.tr.insertText('变化', 1))
  })
  await expect(dialog).toContainText('正文已变化')
  await expect(dialog.getByRole('button', { name: '接受并插入' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(body).toHaveText('变化前文目标后文')
  await saved(page)
})
for (const width of [1440, 700]) {
  test(`preview and discard retain the editor node, selection, scroll and focus at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const body = await start(page, '选区滚动-' + width)
    await page.route('**/api/ai/generate', route => route.fulfill({ json: result() }))
    await body.fill('虚构长篇正文 hello。'.repeat(1000))
    await body.press('ControlOrMeta+End')
    await body.press('Shift+ArrowLeft')
    await saved(page)
    const original = await body.elementHandle()
    const scroll = await page.locator('.document').evaluate(el => el.scrollTop)
    const selection = await page.evaluate(() => window.getSelection()?.toString())
    await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '生成预览' }).click()
    await expect(dialog.getByLabel('AI 结果预览')).toBeVisible()
    expect(await page.locator('.document').evaluate(el => el.scrollTop)).toBe(scroll)
    await dialog.getByRole('button', { name: '放弃', exact: true }).click()
    await expect(body).toBeFocused()
    expect(await page.locator('.document').evaluate(el => el.scrollTop)).toBe(scroll)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection)
    expect(await body.evaluate((el, previous) => el === previous, original)).toBe(true)
    // Accept without remounting; completion of autosave must not move the viewport.
    await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
    await dialog.getByRole('button', { name: '生成预览' }).click()
    await expect(dialog.getByLabel('AI 结果预览')).toBeVisible()
    await dialog.getByRole('button', { name: '接受并插入' }).click()
    const acceptedScroll = await page.locator('.document').evaluate(el => el.scrollTop)
    expect(acceptedScroll).toBe(scroll)
    await saved(page)
    expect(await page.locator('.document').evaluate(el => el.scrollTop)).toBe(acceptedScroll)
    expect(await body.evaluate((el, previous) => el === previous, original)).toBe(true)
    await page.getByRole('button', { name: '撤销本次 AI 修改' }).click()
    await expect(body).toBeFocused()
    expect(await page.locator('.document').evaluate(el => el.scrollTop)).toBe(scroll)
    await saved(page)
    expect(await page.locator('.document').evaluate(el => el.scrollTop)).toBe(scroll)
    expect(await body.evaluate((el, previous) => el === previous, original)).toBe(true)
  })
}

test('continuation at a bare caret and oversized selection use explicit insertion and bounds', async ({ page }) => {
  const body = await start(page, '光标与上限')
  let calls = 0
  await page.route('**/api/ai/generate', route => { calls++; return route.fulfill({ json: result('插入') }) })
  await body.press('ControlOrMeta+Home')
  await body.press('ArrowRight')
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '生成预览' }).click()
  await dialog.getByRole('button', { name: '接受并插入' }).click()
  await expect(body).toHaveText('前插入文目标后文')
  await saved(page)
  await body.fill('字'.repeat(6001))
  await body.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  await expect(dialog).toContainText('选文超过 6000 字符')
  await expect(dialog.getByRole('button', { name: '生成预览' })).toBeDisabled()
  expect(calls).toBe(1)
  await page.keyboard.press('Escape')
  await expect(body).toHaveText('字'.repeat(6001))
  await saved(page)
})

test('switching chapter disposes a pending request so its result cannot enter another chapter', async ({ page }) => {
  const body = await start(page, '切章隔离')
  await page.getByRole('button', { name: '添加章节' }).click()
  await expectChapterReady(page, '第 2 章')
  await page.getByRole('button', { name: '上一章', exact: true }).click()
  await expectChapterReady(page, '第 1 章', '前文目标后文')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ai/generate', async route => { await gate; await route.fulfill({ json: result('不能跨章写入') }).catch(() => {}) })
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成预览' }).click()
  // Programmatic navigation exercises unmount cleanup while the modal is open.
  await page.getByRole('button', { name: '下一章', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
  await expectChapterReady(page, '第 2 章', '')
  release()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(body).toHaveText('')
  await page.getByRole('button', { name: '上一章', exact: true }).click()
  await expectChapterReady(page, '第 1 章', '前文目标后文')
})

test('references use real isolated context APIs, show truncation, and transmit only confirmed IDs', async ({ page }) => {
  const body = await start(page, '逐项引用')
  const health = await page.request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const novels = await (await page.request.get('/api/novels')).json() as Novel[]
  const novel = novels.find(item => item.title === 'AI 虚构测试-逐项引用')!
  const world = await (await page.request.post(`/api/novels/${novel.id}/world`, { headers, data: { ...newWorld(), name: '引用云城', description: '此设定只在勾选后发送。'.repeat(700) } })).json() as { id: string }
  const plan = { ...emptyPlanning(), outlines: [{ id: 'outline', kind: 'overall', title: '引用总纲', content: '寻找旧信', parentId: null, chapterIds: [] }] }
  expect((await page.request.put(`/api/novels/${novel.id}/planning`, { headers, data: { ...plan, version: 0 } })).ok()).toBe(true)
  const current = await (await page.request.get(`/api/novels/${novel.id}`)).json() as { novel: Novel }
  const created = await (await page.request.post(`/api/novels/${novel.id}/chapters`, { headers, data: { version: current.novel.version, title: '引用前章' } })).json() as ChapterResult
  expect((await page.request.put(`/api/chapters/${created.chapter.id}`, { headers, data: { version: created.chapter.version, title: created.chapter.title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '之前发生的虚构情节。'.repeat(600) }] }] } } })).ok()).toBe(true)
  let sent: AiInput | undefined
  await page.route('**/api/ai/generate', route => { sent = route.request().postDataJSON(); return route.fulfill({ json: result('仅预览的引用建议') }) })
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('summary').filter({ hasText: '按需引用' }).click()
  await dialog.getByLabel('引用总长度', { exact: true }).selectOption('1000')
  await dialog.getByLabel('世界观：引用云城', { exact: true }).check()
  await dialog.getByLabel('大纲：引用总纲', { exact: true }).check()
  await dialog.getByLabel('已有章节：引用前章', { exact: true }).check()
  await expect(dialog.getByLabel('引用内容预览')).toContainText('已截断')
  await expect(dialog.getByLabel('引用内容预览')).toContainText('寻找旧信')
  await expect(dialog.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled()
  await dialog.getByLabel('附近正文总长度').selectOption('0')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByLabel('AI 结果预览')).toContainText('仅预览的引用建议')
  expect(sent).toMatchObject({ before: '', after: '', includeStoryContext: false, context: { maxCharacters: 1000, references: [{ kind: 'world', id: world.id }, { kind: 'outline', id: 'outline' }, { kind: 'chapter', id: created.chapter.id }] } })
  expect(sent!.context!.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(sent)).not.toContain('此设定只在勾选后发送')
  await dialog.getByRole('button', { name: '放弃', exact: true }).click()
  await expect(body).toHaveText('前文目标后文')
})

test('model parameters, diff view and immediate AI undo preserve the prior draft', async ({ page }) => {
  const body = await start(page, '模型对比撤销')
  let sent: AiInput | undefined, writes = 0
  page.on('request', request => { if (request.method() === 'PUT' && /\/api\/chapters\//.test(request.url())) writes++ })
  await page.route('**/api/ai/generate', route => { sent = route.request().postDataJSON(); return route.fulfill({ json: { ...result('目标变得清晰'), modelId: 'deepseek-mock' } }) })
  await selectTarget(page)
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('summary').filter({ hasText: '模型配置中心' }).click()
  await dialog.getByLabel('模型选择').selectOption('deepseek-mock')
  await dialog.getByLabel('创意程度', { exact: true }).fill('0.3')
  await dialog.getByLabel('采样范围', { exact: true }).fill('0.8')
  await dialog.getByLabel('最大输出 tokens', { exact: true }).fill('512')
  await dialog.getByLabel('写作操作').selectOption('polish')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByLabel('原文与生成稿对比')).toContainText('目标变得清晰')
  expect(sent).toMatchObject({ modelId: 'deepseek-mock', parameters: { temperature: 0.3, topP: 0.8, maxOutputTokens: 512 } })
  expect(writes).toBe(0)
  await dialog.getByRole('button', { name: '变更概览' }).click()
  await expect(dialog.locator('ins')).toHaveText('变得清晰')
  await expect(body).toHaveText('前文目标后文')
  await dialog.getByRole('button', { name: '接受并替换选文' }).click()
  await expect(body).toHaveText('前文目标变得清晰后文')
  await page.getByRole('button', { name: '撤销本次 AI 修改' }).click()
  await expect(body).toHaveText('前文目标后文')
  await saved(page)
  await expect(page.getByRole('button', { name: '撤销本次 AI 修改' })).toHaveCount(0)
})

test('cancelling regeneration and a quota error both retain the last successful preview', async ({ page }) => {
  const body = await start(page, '重新生成保护')
  let count = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ai/generate', async route => {
    count++
    if (count === 1) return route.fulfill({ json: result('可保留的上一稿') })
    if (count === 2) { await gate; await route.fulfill({ json: result('取消后不得覆盖') }).catch(() => {}); return }
    return route.fulfill({ status: 429, json: { message: '本机 AI 会话预算已用完' } })
  })
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(dialog.getByLabel('AI 结果预览')).toContainText('可保留的上一稿')
  await dialog.getByRole('button', { name: '重新生成' }).click()
  await expect.poll(() => count).toBe(2)
  await expect(dialog.getByRole('button', { name: '接受并插入' })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消请求' }).click()
  release()
  await expect(dialog.getByLabel('AI 结果预览')).toContainText('可保留的上一稿')
  await dialog.getByRole('button', { name: '重新生成' }).click()
  await expect(dialog.getByRole('alert')).toContainText('会话预算已用完')
  await expect(dialog.getByLabel('AI 结果预览')).toContainText('可保留的上一稿')
  await expect(body).toHaveText('前文目标后文')
  await dialog.getByRole('button', { name: '接受并插入' }).click()
  await expect(body).toContainText('可保留的上一稿')
  await saved(page)
})
