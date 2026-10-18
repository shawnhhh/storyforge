import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import type { ChapterResult, Novel } from '../../shared/contracts/novels.js'
import type { AiCatalog, AiResult, AiStatus } from '../../shared/contracts/ai.js'
import { chapterBody, expectChapterReady } from './editor-helpers.js'

const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存到数据库')
const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => expect(browserErrors.get(page)).toEqual([]))

async function start(page: Page) {
  // Every request reaches only run.ts's disposable server/database, never .env.
  const health = await page.request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  const title = `专注模式虚构数据-${crypto.randomUUID()}`
  const novelResponse = await page.request.post('/api/novels', { headers, data: { title, description: '浏览器测试专用' } })
  expect(novelResponse.ok()).toBe(true)
  let novel = await novelResponse.json() as Novel
  for (const chapterTitle of ['专注第一章', '专注第二章']) {
    const response = await page.request.post(`/api/novels/${novel.id}/chapters`, { headers, data: { title: chapterTitle, version: novel.version } })
    expect(response.ok()).toBe(true)
    novel = (await response.json() as ChapterResult).novel
  }
  await page.goto('/')
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: title }).click()
  const body = await expectChapterReady(page, '专注第一章')
  await body.fill('风起云涌 Hello 2026')
  await saved(page)
  return { title, body }
}

async function setGoal(page: Page, goal: string) {
  await page.getByLabel('当前章节写作进度', { exact: true }).click()
  await page.getByLabel('本章目标字数', { exact: true }).fill(goal)
  await page.getByRole('button', { name: '设置目标', exact: true }).click()
}

