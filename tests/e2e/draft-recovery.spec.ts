import { expect, test, chromium, firefox, webkit, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chapterBody, expectChapterReady } from './editor-helpers.js'

async function seed(page: Page) {
  const health = await page.request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] }
  let novel = await (await page.request.post('/api/novels', { headers, data: { title: `虚构恢复 ${crypto.randomUUID()}`, description: '隔离测试' } })).json()
  const chapters: { id: string; title: string }[] = []
  for (const title of ['第一章', '第二章']) {
    const result = await (await page.request.post(`/api/novels/${novel.id}/chapters`, { headers, data: { title, version: novel.version } })).json()
    novel = result.novel; chapters.push(result.chapter)
  }
  return { novel, chapters, headers }
}
async function open(page: Page, name: string) {
  await page.goto('/')
  if ((page.viewportSize()?.width ?? 1440) <= 720) {
    await page.locator('.dashboard-work').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: '打开作品', exact: true }).click()
    await page.locator('.chapter-select').filter({ hasText: '第一章' }).click()
    await page.getByRole('button', { name: '专注写作', exact: true }).click()
  } else {
    await page.getByRole('navigation', { name: '小说列表' }).getByRole('button', { name }).click()
  }
}
async function failWrites(page: Page) {
  await page.route('**/api/chapters/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
}
async function drafts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('storyforge-protected-drafts', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try { return await new Promise<unknown[]>((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) }
    finally { db.close() }
  })
}
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

test('normal saves clear protected drafts and switching chapters cannot mix content', async ({ page }) => {
  const { novel } = await seed(page); await open(page, novel.title)
  await (await expectChapterReady(page, '第一章')).fill('第一章虚构正文')
  await page.getByRole('button', { name: '下一章', exact: true }).click()
  await (await expectChapterReady(page, '第二章')).fill('第二章虚构正文')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  await expect.poll(() => drafts(page)).toEqual([])
  await page.getByRole('button', { name: '上一章', exact: true }).click()
  await expectChapterReady(page, '第一章', '第一章虚构正文')
})

test('immediate refresh protects input before debounce and requires explicit recovery before any write', async ({ page }) => {
  const { novel, chapters } = await seed(page); await open(page, novel.title); await expectChapterReady(page, '第一章')
  await failWrites(page)
  await chapterBody(page).fill('立即刷新也要保留的虚构内容 🌕')
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  await expect(chapterBody(page)).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeDisabled()
  expect((await (await page.request.get(`/api/chapters/${chapters[0].id}`)).json()).version).toBe(1)
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(chapterBody(page)).toHaveText('立即刷新也要保留的虚构内容 🌕')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  await expect.poll(() => drafts(page)).toEqual([])
})

test('database conflict previews both versions and keeping the database never writes the local draft', async ({ page }) => {
  const { novel, chapters, headers } = await seed(page); await open(page, novel.title); await expectChapterReady(page, '第一章'); await failWrites(page)
  await chapterBody(page).fill('本机未同步草稿')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  const result = await page.request.put(`/api/chapters/${chapters[0].id}`, { headers, data: { version: 1, title: '第一章', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '另一窗口已保存版本' }] }] } } })
  expect(result.ok()).toBeTruthy()
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await expect(chapterBody(page)).toHaveText('另一窗口已保存版本')
  await page.getByText('查看草稿内容与版本信息', { exact: true }).click()
  await expect(page.locator('.draft-recovery')).toContainText('可能不同')
  await expect(page.locator('.draft-recovery pre')).toContainText('本机未同步草稿')
  await page.getByRole('button', { name: '保留数据库版本', exact: true }).click()
  await expectChapterReady(page, '第一章', '另一窗口已保存版本')
  await expect.poll(() => drafts(page)).toEqual([])
  expect((await (await page.request.get(`/api/chapters/${chapters[0].id}`)).json()).version).toBe(2)
})

