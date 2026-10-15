export const worldCategories = { location: '地点', organization: '势力组织', power: '力量体系', history: '历史事件', other: '其他设定' } as const
export type WorldCategory = keyof typeof worldCategories
export const characterFields = {
  aliases: '别名', gender: '性别', age: '年龄', identity: '身份', appearance: '外貌',
  personality: '性格', background: '背景经历', goals: '人物目标', arc: '角色成长线', notes: '备注',
} as const
export type CharacterFields = Record<keyof typeof characterFields, string>
export interface CharacterInput {
  name: string
  category: string
  tags: string[]
  fields: CharacterFields
  relations: { targetId: string; kind: string }[]
  worldIds: string[]
}
export interface WorldInput {
  name: string
  category: WorldCategory
  tags: string[]
  description: string
  timeText: string
  sortOrder: number
  onTimeline: boolean
}
export interface RecordMeta { id: string; novelId: string; version: number; createdAt: string; updatedAt: string }
export interface Character extends CharacterInput, RecordMeta {}
export interface WorldEntry extends WorldInput, RecordMeta {}
export interface StoryBible { characters: Character[]; world: WorldEntry[] }
