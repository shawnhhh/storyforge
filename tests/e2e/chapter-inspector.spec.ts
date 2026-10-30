import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { chapterBody, expectChapterReady } from './editor-helpers.js'

const inspector = (page: Page) => page.getByRole('complementary', { name: '章节关联检查器', exact: true })
async function seed(page: Page) {
  const health = await page.request.get('/api/health')
  const headers = { 'X-StoryForge-Generation': health.headers()['x-storyforge-generation'] ?? '' }
  const post = async (path: string, data: unknown) => {
    const result = await page.request.post(`/api${path}`, { headers, data }); expect(result.ok()).toBe(true); return result.json()
  }
  const put = async (path: string, data: unknown) => {
    const result = await page.request.put(`/api${path}`, { headers, data }); expect(result.ok()).toBe(true); return result.json()
  }
  const novel = await post('/novels', { title: `雾港来信 · ${crypto.randomUUID().slice(0, 6)}`, description: '全部为隔离数据库中的虚构验收资料' })
  const root = `/novels/${novel.id}`
  const first = await post(root + '/chapters', { version: novel.version, title: '第一章 · 归港' })
  const saved = await put(`/chapters/${first.chapter.id}`, { version: first.chapter.version, title: first.chapter.title, content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '海雾沿着石阶漫上来。顾遥收起信，望向港口尽头的灯塔。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '她在潮声里辨认出熟悉的脚步。旧日的约定，终于有了回音。' }] },
  ] } })
  const second = await post(root + '/chapters', { version: saved.novel.version, title: '第二章 · 灯火' })
  const place = await post(root + '/world', { ...newWorld(), name: '雾港', description: '海风与潮汐塑造的古老港城。入夜后，灯塔为归船指引航向。', tags: ['地点', '海岸'] })
  const organization = await post(root + '/world', { ...newWorld('organization'), name: '守灯人协会', description: '维护沿岸灯塔与航海档案的组织。' })
  const history = await post(root + '/world', { ...newWorld('history'), name: '旧港封航', description: '一封未寄出的信，记录了旧港关闭的那一夜。', timeText: '雾历十七年', sortOrder: 1 })
  const guide = await post(root + '/characters', { ...newCharacter(), name: '陈泊', fields: { ...newCharacter().fields, identity: '灯塔守望者', personality: '寡言而可靠' } })
  const hero = await post(root + '/characters', { ...newCharacter(), name: '顾遥', category: '主角', fields: { ...newCharacter().fields, identity: '归航的记录员', goals: '寻找那封信的寄件人' }, relations: [{ targetId: guide.id, kind: '旧识' }], worldIds: [place.id] })
  const knowledge = await put(root + '/knowledge-links', { version: 0, links: [
    { id: 'hero-chapter', source: { kind: 'chapter', id: first.chapter.id }, target: { kind: 'character', id: hero.id }, label: '出场人物', note: '' },
    { id: 'place-chapter', source: { kind: 'chapter', id: first.chapter.id }, target: { kind: 'world', id: place.id }, label: '故事地点', note: '核对海岸与灯塔的位置' },
    { id: 'history-chapter', source: { kind: 'chapter', id: first.chapter.id }, target: { kind: 'world', id: history.id }, label: '提及事件', note: '' },
    { id: 'place-organization', source: { kind: 'world', id: place.id }, target: { kind: 'world', id: organization.id }, label: '驻地组织', note: '' },
  ] })
  const planning = emptyPlanning()
  planning.plotlines.push({ id: 'main', title: '归航与寻信', content: '追寻一封旧信，重新连接离散的人。', kind: 'main' }, { id: 'subplot', title: '守灯人的约定', content: '陈泊等待一位失约的故人。', kind: 'subplot' })
  planning.outlines.push({ id: 'outline', kind: 'chapter', parentId: null, title: '归港大纲', content: '重返故乡，发现灯塔里的第一条线索。', chapterIds: [first.chapter.id] })
  for (const [id, plotlineId, title] of [['card-main', 'main', '雾中重逢'], ['card-subplot', 'subplot', '灯塔来信']] as const) planning.cards.push({ id, title, content: '在旧码头会面，交换一条关于寄件人的线索。', summary: '顾遥与陈泊重逢', status: 'writing', plotlineId, storyTime: '归航日 · 清晨', timeOrder: 2, chapterIds: [first.chapter.id], characterIds: [hero.id, guide.id], worldIds: [place.id] })
  planning.foreshadows.push({ id: 'foreshadow', title: '信封上的灯塔印记', content: '印记与旧港封航档案上的图案一致。', status: 'planted', plantedChapterIds: [first.chapter.id], plannedChapterIds: [second.chapter.id], resolvedChapterIds: [], chapterIds: [], cardIds: ['card-main'] })
  await put(root + '/planning', { version: 0, ...planning })
  await page.goto('/')
  await page.getByRole('navigation', { name: '小说列表', exact: true }).getByRole('button', { name: novel.title }).click()
  await expectChapterReady(page, first.chapter.title)
  await expect(inspector(page).getByRole('button', { name: `查看人物档案 ${hero.name}`, exact: true })).toBeVisible()
  return { novel, first: saved.chapter, second: second.chapter, place, organization, history, hero, guide, headers, root, knowledge }
}