test('several windows and chapters preserve all drafts and resolving one leaves the others intact', async ({ page, context }) => {
  const { novel, chapters } = await seed(page)
  const other = await context.newPage(); await open(page, novel.title); await open(other, novel.title)
  await expectChapterReady(page, '第一章'); await expectChapterReady(other, '第一章')
  await failWrites(page); await failWrites(other)
  await chapterBody(page).fill('同章窗口甲'); await chapterBody(other).fill('同章窗口乙')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  await expect(other.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  const third = await context.newPage(); await open(third, novel.title)
  await expect(third.getByRole('button', { name: '保留数据库版本', exact: true })).toHaveCount(2)
  // Pending choices do not prevent navigating to a different chapter.
  await third.locator('.chapter-select').filter({ hasText: '第二章' }).click()
  await expectChapterReady(third, '第二章'); await failWrites(third); await chapterBody(third).fill('另一章草稿')
  await expect(third.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  await expect.poll(async () => (await drafts(page)).length).toBe(3)
  await third.close(); await other.close(); await page.close()
  const reopened = await context.newPage(); await open(reopened, novel.title)
  await expect(reopened.getByRole('button', { name: '保留数据库版本', exact: true })).toHaveCount(2)
  await reopened.getByRole('button', { name: '保留数据库版本', exact: true }).first().click()
  await expect.poll(async () => (await drafts(reopened)).length).toBe(2)
  const stored = JSON.stringify(await drafts(reopened)); expect(stored).toContain(chapters[1].id); expect(stored).toContain('另一章草稿')
})

test('persistent browser profile restores after the browser process closes and restarts', async ({ page, baseURL, browserName }) => {
  const { novel } = await seed(page), dir = mkdtempSync(join(tmpdir(), 'storyforge-browser-profile-'))
  const browserType = { chromium, firefox, webkit }[browserName]
  // The independent profile follows the project's Chrome channel and executable.
  const chromiumOptions = browserName === 'chromium' ? { channel: process.env.E2E_CHROMIUM_CHANNEL || undefined, ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}) } : {}
  const launch = () => browserType.launchPersistentContext(dir, { baseURL, headless: true, ...chromiumOptions })
  let context = await launch()
  try {
    const first = await context.newPage(); await open(first, novel.title); await expectChapterReady(first, '第一章'); await failWrites(first)
    await chapterBody(first).fill('浏览器进程重启后的虚构草稿')
    await expect(first.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
    if (browserName === 'chromium') {
      await test.step('terminate only the isolated browser process and observe disconnection', async () => {
        await expect.poll(async () => JSON.stringify(await drafts(first))).toContain('浏览器进程重启后的虚构草稿')
        const owner = context.browser()
        if (!owner || owner === page.context().browser()) throw new Error('Expected a separately launched test browser')
        const protocol = await owner.newBrowserCDPSession()
        const { processInfo } = await protocol.send('SystemInfo.getProcessInfo')
        const pid = processInfo.find(item => item.type === 'browser')?.id
        if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid isolated browser PID')
        // The PID comes from this context's own browser, never a process-name
        // search. Kill without unload/close so recovery exercises a real crash.
        process.kill(pid, 'SIGKILL')
        await expect.poll(() => owner.isConnected()).toBe(false)
      })
    } else { await context.close() }
    context = await launch()
    const second = await context.newPage(); await open(second, novel.title)
    await second.getByRole('button', { name: '恢复此草稿', exact: true }).click()
    await expect(chapterBody(second)).toHaveText('浏览器进程重启后的虚构草稿')
    await expect(second.locator('.save-status')).toHaveText('已保存到数据库')
  } finally { await context.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('characters, world entries and reference notes recover through their original editors', async ({ page }) => {
  const { novel } = await seed(page); await open(page, novel.title)
  const modules = page.getByRole('navigation', { name: '小说工作台模块' })
  await modules.getByRole('button', { name: '人物档案', exact: true }).click()
  await page.getByRole('button', { name: '新增人物', exact: true }).first().click()
  await expect(page.getByLabel('姓名', { exact: true })).toBeEditable()
  await page.route('**/api/novels/*/characters/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await page.getByLabel('背景经历', { exact: true }).fill('人物未保存虚构背景')
  await expect(page.locator('.profile-save-status')).toHaveText('保存失败')
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await modules.getByRole('button', { name: '人物档案', exact: true }).click()
  await page.unroute('**/api/novels/*/characters/*'); await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(page.getByLabel('背景经历', { exact: true })).toHaveValue('人物未保存虚构背景')
  await expect(page.locator('.profile-save-status')).toHaveText('已保存到数据库')
  await modules.getByRole('button', { name: '世界观', exact: true }).click()
  await page.getByRole('button', { name: '新增设定', exact: true }).first().click()
  await page.route('**/api/novels/*/world/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await page.getByLabel('引用备注', { exact: true }).fill('尚未提交的资料备注')
  await page.getByLabel('设定内容', { exact: true }).fill('未保存的虚构世界设定')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toHaveCount(2)
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await modules.getByRole('button', { name: '世界观', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toHaveCount(2)
  await page.unroute('**/api/novels/*/world/*')
  await page.locator('.profile-detail > .draft-protection').getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await page.locator('.knowledge-links').getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(page.getByLabel('设定内容', { exact: true })).toHaveValue('未保存的虚构世界设定')
  await expect(page.getByLabel('引用备注', { exact: true })).toHaveValue('尚未提交的资料备注')
})

test('novel dialog inputs survive cancel and refresh without creating a novel silently', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '新建作品', exact: true }).click()
  await page.getByLabel('小说名称', { exact: true }).fill('尚未创建的虚构小说')
  await page.getByLabel('简介', { exact: true }).fill('本机简介草稿')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click(); await page.reload()
  await page.getByRole('button', { name: '新建作品', exact: true }).click()
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(page.getByLabel('简介', { exact: true })).toHaveValue('本机简介草稿')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '尚未创建的虚构小说', exact: true })).toBeVisible()
  await expect.poll(() => drafts(page)).toEqual([])
})

test('mobile recovery works with IndexedDB disabled and cleans the fallback journal after saving', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('disabled for test', 'SecurityError') } }) })
  const { novel } = await seed(page); await open(page, novel.title); await expectChapterReady(page, '第一章'); await failWrites(page)
  await chapterBody(page).fill('移动端降级草稿')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.unroute('**/api/chapters/*'); await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(chapterBody(page)).toHaveText('移动端降级草稿')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('storyforge:protected-draft:v1:')))).toEqual([])
})

