import { expect, type Page } from '@playwright/test'
export async function openDeleteMenu(page: Page, name: string) {
  const menu = page.locator('.delete-menu').filter({ has: page.getByRole('button', { name, exact: true, includeHidden: true }) })
  if (!await menu.evaluate(element => element.hasAttribute('open'))) await menu.locator('summary').click()
  await expect(menu).toHaveJSProperty('open', true)
  await expect(menu.getByRole('button', { name, exact: true })).toBeVisible()
}
export async function confirmNovelDeletion(page: Page, name: string) {
  await page.getByRole('dialog').getByLabel('输入完整名称确认').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: '移入回收站', exact: true }).click()
}
