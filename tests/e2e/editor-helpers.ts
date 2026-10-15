import { expect, type Page } from '@playwright/test'

export const chapterBody = (page: Page) => page.getByRole('textbox', { name: '小说正文', exact: true })

// A visible textbox (or an unchanged word count) can still belong to the chapter
// being replaced. Wait for the operation, chapter identity and actual editability.
export async function expectChapterReady(page: Page, expectedTitle: string, expectedContent?: string) {
  await expect(page.locator('.workspace')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue(expectedTitle)
  const body = chapterBody(page)
  // role=textbox remains present while Tiptap intentionally locks the document.
  // fill() rejects a non-contenteditable div rather than waiting for that attribute.
  await expect(body).toHaveAttribute('contenteditable', 'true')
  await expect(body).toBeEditable()
  if (expectedContent !== undefined) await expect(body).toHaveText(expectedContent)
  return body
}
