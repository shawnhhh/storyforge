import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

test('generated trace HTML cannot reload a live creation draft', async ({ page }) => {
  const dir = resolve('work/watch-safety', crypto.randomUUID())
  mkdirSync(dir, { recursive: true })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '新建作品', exact: true }).click()
    const dialog = page.getByRole('dialog'), name = '合成诊断文件保护-' + crypto.randomUUID()
    await dialog.getByLabel('小说名称').fill(name)
    let navigations = 0
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
    // Chokidar events are asynchronous; exercise multiple writes while keeping
    // the same unsaved form alive. No retries, reloads, or deadline relaxation.
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(dir, `trace-${i}.html`), '<!doctype html><title>synthetic snapshot</title>')
      await page.waitForTimeout(350)
      await expect(dialog.getByLabel('小说名称')).toHaveValue(name)
    }
    expect(navigations).toBe(0)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
