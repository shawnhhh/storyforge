export interface KnowledgeLink {
  id: string
  source: { kind: 'world' | 'chapter'; id: string }
  target: { kind: 'world' | 'character'; id: string }
  label: string
  note: string
}
export interface KnowledgeSnapshot { version: number; links: KnowledgeLink[] }
