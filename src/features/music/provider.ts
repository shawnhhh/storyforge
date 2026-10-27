import { studioPrompts, type StudioProject } from '../../../shared/contracts/studio.js'
export interface MusicConfiguration { genre: string; mood: string; tempo: number; structure: string[] }
export const defaultMusicConfiguration: MusicConfiguration = { genre: '流行', mood: '温暖', tempo: 100, structure: ['主歌', '副歌', '主歌', '副歌', '尾奏'] }
export function musicConfiguration(project: StudioProject): MusicConfiguration {
  return { genre: String(project.settings.genre ?? '流行'), mood: String(project.settings.mood ?? '温暖'), tempo: Number(project.settings.tempo ?? 100), structure: Array.isArray(project.settings.structure) ? project.settings.structure.map(String) : [...defaultMusicConfiguration.structure] }
}
/** Adapt the editor's musical intent to the shared provider boundary, without network access. */
export interface MusicPromptAdapter { readonly id: string; prompt(project: StudioProject): string }
export const mockMusicAdapter: MusicPromptAdapter = { id: 'mock-music', prompt(project) {
  const config = musicConfiguration(project)
  return `${studioPrompts.music}\nMock 音乐试听；曲风：${config.genre}；情绪：${config.mood}；速度：${config.tempo} BPM；结构：${config.structure.join(' → ')}。歌词：\n${project.content}`
} }
