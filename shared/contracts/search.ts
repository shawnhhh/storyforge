export const searchKinds = {
  novel: '小说', chapter: '章节', character: '人物', world: '世界观',
  outlines: '大纲', plotlines: '剧情线', cards: '剧情卡片', foreshadows: '伏笔',
} as const
export type SearchKind = keyof typeof searchKinds
export interface SearchHit {
  id: string; novelId: string; novelTitle: string; kind: SearchKind; title: string; excerpt: string
}
export interface SearchResults { hits: SearchHit[]; hasMore: boolean }
