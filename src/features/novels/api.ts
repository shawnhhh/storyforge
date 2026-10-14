import type { Chapter, ChapterResult, Novel, NovelDetail, RichTextDocument } from '../../../shared/contracts/novels.js'
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '本地服务不可用' })) as { message?: string }
    throw new ApiError(response.status, error.message ?? '请求失败')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export const api = {
  list: () => request<Novel[]>('/novels'),
  detail: (id: string) => request<NovelDetail>(`/novels/${id}`),
  create: (title: string, description: string) => request<Novel>('/novels', 'POST', { title, description }),
  update: (novel: Novel, title: string, description: string) => request<Novel>(`/novels/${novel.id}`, 'PATCH', { version: novel.version, title, description }),
  remove: (novel: Novel) => request<void>(`/novels/${novel.id}`, 'DELETE', { version: novel.version }),
  chapter: (id: string) => request<Chapter>(`/chapters/${id}`),
  createChapter: (novel: Novel, title: string) => request<ChapterResult>(`/novels/${novel.id}/chapters`, 'POST', { version: novel.version, title }),
  save: (id: string, version: number, title: string, content: RichTextDocument) => request<ChapterResult>(`/chapters/${id}`, 'PUT', { version, title, content }),
  deleteChapter: (chapter: Chapter, novel: Novel) => request<NovelDetail>(`/chapters/${chapter.id}`, 'DELETE', { version: chapter.version, novelVersion: novel.version }),
  reorder: (novel: Novel, chapterIds: string[]) => request<NovelDetail>(`/novels/${novel.id}/chapter-order`, 'PUT', { version: novel.version, chapterIds }),
}
