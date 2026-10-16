import { characterFields, worldCategories, type CharacterInput, type WorldInput, type Character, type WorldEntry, type WorldCategory, type StoryBible } from '../../../shared/contracts/story-bible.js'

export function newCharacter(): CharacterInput {
  return { name: '新人物', category: '', tags: [], fields: Object.fromEntries(Object.keys(characterFields).map(key => [key, ''])) as CharacterInput['fields'], relations: [], worldIds: [] }
}
export function newWorld(category: WorldCategory = 'location'): WorldInput {
  return { name: '新设定', category, tags: [], description: '', timeText: '', sortOrder: 0, onTimeline: category === 'history' }
}
export function validateProfile(value: Character | WorldEntry) {
  if (!value.name.trim()) return '名称不能为空；当前草稿尚未保存。'
  if ('sortOrder' in value && (!Number.isSafeInteger(value.sortOrder) || Math.abs(value.sortOrder) > 1e9)) return '时间线顺序须为 -1000000000 至 1000000000 的整数。'
  return ''
}
export function matchesProfile(value: Character | WorldEntry, query: string, tag: string, category: string) {
  if (tag && !value.tags.includes(tag)) return false
  if (category && value.category !== category) return false
  const content = 'fields' in value ? Object.values(value.fields).join(' ') : `${value.description} ${value.timeText} ${worldCategories[value.category]}`
  return `${value.name} ${value.category} ${value.tags.join(' ')} ${content}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
export function timelineEntries(entries: WorldEntry[]) {
  return entries.filter(item => item.onTimeline).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export function profileRecords(data: StoryBible, mode: 'characters' | 'world' | 'library'): (Character | WorldEntry)[] {
  return mode === 'library' ? [...data.characters, ...data.world] : data[mode]
}
export function matchesKnowledge(value: Character | WorldEntry, query: string, tag: string, category: string, type: string) {
  const character = 'fields' in value
  if (type === 'characters' && !character) return false
  if (type === 'world' && character) return false
  if (type && !['characters', 'world'].includes(type) && (character || value.category !== type)) return false
  return matchesProfile(value, query, tag, category)
}