test('when both browser stores fail the warning is honest and the current content can still be exported', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('disabled for test', 'SecurityError') } })
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('disabled for test', 'SecurityError') } })
  })
  const { novel } = await seed(page); await open(page, novel.title); await expectChapterReady(page, '第一章'); await failWrites(page)
  await chapterBody(page).fill('存储失败仍可手动导出的虚构内容')
  await expect(page.locator('.draft-protection')).toContainText('本机草稿存储失败')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toHaveCount(0)
  await expect(page.locator('.save-status')).toHaveText('保存失败')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出未保存草稿', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('草稿.json')
  await expect(chapterBody(page)).toHaveText('存储失败仍可手动导出的虚构内容')
})

test('legacy planning drafts transfer without silently writing back or losing incomplete titles', async ({ page }) => {
  const { novel } = await seed(page)
  const snapshot = await (await page.request.get(`/api/novels/${novel.id}/planning`)).json()
  snapshot.outlines.push({ id: crypto.randomUUID(), title: '', content: '旧版本规划的虚构草稿', kind: 'overall', parentId: null, chapterIds: [] })
  await page.goto('/')
  await page.evaluate(({ id, snapshot }) => localStorage.setItem(`storyforge:planning:draft:${id}`, JSON.stringify({ snapshot, generation: 'old-service' })), { id: novel.id, snapshot })
  await open(page, novel.title); await page.getByRole('button', { name: '创作规划', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  expect((await (await page.request.get(`/api/novels/${novel.id}/planning`)).json()).outlines).toEqual([])
  expect(await page.evaluate(id => localStorage.getItem(`storyforge:planning:draft:${id}`), novel.id)).toBeNull()
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await page.locator('.planning-items').getByRole('button', { name: /未命名/ }).click()
  await expect(page.getByRole('textbox', { name: '详细内容', exact: true })).toHaveValue('旧版本规划的虚构草稿')
  await page.getByLabel('规划标题', { exact: true }).fill('核对后的旧大纲')
  await expect(page.locator('.planning-status')).toHaveText('已保存到数据库')
  await expect.poll(() => drafts(page)).toEqual([])
})

test('planning still protects and exports offline drafts when localStorage is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('disabled for test', 'SecurityError') } }) })
  const { novel } = await seed(page); await open(page, novel.title)
  await page.getByRole('button', { name: '创作规划', exact: true }).click()
  await page.getByRole('button', { name: '新建大纲', exact: true }).click()
  await expect(page.locator('.planning-status')).toHaveText('已保存到数据库')
  await page.route('**/api/novels/*/planning', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await page.getByRole('textbox', { name: '详细内容', exact: true }).fill('仅 IndexedDB 保护的离线虚构大纲')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  await expect(page.locator('.planning-status')).toHaveText('保存失败 · 草稿已保留')
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await page.unroute('**/api/novels/*/planning')
  await page.route('**/api/novels/*/planning', route => route.abort('failed'))
  await page.getByRole('button', { name: '创作规划', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出本机规划草稿', exact: true }).click()
  const download = await pending
  const { readFileSync } = await import('node:fs')
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8')).outlines[0].content).toBe('仅 IndexedDB 保护的离线虚构大纲')
})

test('restoring an isolated database backup requires a choice before an old-generation draft can save', async ({ page }) => {
  const { novel, chapters, headers } = await seed(page)
  const backupResponse = await page.request.post('/api/backups', { headers, data: {} })
  expect(backupResponse.ok()).toBeTruthy()
  const backup = await backupResponse.json()
  await open(page, novel.title); await expectChapterReady(page, '第一章')
  await chapterBody(page).fill('备份之后已保存的虚构内容')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  await failWrites(page); await chapterBody(page).fill('备份之后尚未保存的虚构草稿')
  await expect(page.getByText('临时草稿已保护 · 此浏览器', { exact: true })).toBeVisible()
  const preparation = await page.request.post(`/api/backups/${encodeURIComponent(backup.id)}/prepare-restore`, { headers, data: {} })
  expect(preparation.ok()).toBeTruthy()
  const { token } = await preparation.json()
  const restore = await page.request.post(`/api/backups/${encodeURIComponent(backup.id)}/restore`, { headers, data: { token, confirmation: '替换当前全部数据' } })
  expect(restore.ok()).toBeTruthy()
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await open(page, novel.title)
  await expect(page.getByRole('button', { name: '恢复此草稿', exact: true })).toBeVisible()
  await expect(chapterBody(page)).toHaveAttribute('contenteditable', 'false')
  const before = await (await page.request.get(`/api/chapters/${chapters[0].id}`)).json()
  expect(before.version).toBe(1)
  await page.getByText('查看草稿内容与版本信息', { exact: true }).click()
  await expect(page.locator('.draft-recovery')).toContainText('可能不同')
  await expect(page.locator('.draft-recovery pre')).toContainText('备份之后尚未保存的虚构草稿')
  await page.unroute('**/api/chapters/*')
  await page.getByRole('button', { name: '恢复此草稿', exact: true }).click()
  await expect(chapterBody(page)).toHaveText('备份之后尚未保存的虚构草稿')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  await expect.poll(() => drafts(page)).toEqual([])
  const after = await (await page.request.get(`/api/chapters/${chapters[0].id}`)).json()
  expect(after.version).toBe(2)
  expect(after.content.content[0].content[0].text).toBe('备份之后尚未保存的虚构草稿')
})