test('chapter inspector reads real linked profiles, relations, world and planning while preserving editor identity and cursor', async ({ page }) => {
  const f = await seed(page), panel = inspector(page), body = chapterBody(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const original = await body.elementHandle()
  await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.focus(); editor.commands.setTextSelection({ from: 3, to: 7 })
  })
  const nativeSelection = await body.evaluate(() => { const range = getSelection()!.getRangeAt(0); return { start: range.startOffset, end: range.endOffset, text: getSelection()!.toString() } })
  const requests: string[] = []
  page.on('request', request => { if (/\/(story-bible|planning|knowledge-links)$/.test(request.url())) requests.push(request.url()) })
  for (const name of ['世界观', '剧情', '人物']) {
    await panel.getByRole('tab', { name, exact: true }).click()
    expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
    expect(await body.evaluate(element => { const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection; return [from, to] })).toEqual([3, 7])
    expect(await body.evaluate(() => { const range = getSelection()!.getRangeAt(0); return { start: range.startOffset, end: range.endOffset, text: getSelection()!.toString() } })).toEqual(nativeSelection)
  }
  expect(requests).toEqual([])
  await panel.getByRole('button', { name: '查看人物档案 顾遥', exact: true }).click()
  await expect(panel.getByRole('region', { name: '人物档案 顾遥', exact: true })).toContainText('归航的记录员')
  await expect(panel.getByRole('img', { name: '当前章节人物关系图', exact: true })).toBeVisible()
  await expect(panel.locator('.inspector-relations')).toContainText('顾遥'); await expect(panel.locator('.inspector-relations')).toContainText('旧识'); await expect(panel.locator('.inspector-relations')).toContainText('陈泊')
  await panel.getByRole('tab', { name: '世界观', exact: true }).click()
  await panel.getByRole('button', { name: '查看世界观资料 雾港', exact: true }).click()
  await expect(panel.getByRole('region', { name: '世界观资料 雾港', exact: true })).toContainText('海风与潮汐')
  await panel.getByRole('button', { name: '驻地组织 · 守灯人协会 ›', exact: true }).click()
  await expect(panel.getByRole('region', { name: '世界观资料 守灯人协会', exact: true })).toContainText('维护沿岸灯塔')
  await panel.getByRole('tab', { name: '剧情', exact: true }).click()
  for (const text of ['归航与寻信', '守灯人的约定', '归港大纲', '雾中重逢', '信封上的灯塔印记', '旧港封航']) await expect(panel).toContainText(text)
  await expect(panel.getByRole('region', { name: '本章时间线事件', exact: true })).toContainText('雾历十七年')
  await page.getByRole('button', { name: '收起检查器', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: '展开检查器', exact: true }).click()
  await expect(panel).toBeVisible()
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
  expect(await (await page.request.get(`/api/chapters/${f.first.id}`)).json()).toEqual(f.first)
  expect(errors).toEqual([])
})