test('enter, reveal tools and exit preserve editor, selection, saved content and preferred layout', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge:preferences:v1', JSON.stringify({ theme: 'light', font: 'serif', fontSize: 20, layout: 'wide', shortcutHints: true })))
  const { body } = await start(page)
  const original = await body.elementHandle()
  await body.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.setTextSelection({ from: 2, to: 4 }))
  const layout = () => page.evaluate(() => ['.library-pane', '.chapter-pane', '.document'].map(selector => document.querySelector(selector)!.getBoundingClientRect().width))
  const widths = await layout()
  await page.screenshot({ path: test.info().outputPath('normal-light.png') })
  let writes = 0
  page.on('request', request => { if (request.method() === 'PUT' && /\/api\/chapters\//.test(request.url())) writes++ })
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
  await expect(page.locator('.library-pane')).toBeHidden()
  await expect(page.locator('.chapter-pane')).toBeHidden()
  await expect(page.getByRole('navigation', { name: '小说工作台模块' })).toBeHidden()
  await expect(page.getByRole('navigation', { name: '章节导航' })).toBeHidden()
  await expect(page.getByRole('group', { name: '正文格式' })).toBeHidden()
  await expect(page.getByRole('button', { name: '查阅与引用创作资料' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'AI 辅助', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即保存', exact: true })).toBeVisible()
  await expect(page.locator('.tiptap')).toHaveCSS('font-size', '20px')
  await expect(page.locator('.tiptap')).toHaveCSS('line-height', '40px')
  expect(await page.locator('.document').evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(850)
  await expect(body).toBeFocused()
  expect(await body.evaluate(element => { const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection; return [from, to] })).toEqual([2, 4])
  await page.screenshot({ path: test.info().outputPath('focus-light.png') })
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '章节导航' })).toBeVisible()
  await expect(page.getByRole('group', { name: '正文格式' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查阅与引用创作资料' })).toBeVisible()
  await page.getByRole('button', { name: '退出专注', exact: true }).click()
  await expect(page.locator('.workspace')).not.toHaveClass(/focused|focus-tools-visible/)
  await expect(page.locator('.library-pane')).toBeVisible()
  await expect(page.locator('.chapter-pane')).toBeVisible()
  await expect(page.getByRole('group', { name: '正文格式' })).toBeVisible()
  expect(await layout()).toEqual(widths)
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
  expect(await body.evaluate(element => { const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection; return [from, to] })).toEqual([2, 4])
  await expect(body).toHaveText('风起云涌 Hello 2026')
  expect(writes).toBe(0)
})

test('chapter target tracks live counts, caps progress and persists independently for each chapter', async ({ page }) => {
  const { title, body } = await start(page)
  await setGoal(page, '10')
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toHaveText('本章 6 / 10 字 · 60%')
  await page.getByLabel('当前章节写作进度', { exact: true }).click()
  await body.fill('字'.repeat(12))
  await expect(page.getByLabel('字数统计', { exact: true })).toHaveText('12 字')
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toHaveText('本章 12 / 10 字 · 100%')
  await expect(page.getByRole('progressbar', { name: '本章目标完成度' })).toHaveAttribute('value', '10')
  await saved(page)
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await body.press('ControlOrMeta+Alt+Shift+ArrowDown')
  await expectChapterReady(page, '专注第二章', '')
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toHaveText('本章 0 / 2000 字 · 0%')
  await setGoal(page, '20')
  await page.getByLabel('当前章节写作进度', { exact: true }).click()
  await chapterBody(page).press('ControlOrMeta+Alt+Shift+ArrowUp')
  await expectChapterReady(page, '专注第一章', '字'.repeat(12))
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toHaveText('本章 12 / 10 字 · 100%')
  await page.reload()
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: title }).click()
  await expectChapterReady(page, '专注第一章', '字'.repeat(12))
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toHaveText('本章 12 / 10 字 · 100%')
})

test('target storage failure keeps writing and autosave available', async ({ page }) => {
  const { body } = await start(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Mock quota', 'QuotaExceededError') } })
  await setGoal(page, '15')
  await expect(page.locator('.goal-settings')).toContainText('目标仅在当前章节会话生效')
  await page.getByLabel('当前章节写作进度', { exact: true }).click()
  await body.fill('存储不可用仍可写作')
  await saved(page)
  await expect(page.getByLabel('当前章节写作进度', { exact: true })).toContainText('/ 15 字')
})

test('long-prose scroll returns to its original position after focus exits without remounting', async ({ page }) => {
  const { body } = await start(page)
  await body.fill('长篇虚构正文 hello world。'.repeat(900))
  await saved(page)
  await body.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  const original = await body.elementHandle()
  const top = await page.locator('.document').evaluate(element => element.scrollTop)
  expect(top).toBeGreaterThan(0)
  await body.press('ControlOrMeta+Alt+Shift+f')
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
  await body.press('Escape')
  await expect(page.locator('.workspace')).not.toHaveClass(/focused/)
  expect(await page.locator('.document').evaluate(element => element.scrollTop)).toBe(top)
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
})

test('focus navigation waits for the pending write before loading the next chapter', async ({ page }) => {
  const { body } = await start(page)
  await page.clock.install()
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/chapters/*', async route => {
    if (route.request().method() === 'PUT') await gate
    await route.continue()
  })
  try {
    await body.fill('必须保存后才能切换的专注草稿')
    await body.press('ControlOrMeta+Alt+Shift+ArrowDown')
    await expect(page.locator('.save-status')).toHaveText('保存中…')
    await expect(page.getByRole('textbox', { name: '章节标题' })).toHaveValue('专注第一章')
    await expect(body).toHaveAttribute('contenteditable', 'false')
    await expect(body).toHaveAttribute('tabindex', '0')
    release()
    await expectChapterReady(page, '专注第二章', '')
    await chapterBody(page).press('ControlOrMeta+Alt+Shift+ArrowUp')
    await expectChapterReady(page, '专注第一章', '必须保存后才能切换的专注草稿')
  } finally { release() }
})

test('version conflict stays visible through focus toggles and cannot overwrite or switch chapters', async ({ page }) => {
  const { body } = await start(page)
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 409, json: { message: '隔离测试版本冲突' } }) : route.continue())
  await body.fill('版本冲突时保留的专注草稿')
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await body.press('Control+Alt+Shift+s')
  await expect(page.locator('.save-status')).toHaveText('版本冲突 · 未保存')
  await expect(page.getByRole('button', { name: '导出未保存草稿' })).toBeVisible()
  await body.press('ControlOrMeta+Alt+Shift+ArrowDown')
  await expect(page.getByRole('textbox', { name: '章节标题' })).toHaveValue('专注第一章')
  await body.press('Escape')
  await expect(body).toHaveText('版本冲突时保留的专注草稿')
  await expect(page.getByRole('button', { name: '立即保存', exact: true })).toBeDisabled()
})

test('timer starts in focus, pauses manually/on exit/when hidden, resumes and resets per chapter', async ({ page }) => {
  const { body } = await start(page)
  await page.clock.install()
  const timer = page.getByLabel('写作计时', { exact: true })
  await expect(timer).toHaveText('00:00:00')
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await page.clock.fastForward(65000)
  await expect(timer).toHaveText('00:01:05')
  await page.getByRole('button', { name: '暂停计时' }).click()
  await page.clock.fastForward(10000)
  await expect(timer).toHaveText('00:01:05')
  await page.getByRole('button', { name: '继续计时' }).click()
  await page.clock.fastForward(5000)
  await expect(timer).toHaveText('00:01:10')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('.writing-timer')).toContainText('计时暂停')
  await page.clock.fastForward(10000)
  await expect(timer).toHaveText('00:01:10')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('.writing-timer')).toContainText('专注计时')
  await page.clock.fastForward(5000)
  await expect(timer).toHaveText('00:01:15')
  await body.press('Escape')
  await page.clock.fastForward(10000)
  await expect(timer).toHaveText('00:01:15')
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await page.clock.fastForward(5000)
  await expect(timer).toHaveText('00:01:20')
  await page.getByRole('button', { name: '重置计时' }).click()
  await expect(timer).toHaveText('00:00:00')
  await page.clock.fastForward(3000)
  await expect(timer).toHaveText('00:00:03')
  await body.press('ControlOrMeta+Alt+Shift+ArrowDown')
  await expectChapterReady(page, '专注第二章')
  await expect(timer).toHaveText('00:00:00')
})

test('focus autosave failures retain drafts and block chapter switch until a successful retry', async ({ page }) => {
  const { body } = await start(page)
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { message: '隔离测试保存失败' } }) : route.continue())
  await body.fill('专注模式不能丢失的草稿')
  await body.press('ControlOrMeta+Alt+Shift+ArrowDown')
  await expect(page.locator('.save-status')).toHaveText('保存失败')
  await expect(page.getByRole('textbox', { name: '章节标题' })).toHaveValue('专注第一章')
  await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible()
  await body.press('Escape')
  await expect(body).toHaveText('专注模式不能丢失的草稿')
  await expect(page.locator('.workspace')).not.toHaveClass(/focused/)
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '重试保存' }).click()
  await saved(page)
  await page.getByRole('button', { name: '下一章', exact: true }).click()
  await expectChapterReady(page, '专注第二章')
  await page.getByRole('button', { name: '上一章', exact: true }).click()
  await expectChapterReady(page, '专注第一章', '专注模式不能丢失的草稿')
})

test('AI preview/apply and preferences work in focus; dialog Escape does not exit focus', async ({ page }) => {
  const { body } = await start(page)
  await page.route('**/api/ai/status', route => route.fulfill({ json: { configured: true, model: 'focus-mock', message: '隔离测试 AI 桩已就绪' } satisfies AiStatus }))
  await page.route('**/api/ai/models', route => route.fulfill({ json: {
    models: [{ id: 'openai-default', label: 'Mock', model: 'focus-mock', provider: 'openai', configured: true, maxOutputTokens: 4096, inputUsdPerMillion: null, outputUsdPerMillion: null }],
    policy: { requestsPerMinute: 20, sessionRequests: 100, sessionTokens: 200000, maxInputTokens: 64000, maxRequestUsd: 1, sessionUsd: 5 }, remaining: { requests: 100, tokens: 200000, usd: 5 },
  } satisfies AiCatalog }))
  await page.route('**/api/ai/generate', route => route.fulfill({ json: { text: '隔离桩续写', usage: { inputTokens: 12, outputTokens: 5 }, finishReason: 'stop' } satisfies AiResult }))
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await body.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await page.getByRole('button', { name: 'AI 辅助', exact: true }).click()
  const ai = page.getByRole('dialog', { name: 'AI 辅助写作' })
  await ai.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(ai.getByLabel('AI 结果预览')).toContainText('隔离桩续写')
  await expect(body).toHaveText('风起云涌 Hello 2026')
  await ai.getByRole('button', { name: '接受并插入' }).click()
  await expect(body).toContainText('隔离桩续写')
  await saved(page)
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  const prefs = page.getByRole('dialog', { name: '偏好设置' })
  await prefs.getByLabel('外观主题').selectOption('dark')
  await prefs.getByLabel('正文字号').selectOption('24')
  await prefs.getByLabel('编辑器布局').selectOption('compact')
  await prefs.press('Escape')
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
  await expect(page.locator('.tiptap')).toHaveCSS('font-size', '24px')
  await expect(page.locator('.tiptap')).toHaveCSS('line-height', '48px')
  await expect(page.locator('.editor-pane')).toHaveCSS('background-color', 'rgb(32, 32, 35)')
  await expect(page.locator('.ai-applied')).toHaveCSS('color', 'rgb(229, 229, 234)')
  // AI feedback stays in the tools row so timer controls remain actionable.
  await page.getByRole('button', { name: '暂停计时' }).click()
  await expect(page.locator('.writing-timer')).toContainText('计时暂停')
  await page.screenshot({ path: test.info().outputPath('focus-dark.png') })
  await page.getByRole('button', { name: '退出专注', exact: true }).click()
  await expect(page.locator('.workspace')).toHaveAttribute('data-layout', 'compact')
  await expect(page.locator('.library-pane')).toHaveCSS('width', '170px')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('narrow focus layout stays within the viewport and leaves native and IME shortcuts alone', async ({ page }) => {
  const { body } = await start(page)
  await page.setViewportSize({ width: 390, height: 844 })
  // Enter through the existing scoped shortcut after the normal desktop layout.
  await body.press('ControlOrMeta+Alt+Shift+f')
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
  await expect(page.getByRole('button', { name: '退出专注', exact: true })).toBeInViewport()
  await expect(page.getByLabel('写作计时', { exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const key of ['s', 'f', 'p', 'r', 'l', 't', 'w']) {
    const allowed = await body.evaluate((element, key) => element.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true })), key)
    expect(allowed).toBe(true)
  }
  const safariSaveAs = await body.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Í', code: 'KeyS', metaKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  expect(safariSaveAs).toBe(true)
  const composing = await body.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })))
  expect(composing).toBe(true)
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
  // Option may change event.key on macOS; the physical code still works.
  const handled = await body.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Ï', code: 'KeyF', metaKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true })))
  expect(handled).toBe(false)
  await expect(page.locator('.workspace')).not.toHaveClass(/focused/)
})

test('focus toggles retain the in-flight queue and newer protected revision until both writes finish', async ({ page }) => {
  const { body } = await start(page)
  const original = await body.elementHandle()
  const readDrafts = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('storyforge-protected-drafts', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ token: string; revision: number; value: { content: unknown } }[]>((resolve, reject) => {
        const request = db.transaction('drafts').objectStore('drafts').getAll()
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
  await expect.poll(readDrafts).toEqual([])
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const writes: { version: number; content: unknown }[] = []
  let chapterUrl = ''
  await page.route('**/api/chapters/*', async route => {
    if (route.request().method() === 'PUT') {
      chapterUrl = route.request().url()
      writes.push(route.request().postDataJSON())
      if (writes.length === 1) await gate
    }
    await route.continue()
  })
  try {
    await body.fill('第一份等待回执的专注修订')
    await body.press('Control+Alt+Shift+s')
    await expect.poll(() => writes.length).toBe(1)
    await expect.poll(async () => (await readDrafts()).length).toBe(1)
    const first = (await readDrafts())[0]
    await page.getByRole('button', { name: '专注写作', exact: true }).click()
    // fill() selects a DOM Range and sends input in separate browser calls.
    // Use the writer's select-all key so ProseMirror's model and visible range
    // agree before input, including while its focus correction is pending.
    await body.press('ControlOrMeta+a')
    await expect.poll(() => body.evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor
      const { from, to, empty } = editor.state.selection
      const dom = window.getSelection()
      // WebKit Selection.toString() adds rendered paragraph separators. Read
      // the selected DOM fragment without trimming any actual text characters.
      const visible = dom?.rangeCount === 1 ? dom.getRangeAt(0).cloneContents().textContent : null
      const confined = !!dom?.anchorNode && !!dom.focusNode && element.contains(dom.anchorNode) && element.contains(dom.focusNode)
      return { visible, model: editor.state.doc.textBetween(from, to, '\n'), empty, confined, wholeDocument: from === 0 && to === editor.state.doc.content.size }
    })).toEqual({ visible: '第一份等待回执的专注修订', model: '第一份等待回执的专注修订', empty: false, confined: true, wholeDocument: true })
    await page.keyboard.insertText('第二份不能被旧回执清除的专注修订')
    await expect(body).toHaveText('第二份不能被旧回执清除的专注修订')
    await expect.poll(async () => (await readDrafts())[0]?.revision).toBeGreaterThan(first.revision)
    expect((await readDrafts())[0].token).not.toBe(first.token)
    await page.getByRole('button', { name: '退出专注', exact: true }).click()
    expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
    release()
    await saved(page)
    await expect.poll(readDrafts).toEqual([])
    expect(writes).toHaveLength(2)
    expect(writes[1].version).toBe(writes[0].version + 1)
    const stored = await (await page.request.get(chapterUrl)).json()
    expect(stored.version).toBe(writes[1].version + 1)
    expect(stored.content.content[0].content[0].text).toBe('第二份不能被旧回执清除的专注修订')
  } finally { release() }
})

test('focus keeps recovery choices visible, pauses the timer until choice and restores preference trigger focus', async ({ page }) => {
  const { title, body } = await start(page)
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await body.fill('专注恢复需要明确选择的虚构草稿')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: title }).click()
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  await page.clock.install()
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await page.clock.fastForward(10000)
  await expect(page.getByLabel('写作计时', { exact: true })).toHaveText('00:00:00')
  await expect(chapterBody(page)).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await page.clock.fastForward(1000)
  await saved(page)
  await expect(chapterBody(page)).toHaveText('专注恢复需要明确选择的虚构草稿')
  const trigger = page.getByRole('button', { name: '偏好设置', exact: true }).filter({ visible: true })
  await trigger.click()
  await page.getByRole('dialog', { name: '偏好设置' }).press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.locator('.workspace')).toHaveClass(/focused/)
})
