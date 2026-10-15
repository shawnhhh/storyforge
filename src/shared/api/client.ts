let generation: string | null = null
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(generation ? { 'X-StoryForge-Generation': generation } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!generation && response.ok) generation = response.headers.get('X-StoryForge-Generation')
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '本地服务不可用' })) as { message?: string }
    throw new ApiError(response.status, error.message ?? '请求失败')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

// Same-origin reads share the restore generation with all modules.
export function getJson<T>(path: `/api/${string}`): Promise<T> {
  return request<T>(path.slice(4))
}
