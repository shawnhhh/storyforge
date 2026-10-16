import { expect, test, type Page } from '@playwright/test'
import { expectChapterReady } from './editor-helpers.js'

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}
async function viewport(page: Page) {
  await settle(page)
  return page.locator('.document').evaluate(element => {
    const selection = window.getSelection()
    return {
      scrollTop: element.scrollTop,
      height: element.clientHeight,
      top: element.getBoundingClientRect().top,
      anchor: selection?.anchorOffset,
      focus: selection?.focusOffset,
      editorFocused: document.activeElement === element.querySelector('.tiptap'),
    }
  })
}
const text = '长篇正文 hello world 123。'.repeat(1500)
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存')
async function create(page: Page, title: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建作品', exact: true }).click()
  await page.getByRole('dialog').getByLabel('小说名称').fill(title)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '创建第一章' }).click()
  const body = await expectChapterReady(page, '第 1 章')
  await body.fill(text)
  await saved(page)
  return body
}
// Hold real HTTP responses rather than use sleeps or shorten the debounce.
async function holdSaves(page: Page) {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/chapters/*', async route => {
    if (route.request().method() === 'PUT') await gate
    await route.continue()
  })
  return release
}

for (const width of [1440, 700]) {
  test(`autosave preserves the bottom viewport selection and continuous input at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const title = `滚动回归底部-${width}-${test.info().repeatEachIndex}-${test.info().retry}`
    const body = await create(page, title)
    const original = await body.elementHandle()
    await body.press('ControlOrMeta+End')
    await body.press('End')
    const release = await holdSaves(page)
    try {
      await page.keyboard.insertText('甲')
      await expect(page.locator('.save-status')).toHaveText('保存中…')
      const first = await viewport(page)
      expect(first.editorFocused).toBe(true)
      // Continue editing while the previous write is in flight.
      await page.keyboard.insertText('乙丙')
      const before = await viewport(page)
      release()
      await saved(page)
      expect(await viewport(page)).toEqual(before)
      expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
      await expect(page.getByLabel('字数统计')).toHaveText('10503 字')
      await test.info().attach('stable-bottom-viewport', { body: Buffer.from(JSON.stringify({ first, before, after: await viewport(page) })), contentType: 'application/json' })
    } finally { release(); await page.unroute('**/api/chapters/*') }
    // Switching chapters and a full reload must recover the final queued write.
    await page.getByRole('button', { name: '添加章节' }).click()
    const second = await expectChapterReady(page, '第 2 章')
    await second.fill('第二章独立正文')
    await page.getByRole('button', { name: '上一章', exact: true }).click()
    await expectChapterReady(page, '第 1 章', text + '甲乙丙')
    await page.reload()
    if (width <= 720) {
      await page.locator('.dashboard-work').filter({ hasText: title }).getByRole('button', { name: '打开作品' }).click()
      await expectChapterReady(page, '第 2 章', '第二章独立正文')
      await page.locator('.chapter-select').filter({ hasText: '第 1 章' }).click()
    } else await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name: title }).click()
    await expectChapterReady(page, '第 1 章', text + '甲乙丙')
    await page.getByRole('button', { name: '下一章', exact: true }).click()
    await expectChapterReady(page, '第 2 章', '第二章独立正文')
  })
}

test('autosave respects active user scrolling away from the caret; typing still follows the caret', async ({ page }) => {
  const body = await create(page, '滚动回归主动阅读')
  await body.press('ControlOrMeta+End')
  await body.press('End')
  const release = await holdSaves(page)
  try {
    await page.keyboard.insertText('新输入')
    await expect(page.locator('.save-status')).toHaveText('保存中…')
    const bottom = await viewport(page)
    const scroll = page.locator('.document')
    await scroll.hover()
    await page.mouse.wheel(0, -1800)
    await expect.poll(async () => (await viewport(page)).scrollTop).toBeLessThan(bottom.scrollTop - 500)
    const reading = await viewport(page)
    release()
    await saved(page)
    expect(await viewport(page)).toEqual(reading)
    // The save must neither pin scrollTop nor refocus the editor on behalf of the user.
    await page.keyboard.insertText('继续')
    await expect.poll(async () => (await viewport(page)).scrollTop).toBeGreaterThan(reading.scrollTop + 500)
    await saved(page)
    await expect(body).toHaveText(text + '新输入继续')
  } finally { release(); await page.unroute('**/api/chapters/*') }
})

test('saving a long document preserves an intentionally blurred editor', async ({ page }) => {
  const body = await create(page, '滚动回归不抢焦点')
  await body.press('ControlOrMeta+End')
  const release = await holdSaves(page)
  try {
    await page.keyboard.insertText('焦点测试')
    await expect(page.locator('.save-status')).toHaveText('保存中…')
    await page.getByLabel('搜索章节').click()
    const before = await viewport(page)
    expect(before.editorFocused).toBe(false)
    release()
    await saved(page)
    await expect(page.getByLabel('搜索章节')).toBeFocused()
    expect(await viewport(page)).toEqual(before)
  } finally { release(); await page.unroute('**/api/chapters/*') }
})
