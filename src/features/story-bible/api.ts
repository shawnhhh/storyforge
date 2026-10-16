import type { KnowledgeSnapshot } from '../../../shared/contracts/knowledge.js'
import type { Character, CharacterInput, WorldEntry, WorldInput, StoryBible, RecordMeta } from '../../../shared/contracts/story-bible.js'
import { request } from '../../shared/api/client.js'

const base = (novelId: string) => `/novels/${encodeURIComponent(novelId)}`
export const storyApi = {
  links: (novelId: string) => request<KnowledgeSnapshot>(`${base(novelId)}/knowledge-links`),
  saveLinks: (novelId: string, snapshot: KnowledgeSnapshot) => request<KnowledgeSnapshot>(`${base(novelId)}/knowledge-links`, 'PUT', { ...snapshot, confirmed: true }),
  list: (novelId: string) => request<StoryBible>(`${base(novelId)}/story-bible`),
  createCharacter: (novelId: string, input: CharacterInput) => request<Character>(`${base(novelId)}/characters`, 'POST', input),
  createWorld: (novelId: string, input: WorldInput) => request<WorldEntry>(`${base(novelId)}/world`, 'POST', input),
  saveCharacter: (record: Character) => request<Character>(`${base(record.novelId)}/characters/${encodeURIComponent(record.id)}`, 'PUT', { ...record, confirmed: true }),
  saveWorld: (record: WorldEntry) => request<WorldEntry>(`${base(record.novelId)}/world/${encodeURIComponent(record.id)}`, 'PUT', { ...record, confirmed: true }),
  remove: (kind: 'characters' | 'world', record: RecordMeta) => request<void>(`${base(record.novelId)}/${kind}/${encodeURIComponent(record.id)}`, 'DELETE', { version: record.version, confirmed: true }),
}
