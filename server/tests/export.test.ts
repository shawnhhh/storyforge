import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { exportNovel, renderRichText, safeFilename } from '../src/modules/novels/export.js'
import { createApp } from '../src/app.js'

test('Markdown, TXT and JSON preserve Chinese, rich text, real chapter order and metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-export-test-')), db = openDatabase(dir), store = new NovelStore(db)
  try {
    const novel = store.create('中文/小说：🌕 *特别*', '简介 <&>')
    const a = store.createChapter(novel.id, novel.version, '第一章：初见')
    const b = store.createChapter(novel.id, a.novel.version, '第二章')
    const content = { type: 'doc' as const, content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '小标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '中文 & <人物> *星*', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序项目' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套项目' }] }] }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用' }] }] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const value = `中文`;\n```' }] },
      { type: 'horizontalRule' },
    ] }
    const saved = store.saveChapter(a.chapter.id, 1, a.chapter.title, content)
    store.reorder(novel.id, saved.novel.version, [b.chapter.id, a.chapter.id])
    const before = store.chapter(a.chapter.id)
    const md = exportNovel(store, novel.id, 'markdown')
    assert.ok(md.body.indexOf('## 第二章') < md.body.indexOf('## 第一章'))
    assert.match(md.body, /### 小标题/)
    assert.ok(md.body.includes('**中文 & \\<人物\\> \\*星\\***'))
    assert.match(md.body, /3\. 有序项目\n {3}\n {3}- 嵌套项目/)
    assert.match(md.body, /> 引用/)
    assert.match(md.body, /````js/)
    const txt = exportNovel(store, novel.id, 'txt')
    assert.ok(txt.body.includes('中文 & <人物> *星*\n下一行'))
    assert.match(txt.body, /小标题\n\n/)
    const json = JSON.parse(exportNovel(store, novel.id, 'json').body)
    assert.equal(json.formatVersion, 1)
    assert.equal(json.novel.id, novel.id)
    assert.deepEqual(json.chapters.map((row: { id: string }) => row.id), [b.chapter.id, a.chapter.id])
    assert.deepEqual(json.chapters[1].content, content)
    assert.equal(json.chapters[1].contentSchemaVersion, 1)
    assert.ok(json.chapters[1].createdAt)
    assert.throws(() => exportNovel(store, novel.id, 'pdf'))
    assert.throws(() => exportNovel(store, 'missing', 'json'))
    assert.deepEqual(store.chapter(a.chapter.id), before)
    assert.equal(safeFilename('../a/b\\c\n<>|'), '_a_b_c____')
    assert.equal(safeFilename('...'), '小说')
    assert.doesNotThrow(() => encodeURIComponent(safeFilename('🌕'.repeat(100))))
    assert.doesNotThrow(() => encodeURIComponent(safeFilename('a\ud800b')))
    const empty = store.create('空小说', '')
    assert.deepEqual(JSON.parse(exportNovel(store, empty.id, 'json').body).chapters, [])
    assert.equal(renderRichText({ type: 'paragraph' }, true), '\n\n')
  } finally {
    db.close(); rmSync(dir, { recursive: true, force: true })
  }
})


test('HTTP export uses UTF-8 attachment filenames and rejects unknown formats', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-export-http-')), db = openDatabase(dir), store = new NovelStore(db)
  const server = createApp(db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const novel = store.create('中文/小说🌕', '')
    for (const format of ['markdown', 'txt', 'json']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/novels/${novel.id}/export?format=${format}`)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('Content-Type')!, /charset=utf-8/i)
      assert.ok(response.headers.get('Content-Disposition')?.includes("filename*=UTF-8''%E4%B8%AD%E6%96%87"))
      assert.ok((await response.text()).includes('中文'))
    }
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/novels/${novel.id}/export?format=pdf`)).status, 400)
  } finally {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
  }
})
