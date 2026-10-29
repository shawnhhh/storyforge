import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Editor } from '@tiptap/core'
import { expectChapterReady } from './editor-helpers.js'
import { preferencesKey, defaultPreferences } from '../../src/features/preferences/model.js'

const beforeLayout = readFileSync(new URL('./fixtures/writing-layout-before.css', import.meta.url), 'utf8')
const beforeTheme = readFileSync(new URL('./fixtures/ai-theme-before.css', import.meta.url), 'utf8')
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存到数据库')
async function start(page: Page, layout = 'standard') {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: preferencesKey, value: { ...defaultPreferences, layout } })
  await page.goto('/')
  await page.getByRole('button', { name: '新建作品', exact: true }).click()
  await page.getByRole('dialog').getByLabel('小说名称').fill(`UI虚构-${crypto.randomUUID().slice(0, 8)}`)
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '创建第一章' }).click()
  const body = await expectChapterReady(page, '第 1 章')
  await body.fill('中文写作，保持光标与正文。\n'.repeat(100)); await saved(page)
  return body
}
async function measure(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.editor-pane')!.getBoundingClientRect()
    const documentElement = document.querySelector<HTMLElement>('.document')!, title = document.querySelector<HTMLElement>('.chapter-title')!, body = document.querySelector<HTMLElement>('.tiptap')!
    const paragraph = body.querySelector('p')!.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect(), titleStyle = getComputedStyle(title)
    return { novelNavigationHeight: document.querySelector('nav[aria-label="小说列表"]')!.getBoundingClientRect().height, viewport: innerWidth, paneLeft: pane.left, paneWidth: pane.width, documentLeft: documentElement.getBoundingClientRect().left, documentWidth: documentElement.getBoundingClientRect().width, bodyLeft: paragraph.left, titleTextLeft: titleRect.left + parseFloat(titleStyle.paddingLeft) + parseFloat(titleStyle.borderLeftWidth), titleWidth: titleRect.width, textWidth: body.getBoundingClientRect().width, inset: paragraph.left - pane.left, documentPadding: getComputedStyle(documentElement).paddingLeft, documentAlign: getComputedStyle(documentElement).alignSelf, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
  })
}

