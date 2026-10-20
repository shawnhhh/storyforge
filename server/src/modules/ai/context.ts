import { createHash } from 'node:crypto'
import type { ContextChoice, ContextSelection, ContextPreview } from '../../../../shared/contracts/ai.js'
import { referenceKinds } from '../../../../shared/contracts/ai.js'
import { HttpError, type NovelStore } from '../novels/store.js'
import type { StoryBibleStore } from '../story-bible/store.js'
import type { PlanningStore } from '../planning/store.js'
import { renderRichText } from '../novels/export.js'

export function validateContext(value: unknown): ContextSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '引用选项无效')
  const row = value as Record<string, unknown>
  if (typeof row.maxCharacters !== 'number' || !Number.isInteger(row.maxCharacters) || row.maxCharacters < 256 || row.maxCharacters > 12000 || !Array.isArray(row.references) || row.references.length > 8 || (row.fingerprint !== undefined && (typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)))) throw new HttpError(400, '引用最多 8 项，总长度须为 256–12000 字符')
  const seen = new Set<string>()
  for (const ref of row.references) {
    if (!ref || typeof ref !== 'object' || typeof ref.kind !== 'string' || !Object.hasOwn(referenceKinds, ref.kind) || typeof ref.id !== 'string' || !ref.id || ref.id.length > 100 || seen.has(`${ref.kind}:${ref.id}`)) throw new HttpError(400, '引用类型、标识或重复项无效')
    seen.add(`${ref.kind}:${ref.id}`)
  }
  return row as unknown as ContextSelection
}
function clip(value: string, max: number) {
  const text = value.slice(0, max)
  return text.length && /[\uD800-\uDBFF]/.test(text.at(-1)!) ? text.slice(0, -1) : text
}
export class AiContext {
  constructor(private novels: NovelStore, private bible: StoryBibleStore, private planning: PlanningStore) {}
  private records(novelId: string) {
    this.novels.novel(novelId)
    return { profiles: this.bible.list(novelId), plan: this.planning.read(novelId) }
  }
  choices(chapterId: string): ContextChoice[] {
    const chapter = this.novels.chapter(chapterId)
    return this.choicesNovel(chapter.novelId).filter(row => row.kind !== 'chapter' || row.id !== chapterId)
  }
  choicesNovel(novelId: string): ContextChoice[] {
    const { profiles, plan } = this.records(novelId)
    return [
      ...profiles.characters.map(c => ({ kind: 'character' as const, id: c.id, label: c.name })),
      ...profiles.world.map(w => ({ kind: 'world' as const, id: w.id, label: w.name })),
      ...(['outlines', 'plotlines', 'cards', 'foreshadows'] as const).flatMap((key, i) => plan[key].map(item => ({ kind: (['outline', 'plotline', 'card', 'foreshadow'] as const)[i], id: item.id, label: item.title }))),
      ...this.novels.detail(novelId).chapters.map(c => ({ kind: 'chapter' as const, id: c.id, label: c.title })),
    ]
  }
  preview(chapterId: string, selection: ContextSelection, onSource?: (id: string, label: string, text: string, truncated: boolean) => void): ContextPreview {
    const chapter = this.novels.chapter(chapterId)
    return this.previewNovel(chapter.novelId, selection, chapterId, onSource)
  }
  previewNovel(novelId: string, selection: ContextSelection, chapterId?: string, onSource?: (id: string, label: string, text: string, truncated: boolean) => void): ContextPreview {
    const { profiles, plan } = this.records(novelId)
    const versions: (string | number)[] = []
    const records = selection.references.map(ref => {
      let label: string, text: string, version: number
      if (ref.kind === 'character') {
        const row = profiles.characters.find(c => c.id === ref.id)
        if (!row) throw new HttpError(404, '引用人物不存在或不属于本小说')
        label = row.name; text = JSON.stringify({ category: row.category, tags: row.tags, fields: row.fields, relations: row.relations }); version = row.version
      } else if (ref.kind === 'world') {
        const row = profiles.world.find(w => w.id === ref.id)
        if (!row) throw new HttpError(404, '引用世界观不存在或不属于本小说')
        label = row.name; text = `${row.description}\n${row.timeText}`; version = row.version
      } else if (ref.kind === 'chapter') {
        const row = this.novels.chapter(ref.id)
        if (row.novelId !== novelId || row.id === chapterId) throw new HttpError(400, '只能引用本小说其他章节')
        label = row.title; text = renderRichText(row.content, false); version = row.version
      } else {
        const key = { outline: 'outlines', plotline: 'plotlines', card: 'cards', foreshadow: 'foreshadows' }[ref.kind] as 'outlines' | 'plotlines' | 'cards' | 'foreshadows'
        const row = plan[key].find(item => item.id === ref.id)
        if (!row) throw new HttpError(404, '引用规划不存在或不属于本小说')
        label = row.title; text = JSON.stringify(row); version = plan.version
      }
      versions.push(ref.id, version)
      return { ...ref, label, text }
    })
    // Allocate a fair share to each source; headers count toward the same hard budget.
    const share = Math.floor(selection.maxCharacters / Math.max(1, records.length))
    const pieces: string[] = []
    const sources = records.map(row => {
      const heading = clip(`【${referenceKinds[row.kind]}：${clip(row.label, 40)}】\n`, share - 2)
      const allowance = Math.max(0, share - heading.length - 2)
      const text = clip(row.text, allowance)
      pieces.push(`${heading}${text}\n\n`)
      onSource?.(`${row.kind}:${row.id}`, row.label, text, text.length < row.text.length)
      return { kind: row.kind, id: row.id, label: row.label, characters: text.length, originalCharacters: row.text.length, truncated: text.length < row.text.length }
    })
    const text = pieces.join('')
    const fingerprint = createHash('sha256').update(JSON.stringify({ novelId, chapterId, versions, text, selection: { references: selection.references, maxCharacters: selection.maxCharacters } })).digest('hex')
    return { text, fingerprint, characters: text.length, sources }
  }
}
