import { expect, test } from '@playwright/test'

for (const width of [700, 390]) {
  test(`story, music and video dashboard navigation remains accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const music = page.getByRole('link', { name: '音乐工作台', exact: true })
    const video = page.getByRole('link', { name: '视频工作台', exact: true })
    await expect(music).toBeVisible()
    await expect(video).toBeVisible()
    await expect(music).toHaveCSS('position', 'static')
    await expect(video).toHaveCSS('position', 'static')

    await video.click()
    await expect(page.getByRole('heading', { name: '视频工作台', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '小说', exact: true }).click()
    await expect(music).toBeVisible()

    await music.click()
    await expect(page.getByRole('heading', { name: '音乐工作台', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '小说工作台', exact: true }).click()
    await expect(video).toBeVisible()
  })
}
