import test from 'node:test'
import assert from 'node:assert/strict'
import type { StudioProject } from '../../shared/contracts/studio.js'
import { defaultMusicConfiguration, musicConfiguration, mockMusicAdapter } from '../../src/features/music/provider.js'
const project = (): StudioProject => ({ id: 'fictional-song', kind: 'music', title: '夜航', content: '[主歌]\n月光照亮归途', settings: {}, version: 1, createdAt: '', updatedAt: '' })
test('music configuration supplies isolated defaults for older projects', () => {
  const first = musicConfiguration(project()); first.structure.push('桥段')
  assert.deepEqual(musicConfiguration(project()), defaultMusicConfiguration)
})
test('music provider adapter preserves lyrics, tempo, mood and song structure without mutating project', () => {
  const song = project(); song.settings = { genre: '爵士', mood: '沉静', tempo: 84, structure: ['主歌', '桥段', '尾奏'] }
  const before = structuredClone(song), prompt = mockMusicAdapter.prompt(song)
  for (const value of ['爵士', '沉静', '84 BPM', '主歌 → 桥段 → 尾奏', song.content]) assert.ok(prompt.includes(value))
  assert.deepEqual(song, before)
})
