import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeLyrics, lyricsTextFilename } from '../../src/features/music/lyrics-outline.js'

test('lyrics outline locates bilingual sections without changing the source', () => {
  const text = '[主歌 1]\n早晨的光\n\n[副歌]\n再次歌唱\n[Bridge]\nStay here'
  const before = text
  const result = analyzeLyrics(text)
  assert.deepEqual(result.sections.map(s => [s.title, s.line]), [['主歌 1', 1], ['副歌', 4], ['Bridge', 6]])
  assert.ok(result.sections.every(s => text.slice(s.offset).startsWith('[')))
  assert.equal(result.lyricLines, 3)
  assert.equal(result.lyricCharacters, 4 + 4 + 8)
  assert.equal(text, before)
})

test('lyrics outline preserves UTF-16 offsets and CRLF line positions', () => {
  const text = '🌙云\r\n[Verse 1]\r\n夜光\r\n[Chorus 2]\r\n长夜'
  const result = analyzeLyrics(text)
  assert.deepEqual(result.sections.map(s => s.line), [2, 4])
  for (const s of result.sections) assert.ok(text.slice(s.offset).startsWith('['))
  assert.equal(result.lyricLines, 3)
  assert.equal(result.lyricCharacters, 2 + 2 + 2)
})

test('lyrics outline ignores ordinary brackets, blank lines and empty input', () => {
  assert.deepEqual(analyzeLyrics(''), { sections: [], lyricCharacters: 0, lyricLines: 0 })
  const result = analyzeLyrics('[灯光闪烁]\n[Am] 歌词\n[Pre-Chorus]\n好久不见')
  assert.deepEqual(result.sections.map(s => s.title), ['Pre-Chorus'])
  assert.equal(result.lyricLines, 3)
  assert.equal(result.lyricCharacters, 6 + 6 + 4)
})

test('lyrics TXT download filenames do not expose unsafe path separators', () => {
  assert.equal(lyricsTextFilename('海风: /夜航*?'), '海风_ _夜航__.txt')
  assert.equal(lyricsTextFilename('   '), 'music-lyrics.txt')
  assert.equal(lyricsTextFilename('..'), 'music-lyrics.txt')
})
