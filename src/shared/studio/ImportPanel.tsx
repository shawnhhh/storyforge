import { useState } from 'react'
import { request } from '../api/client'
import type { StudioKind } from '../../../shared/contracts/studio'
type Preview = { token: string; title: string; kind: StudioKind; versions: number; assets: number; bytes: number; warning: string; policy: string }
export function ImportPanel({ kind, disabled, onImported }: { kind: StudioKind; disabled: boolean; onImported: () => Promise<void> }) {
  const [archive, setArchive] = useState<unknown>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function read(file?: File) {
    setPreview(null); setArchive(null)
    if (!file) return
    setBusy(true)
    try {
      if (!file.name.toLowerCase().endsWith('.json') || (file.type && !['application/json','text/plain'].includes(file.type)) || file.size > 64 * 1024 * 1024) throw new Error('请选择 64MB 以内的 JSON 工程文件')
      const value: unknown = JSON.parse(await file.text())
      const result = await request<Preview>('/studio/import/preview', 'POST', { archive: value })
      if (result.kind !== kind) throw new Error('请选择当前模块的工程')
      setArchive(value); setPreview(result); setMessage('')
    } catch (e) { setMessage(String(e)) } finally { setBusy(false) }
  }
  return <section aria-label="工程导入"><label>导入工程 JSON<input type="file" accept=".json,application/json" disabled={disabled || busy} onChange={e => { void read(e.target.files?.[0]); e.target.value = '' }} /></label>{preview && <div><h3>导入预览：{preview.title}</h3><p>{preview.versions} 个历史版本 · {preview.assets} 个素材 · {preview.bytes} 字节</p><p>{preview.policy}。{preview.warning}</p><button disabled={disabled || busy} onClick={() => { setBusy(true); void request('/studio/import/confirm','POST',{ archive, token: preview.token, confirmation: '作为新项目导入' }).then(async () => { setPreview(null); setArchive(null); await onImported(); setMessage('工程已作为新项目导入') }).catch(e => setMessage(String(e))).finally(() => setBusy(false)) }}>确认作为新项目导入</button><button disabled={busy} onClick={() => { setPreview(null); setArchive(null) }}>取消导入</button></div>}{message && <p role="status">{message}</p>}</section>
}
