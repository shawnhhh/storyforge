import { characterFields, worldCategories, type CharacterInput, type WorldInput } from '../../../../shared/contracts/story-bible.js'
import { HttpError } from '../novels/store.js'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '资料格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `请输入${required ? '非空' : ''}文本（最多 ${max} 字符）`)
  return required ? value.trim() : value
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `列表格式无效或超过 ${max} 项`)
  return value
}
function unique<T>(items: T[], keys: string[]): T[] {
  if (new Set(keys).size !== keys.length) throw new HttpError(400, '标签或关联不能重复')
  return items
}
function tags(value: unknown) {
  const items = array(value, 50).map(item => text(item, 80, true))
  return unique(items, items)
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new HttpError(400, '缺少有效的数据版本号')
  return value
}
export function characterInput(value: unknown): CharacterInput {
  const row = object(value), fields = object(row.fields)
  const normalizedFields = Object.fromEntries(Object.keys(characterFields).map(key => [key, text(fields[key], 20000)])) as CharacterInput['fields']
  const relations = array(row.relations, 200).map(item => {
    const relation = object(item)
    return { targetId: text(relation.targetId, 100, true), kind: text(relation.kind, 80, true) }
  })
  const worldIds = array(row.worldIds, 200).map(item => text(item, 100, true))
  return {
    name: text(row.name, 200, true), category: text(row.category, 80), tags: tags(row.tags), fields: normalizedFields,
    relations: unique(relations, relations.map(item => JSON.stringify([item.targetId, item.kind]))), worldIds: unique(worldIds, worldIds),
  }
}
export function worldInput(value: unknown): WorldInput {
  const row = object(value)
  if (typeof row.category !== 'string' || !Object.hasOwn(worldCategories, row.category)) throw new HttpError(400, '世界观分类无效')
  if (typeof row.sortOrder !== 'number' || !Number.isSafeInteger(row.sortOrder) || Math.abs(row.sortOrder) > 1e9) throw new HttpError(400, '时间线顺序须为 -1000000000 至 1000000000 的整数')
  if (typeof row.onTimeline !== 'boolean') throw new HttpError(400, '时间线开关无效')
  return { name: text(row.name, 200, true), category: row.category as WorldInput['category'], tags: tags(row.tags), description: text(row.description, 100000), timeText: text(row.timeText, 200), sortOrder: row.sortOrder, onTimeline: row.onTimeline }
}
