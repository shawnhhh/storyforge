import { useState } from 'react'
import type { useDraftProtection } from './useDraftProtection'
import type { LocalDraft } from './store'
import './drafts.css'

export function DraftNotice<T extends object>({ draft, onRestore }: { draft: ReturnType<typeof useDraftProtection<T>>; onRestore: (value: T, source: LocalDraft<T>) => void }) {
  const { protection, state } = draft
  const [restoreError, setRestoreError] = useState('')
  function restore(record: LocalDraft<T>) {
    // A choice among several drafts never deletes the other drafts.
    try { protection.validate(record); onRestore(record.value, record); protection.recover(record); setRestoreError('') }
    catch (error) { setRestoreError(String(error)) }
  }
  function download(record: LocalDraft<T>) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'StoryForge-本机草稿.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return <div className="draft-protection">
    {restoreError && <p role="alert">{restoreError}</p>}
    <p role="status" className="draft-protection-state">{state.loading ? '正在检查本机草稿…' : state.protected ? '临时草稿已保护 · 此浏览器' : '\u00a0'}</p>
    {state.error && <p role="alert">{state.error}。请保留页面并导出当前草稿。</p>}
    {state.candidates.map(record => <div className="draft-recovery" role="alert" key={record.id}>
      <p>检测到本机草稿（{new Date(record.updatedAt).toLocaleString()}）。请核对后选择；恢复后将按当前数据库版本保存。其他窗口的未完成草稿也会列在这里。</p>
      <details><summary>查看草稿内容与版本信息</summary><p>服务会话：{record.generation ?? '未知'} · 基准内容与当前数据库{protection.matchesBase(record) ? '一致' : '可能不同'}</p><pre>{JSON.stringify(record.value, null, 2)}</pre></details>
      <div className="button-row"><button type="button" onClick={() => restore(record)}>恢复此草稿</button><button type="button" onClick={() => { void protection.discard(record) }} title="仅丢弃这一份本机草稿，其他草稿继续保留">保留数据库版本</button><button type="button" onClick={() => download(record)}>导出此草稿</button></div>
    </div>)}
  </div>
}