for (const width of [2560, 1440, 1024, 390]) for (const layout of ['standard', 'wide', 'compact']) test(`measured title alignment, Chinese input and focus layout ${width}/${layout}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1100 })
  const body = await start(page, layout), original = await body.elementHandle()
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message))
  const samples: unknown[] = []
  for (const focused of [false, true]) {
    if (focused) await page.getByRole('button', { name: '专注写作', exact: true }).click()
    const legacy = await page.addStyleTag({ content: beforeLayout })
    const before = await measure(page)
    await page.screenshot({ path: test.info().outputPath(`${focused ? 'focus' : 'normal'}-before.png`) })
    await legacy.evaluate(element => element.parentNode?.removeChild(element))
    const after = await measure(page)
    samples.push({ layout, focused, before, after, beforeReproduction: 'historical affected CSS; current surrounding UI' })
    expect(Math.abs(after.bodyLeft - after.titleTextLeft)).toBeLessThanOrEqual(1)
    expect(after.horizontalOverflow).toBe(false)
    if (focused) {
      expect(after.documentWidth).toBeLessThanOrEqual(850)
      expect(Math.abs(after.documentLeft - (width - after.documentWidth) / 2)).toBeLessThanOrEqual(1)
      expect(after.textWidth).toBeLessThanOrEqual(754)
    } else {
      if (width === 390) expect(after.novelNavigationHeight).toBeGreaterThanOrEqual(32)
      expect(after.inset).toBeGreaterThanOrEqual(24)
      expect(after.inset).toBeLessThanOrEqual(32)
      expect(after.documentAlign).toBe('stretch')
      expect(after.documentWidth).toBeCloseTo(after.paneWidth, 0)
    }
    await page.screenshot({ path: test.info().outputPath(`${focused ? 'focus' : 'normal'}-after.png`) })
    // Native text insertion, not a model mutation, exercises Chinese text at the caret.
    await body.press('ControlOrMeta+End')
    await page.keyboard.insertText(focused ? '专注中文输入' : '普通中文输入')
    await saved(page)
    const expectedTail = focused ? '专注中文输入' : '普通中文输入'
    await expect(body).toContainText(expectedTail)
    await body.press('Shift+ArrowLeft')
    const selected = await page.evaluate(() => window.getSelection()?.toString())
    expect(selected).toBe('入')
    const scroll = await page.locator('.document').evaluate(element => element.scrollTop)
    await page.getByRole('button', { name: '一致性审阅', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'AI 章节一致性审阅' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(body).toBeFocused()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
    expect(await page.locator('.document').evaluate(element => element.scrollTop)).toBe(scroll)
    expect(await body.evaluate((element, previous) => element === previous, original)).toBe(true)
  }
  const measurements = test.info().outputPath('layout-measurements.json')
  writeFileSync(measurements, JSON.stringify(samples, null, 2))
  await test.info().attach('layout-measurements.json', { path: measurements, contentType: 'application/json' })
  expect(browserErrors).toEqual([])
})

async function mockModels(page: Page) {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { configured: true, model: 'mock-model', message: 'Mock AI 已就绪' } }))
  await page.route('**/api/ai/models', route => route.fulfill({ json: {
    models: [{ id: 'openai-default', label: 'Mock 模型', provider: 'openai', model: 'mock-model', configured: true, maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }], policy: { requestsPerMinute: 20, sessionRequests: 100, sessionTokens: 200000, maxInputTokens: 64000, maxRequestUsd: 1, sessionUsd: 5 }, remaining: { requests: 100, tokens: 200000, usd: 5 },
  } }))
}
async function colors(page: Page) {
  return page.locator('.ai-dialog[open]').evaluate(element => {
    const root = getComputedStyle(document.documentElement)
    const pairs = [
      ['.ai-dialog', '--sf-surface'], ['.ai-settings', '--sf-panel'], ['select', '--sf-field'], ['input[type=number]', '--sf-field'], ['input[type=search]', '--sf-field'], ['textarea', '--sf-field'], ['.button-row button:not(.primary)', '--sf-field'], ['.button-row button.primary', '--sf-accent-hover'], ['.ai-context', '--sf-preview'], ['.ai-preview', '--sf-preview'], ['.review-finding', '--sf-panel'],
    ]
    const rgb = (value: string) => {
      const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe)
      const result = getComputedStyle(probe).color; probe.remove(); return result
    }
    return pairs.flatMap(([selector, token]) => {
      const item = selector === '.ai-dialog' ? element : element.querySelector(selector)
      return item ? [{ selector, actual: getComputedStyle(item).backgroundColor, expected: rgb(root.getPropertyValue(token)), text: getComputedStyle(item).color, border: getComputedStyle(item).borderColor, expectedBorder: rgb(root.getPropertyValue(selector.includes('button.primary') ? '--sf-accent-hover' : '--sf-border')), expectedHover: rgb(root.getPropertyValue('--sf-selected')), hovered: item.matches(':hover'), focused: item.matches(':focus'), disabled: item instanceof HTMLButtonElement ? item.disabled : null, transition: getComputedStyle(item).transitionDuration }] : []
    })
  })
}
function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 })
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

for (const width of [1440, 390]) test(`AI writing and review follow explicit and live system themes with computed colors ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' })
  const body = await start(page), originalText = await body.textContent()
  const originalDocument = await body.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())
  await mockModels(page)
  let calls = 0, writes = 0
  page.on('request', request => { if (request.method() === 'PUT' && /\/api\/chapters\//.test(request.url())) writes++ })
  await page.route('**/api/ai/generate', route => { calls++; return route.fulfill({ json: { text: 'Mock 新正文', usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop' } }) })
  await page.route('**/api/ai/review', route => { calls++; return route.fulfill({ json: { fingerprint: route.request().postDataJSON().fingerprint, findings: [{ category: 'plot', certainty: 'suggestion', explanation: '可能缺少过渡', suggestion: '考虑补充动机', evidence: [], evidenceIncomplete: false }], usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'stop', modelId: 'openai-default' } }) })
  // A real second tab changes the stored preference while the first tab's modal stays open.
  const settings = await context.newPage(); await settings.goto('/')
  await settings.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  const preference = settings.getByRole('dialog', { name: '偏好设置' }).getByLabel('外观主题')
  const samples: unknown[] = []
  for (const review of [false, true]) {
    await page.getByRole('button', { name: review ? '一致性审阅' : 'AI 辅助', exact: true }).click()
    const panel = page.getByRole('dialog', { name: review ? 'AI 章节一致性审阅' : 'AI 辅助写作' })
    await panel.locator('summary').filter({ hasText: '模型配置中心' }).click()
    await panel.locator('summary').filter({ hasText: '按需引用' }).click()
    if (review) {
      await panel.getByRole('button', { name: '预览发送上下文' }).click()
      await panel.getByRole('checkbox', { name: '我已核对以上实际发送内容，同意发送至所选模型' }).check()
      await panel.getByRole('button', { name: '确认并开始审阅' }).click()
      await expect(panel.getByLabel('一致性审阅结果')).toBeVisible()
    } else {
      await panel.getByRole('button', { name: '生成预览', exact: true }).click()
      await expect(panel.getByLabel('AI 结果预览')).toBeVisible()
    }
    for (const theme of ['light', 'dark', 'system']) {
      await preference.selectOption(theme)
      const schemes = theme === 'system' ? ['dark', 'light'] as const : [theme] as ('light' | 'dark')[]
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme })
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
        await expect(panel).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(32, 32, 36)' : 'rgb(255, 255, 255)')
        // The dialog changes immediately; buttons retain the global 150ms
        // background transition. Sample the settled idle palette, with no hover.
        const ordinaryButton = panel.locator('.button-row button:not(.primary)').first()
        await page.mouse.move(0, 0)
        await expect.poll(() => ordinaryButton.evaluate(element => element.matches(':hover'))).toBe(false)
        await expect(ordinaryButton).toBeEnabled()
        const expected = await colors(page)
        for (const value of expected) {
          const target = value.selector === '.ai-dialog' ? panel : panel.locator(value.selector).first()
          await expect(target, value.selector).toHaveCSS('background-color', value.expected)
          await expect(target, value.selector).toHaveCSS('border-color', value.expectedBorder)
        }
        const actual = await colors(page)
        for (const value of actual) { expect(value.actual, value.selector).toBe(value.expected); expect(value.border, value.selector).toBe(value.expectedBorder); expect(contrast(value.text, value.actual), value.selector).toBeGreaterThanOrEqual(4.5) }
        const idle = actual.find(value => value.selector === '.button-row button:not(.primary)')!
        expect(idle.hovered).toBe(false); expect(idle.disabled).toBe(false)
        // Test hover separately, including both ends of the real transition.
        await ordinaryButton.hover()
        await expect.poll(() => ordinaryButton.evaluate(element => element.matches(':hover'))).toBe(true)
        await expect(ordinaryButton).toHaveCSS('background-color', idle.expectedHover)
        await expect(ordinaryButton).toHaveCSS('border-color', idle.expectedBorder)
        const hover = await ordinaryButton.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color, focused: element.matches(':focus'), disabled: (element as HTMLButtonElement).disabled, transition: getComputedStyle(element).transitionDuration }))
        expect(contrast(hover.text, hover.background)).toBeGreaterThanOrEqual(4.5)
        await page.mouse.move(0, 0)
        await expect.poll(() => ordinaryButton.evaluate(element => element.matches(':hover'))).toBe(false)
        await expect(ordinaryButton).toHaveCSS('background-color', idle.expected)
        const note = await panel.locator('.ai-note').first().evaluate(element => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element.closest('.ai-dialog')!).backgroundColor }))
        expect(contrast(note.foreground, note.background)).toBeGreaterThanOrEqual(4.5)
        await panel.getByLabel('搜索引用', { exact: true }).focus()
        await expect(panel.getByLabel('搜索引用', { exact: true })).toHaveCSS('outline-style', 'solid')
        await expect(panel.getByLabel('搜索引用', { exact: true })).toHaveCSS('outline-width', '2px')
        samples.push({ review, theme, scheme, colors: actual, hover })
        await panel.evaluate(element => { element.scrollTop = 0 })
        if (!review && theme === 'dark') {
          const legacy = await page.addStyleTag({ content: beforeTheme })
          await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)')
          await panel.screenshot({ animations: 'disabled', path: test.info().outputPath('ai-dark-before.png') })
          await legacy.evaluate(element => element.parentNode?.removeChild(element))
        }
        // Disable CSS animations only during evidence capture; computed-color, hover and contrast assertions above stay intact.
        await panel.screenshot({ animations: 'disabled', path: test.info().outputPath(`${review ? 'review' : 'writing'}-${theme}-${scheme}-after.png`) })
        await panel.locator(review ? '.review-results' : 'section[aria-label="AI 结果预览"]').scrollIntoViewIfNeeded()
        await panel.screenshot({ animations: 'disabled', path: test.info().outputPath(`${review ? 'review' : 'writing'}-${theme}-${scheme}-result-after.png`) })
      }
    }
    await page.keyboard.press('Escape')
  }
  expect(calls).toBe(2); expect(writes).toBe(0)
  expect(await body.textContent()).toBe(originalText)
  expect(await body.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(originalDocument)
  await settings.close()
  const measurements = test.info().outputPath('theme-measurements.json')
  writeFileSync(measurements, JSON.stringify(samples, null, 2))
  await test.info().attach('theme-measurements.json', { path: measurements, contentType: 'application/json' })
})
