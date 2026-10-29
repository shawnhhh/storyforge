import type { ReactNode } from 'react'
import './studio.css'
export function StudioFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="studio-frame"><header><a href="#story">StoryForge</a><nav aria-label="创作模块"><a href="#story">小说</a><a href="#music">音乐</a><a href="#video">视频</a></nav><h1>{title}</h1></header>{children}</main>
}

export function TaskProgress({ status, progress }: { status: string; progress: number }) {
  return <div role="status"><span>{status} · {progress}%</span><progress aria-label="生成进度" max={100} value={progress} /></div>
}
export function AssetPreview({ id, mime, name }: { id: string; mime: string; name: string }) {
  const source = `/api/studio/assets/${encodeURIComponent(id)}/content`
  return <figure>{mime.startsWith('audio/') ? <audio controls src={source} aria-label={name} /> : mime.startsWith('video/') ? <video controls src={source} aria-label={name} style={{ maxWidth: '100%' }} /> : <img src={source} alt={name} style={{ maxWidth: '100%' }} />}<figcaption>{name} <a href={source} download={name}>导出素材</a></figcaption></figure>
}
