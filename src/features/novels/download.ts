import { ApiError } from './api'

export async function downloadNovel(id: string, title: string, format: 'markdown' | 'txt' | 'json') {
  const response = await fetch(`/api/novels/${encodeURIComponent(id)}/export?format=${format}`)
  if (!response.ok) {
    const error = await response.json() as { message?: string }
    throw new ApiError(response.status, error.message ?? '导出失败')
  }
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : `${title}.${format === 'markdown' ? 'md' : format}`
  const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove()
  // Safari may consume the object URL after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
