import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chapterBody, expectChapterReady } from './editor-helpers.js'

const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('已保存到数据库')

async function create(page: Page) {
  const title = `关联工作台验收-${crypto.randomUUID()}`
  await page.goto('/')
  await page.getByRole('button', { name: '创建小说', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '创建第一章', exact: true }).click()
  await expectChapterReady(page, '第 1 章')
  return title
}

test('Apple workspace creates chapters, commits simulated Chinese input and restores saved prose after reload', async ({ page }) => {
  const title = await create(page)
  const body = chapterBody(page)
  await page.getByLabel('章节标题', { exact: true }).fill('归航')
  await body.focus()
  await body.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.insertText('雾中的灯塔亮了起来。')
  await body.dispatchEvent('compositionend', { data: '雾中的灯塔亮了起来。' })
  await expect(body).toHaveText('雾中的灯塔亮了起来。')
  await saved(page)
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expectChapterReady(page, '第 2 章')
  await body.fill('下一章仍使用同一部小说的真实数据。')
  await saved(page)
  await page.locator('.chapter-select').filter({ hasText: '归航' }).click()
  await expectChapterReady(page, '归航', '雾中的灯塔亮了起来。')
  await page.reload()
  await page.getByRole('navigation', { name: '小说列表', exact: true }).getByRole('button', { name: title }).click()
  await expectChapterReady(page, '归航', '雾中的灯塔亮了起来。')
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await body.fill('网络失败也必须保留的工作台草稿。')
  await expect(page.locator('.save-status')).toHaveText('保存失败')
  await page.evaluate(() => { location.hash = '#music' })
  await expect(page).not.toHaveURL(/#music$/)
  await expect(body).toHaveText('网络失败也必须保留的工作台草稿。')
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await saved(page)
})

test('Apple workspace preserves editor and selection through focus and theme changes at desktop window sizes', async ({ page }) => {
  await create(page)
  const body = chapterBody(page)
  await body.fill('沉浸写作保留正文、光标和章节。')
  await saved(page)
  const original = await body.elementHandle()
  await body.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.setTextSelection({ from: 3, to: 5 }))
  for (const width of [1440, 1280, 960]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await body.boundingBox())!.width).toBeGreaterThan(320)
  }
  await page.getByRole('button', { name: '专注写作', exact: true }).click()
  await expect(page.locator('.library-pane')).toBeHidden()
  await expect(body).toBeVisible()
  await page.getByRole('button', { name: '退出专注', exact: true }).click()
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
  expect(await body.evaluate(element => {
    const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection
    return [from, to]
  })).toEqual([3, 5])
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await dialog.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await dialog.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('system')
  await page.keyboard.press('Escape')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
  await expect(body).toHaveText('沉浸写作保留正文、光标和章节。')
})

test('Apple Music and Video keep playable Mock media and export controls across light and dark desktop windows', async ({ page, browserName }) => {
  const screenshots = resolve('docs/acceptance/apple-ui')
  const capture = async (module: string) => {
    for (const width of [1440, 1280]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }) })
      const filename = `${module}-${theme}-${width}.png`
      const screenshotPath = process.env.E2E_APPLE_SCREENSHOTS && browserName === 'chromium'
        ? (mkdirSync(screenshots, { recursive: true }), resolve(screenshots, filename))
        : test.info().outputPath(filename)
      await page.screenshot({ path: screenshotPath })
      await test.info().attach(filename, { path: screenshotPath, contentType: 'image/png' })
    }
  }
  await page.goto('/#music')
  await page.getByLabel('歌曲名称', { exact: true }).fill(`海上来信-${crypto.randomUUID()}`)
  await page.getByRole('button', { name: '创建歌曲', exact: true }).click()
  await page.getByLabel('歌词', { exact: true }).fill('[主歌]\n远处的灯塔点亮潮汐\n[副歌]\n让每一句归途都有回音')
  await page.getByLabel('曲风', { exact: true }).fill('钢琴 / 氛围')
  await page.getByRole('button', { name: '保存歌词与配置', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '歌词与配置已保存' })).toBeVisible()
  await page.getByRole('button', { name: '生成 Mock 音乐', exact: true }).click()
  const audio = page.locator('audio').first()
  await expect(audio).toBeVisible()
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).duration)).toBeGreaterThan(0)
  await audio.evaluate(element => (element as HTMLAudioElement).play())
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: '导出完整歌曲项目', exact: true })).toBeVisible()
  await capture('music')
  await page.goto('/#video')
  await page.getByRole('button', { name: '新建视频项目', exact: true }).click()
  await page.getByLabel('视频名称', { exact: true }).fill('雾港 · 第一幕')
  await page.getByLabel('剧本', { exact: true }).fill('清晨，灯塔守望者沿着海岸走向码头。')
  await page.getByRole('button', { name: '添加镜头', exact: true }).click()
  await page.getByLabel('镜头描述 1', { exact: true }).fill('海雾缓缓散开，灯塔与码头在晨光中显现。')
  await page.getByRole('button', { name: '保存视频项目', exact: true }).click()
  await expect(page.locator('[data-video-message]')).toHaveText('已保存到数据库')
  await page.getByRole('button', { name: '生成 Mock 视频', exact: true }).click()
  const video = page.getByLabel('mock-storyboard.webm', { exact: true }).last()
  await expect(video).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  await video.evaluate(async element => { const media = element as HTMLVideoElement; media.muted = true; await media.play() })
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  await expect(page.getByRole('link', { name: '导出工程 JSON', exact: true })).toBeVisible()
  await capture('video')
})
