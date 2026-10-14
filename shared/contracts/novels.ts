export interface RichTextNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: RichTextNode[]
}
export interface RichTextDocument extends RichTextNode {
  type: 'doc'
}
export interface Novel {
  id: string
  title: string
  description: string
  version: number
  createdAt: string
  updatedAt: string
}
export interface ChapterSummary {
  id: string
  novelId: string
  title: string
  position: number
  version: number
  updatedAt: string
}
export interface Chapter extends ChapterSummary {
  content: RichTextDocument
  contentSchemaVersion: number
}
export interface NovelDetail {
  novel: Novel
  chapters: ChapterSummary[]
}
export interface ChapterResult {
  chapter: Chapter
  novel: Novel
}