test('chapter association writes survive refresh, stay chapter scoped and reject concurrent versions without touching prose', async ({ page }) => {
  const f = await seed(page), panel = inspector(page)
  await panel.getByLabel('选择章节关联人物', { exact: true }).selectOption(f.guide.id)
  await page.route('**/knowledge-links', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue())
  await panel.getByRole('button', { name: '添加关联', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByLabel('选择章节关联人物')).toHaveValue(f.guide.id)
  await page.unroute('**/knowledge-links')
  const concurrent = await page.request.put('/api' + f.root + '/knowledge-links', { headers: f.headers, data: { ...f.knowledge, links: [...f.knowledge.links, { id: 'concurrent', source: { kind: 'chapter', id: f.second.id }, target: { kind: 'world', id: f.organization.id }, label: '另一窗口的关联', note: '' }] } })
  expect(concurrent.ok()).toBe(true)
  await panel.getByRole('button', { name: '添加关联', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('刷新资料并核对')
  await expect(panel.getByLabel('选择章节关联人物')).toBeDisabled()
  await expect(panel.getByLabel('选择章节关联人物')).toHaveValue(f.guide.id)
  await panel.getByRole('button', { name: '刷新资料', exact: true }).click()
  await expect(panel.getByLabel('选择章节关联人物')).toBeEnabled()
  await panel.getByRole('button', { name: '添加关联', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看人物档案 陈泊', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一章', exact: true }).click()
  await expectChapterReady(page, f.second.title)
  await expect(panel.getByRole('button', { name: '查看人物档案 陈泊', exact: true })).toHaveCount(0)
  await panel.getByRole('tab', { name: '世界观', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看世界观资料 守灯人协会', exact: true })).toBeVisible()
  await panel.getByLabel('选择章节关联设定').selectOption(f.place.id)
  await panel.getByRole('button', { name: '添加关联', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看世界观资料 雾港', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('navigation', { name: '小说列表', exact: true }).getByRole('button', { name: f.novel.title }).click()
  await expectChapterReady(page, f.first.title)
  await expect(panel.getByRole('button', { name: '查看人物档案 陈泊', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await panel.getByRole('button', { name: '取消章节关联 陈泊', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看人物档案 陈泊', exact: true })).toHaveCount(0)
  const links = (await (await page.request.get('/api' + f.root + '/knowledge-links')).json()).links
  expect(links.some((link: { id: string }) => link.id === 'concurrent')).toBe(true)
  expect(await (await page.request.get(`/api/chapters/${f.first.id}`)).json()).toEqual(f.first)
})

test('inspector tabs preserve simulated Chinese composition and capture real running light and dark chapter links', async ({ page, browserName }) => {
  await seed(page)
  const panel = inspector(page), body = chapterBody(page), original = await body.elementHandle()
  await body.focus()
  await body.press('ControlOrMeta+End')
  await body.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.insertText('她听见了海的回声。')
  for (const name of ['世界观', '剧情', '人物']) await panel.getByRole('tab', { name, exact: true }).click()
  expect(await body.evaluate((element, before) => element === before, original)).toBe(true)
  await body.dispatchEvent('compositionend', { data: '她听见了海的回声。' })
  await expect(body).toContainText('她听见了海的回声。')
  await expect(page.locator('.save-status')).toHaveText('已保存到数据库')
  const screenshots = resolve('docs/acceptance/apple-ui')
  const capture = async (name: string, width: number, theme: string) => {
    const filename = `${name}-${theme}-${width}.png`
    const path = process.env.E2E_APPLE_SCREENSHOTS && browserName === 'chromium' ? (mkdirSync(screenshots, { recursive: true }), resolve(screenshots, filename)) : test.info().outputPath(filename)
    await page.screenshot({ path }); await test.info().attach(filename, { path, contentType: 'image/png' })
  }
  for (const width of [1440, 1280]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await panel.getByRole('tab', { name: '人物', exact: true }).click()
    await panel.getByRole('button', { name: '查看人物档案 顾遥', exact: true }).click()
    await panel.locator('.inspector-content').evaluate(element => { element.scrollTop = 0 })
    await capture('novel-inspector', width, theme)
    await panel.getByRole('img', { name: '当前章节人物关系图', exact: true }).scrollIntoViewIfNeeded()
    await capture('character-relations', width, theme)
    await panel.getByRole('tab', { name: '世界观', exact: true }).click()
    await panel.getByRole('button', { name: '查看世界观资料 雾港', exact: true }).click()
    await panel.locator('.inspector-content').evaluate(element => { element.scrollTop = 0 })
    await capture('world-links', width, theme)
    await panel.getByRole('tab', { name: '剧情', exact: true }).click()
    await panel.locator('.inspector-content').evaluate(element => { element.scrollTop = 0 })
    await capture('plot-links', width, theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('legacy reference editor and inspector share acknowledged revisions without refetching or overwriting either panel', async ({ page }) => {
  const f = await seed(page), panel = inspector(page)
  const before = await (await page.request.get(`/api/chapters/${f.first.id}`)).json()
  await page.getByRole('button', { name: '查阅与引用创作资料', exact: true }).click()
  const references = page.getByRole('region', { name: '章节资料引用', exact: true })
  await expect(references.getByLabel('引用资料')).toBeEnabled()
  const reads: string[] = []
  page.on('request', request => { if (request.method() === 'GET' && request.url().endsWith('/knowledge-links')) reads.push(request.url()) })
  await panel.getByLabel('选择章节关联人物').selectOption(f.guide.id)
  await panel.getByRole('button', { name: '添加关联', exact: true }).click()
  await expect(references.getByRole('button', { name: '陈泊', exact: true })).toBeVisible()
  await references.getByLabel('引用资料').selectOption({ label: '守灯人协会 · 势力组织' })
  await references.getByLabel('引用用途').fill('案件背景')
  await references.getByLabel('引用备注').fill('旧引用面板保存的备注同样可实时查阅')
  await references.getByRole('button', { name: '添加引用', exact: true }).click()
  await panel.getByRole('tab', { name: '世界观', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看世界观资料 守灯人协会', exact: true })).toBeVisible()
  await expect(panel).toContainText('旧引用面板保存的备注同样可实时查阅')
  expect(reads).toEqual([])
  const snapshot = await (await page.request.get('/api' + f.root + '/knowledge-links')).json()
  expect(snapshot.links.some((link: { target: { id: string } }) => link.target.id === f.guide.id)).toBe(true)
  expect(snapshot.links.some((link: { note: string }) => link.note === '旧引用面板保存的备注同样可实时查阅')).toBe(true)
  expect(await (await page.request.get(`/api/chapters/${f.first.id}`)).json()).toEqual(before)
})
