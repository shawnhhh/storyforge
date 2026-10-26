import { useEffect, useRef, useState } from 'react'

export function NameConfirmation({ name, title, description, action, busy, error, onClose, onConfirm, returnFocusTo }: { name: string; title: string; description: string; action: string; busy: boolean; error: string; onClose: () => void; onConfirm: (name: string) => void; returnFocusTo?: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    const opener = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [returnFocusTo])
  return <dialog ref={dialog} className="novel-dialog" aria-labelledby="delete-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && value === name) onConfirm(value) }}>
      <h2 id="delete-title">{title}</h2><p className="trash-name">{name}</p><p>{description}</p>
      <label>输入完整名称确认<input autoFocus autoComplete="off" spellCheck={false} disabled={busy} value={value} onChange={event => setValue(event.target.value)} /></label>
      <small>名称必须完全匹配，包括空格和标点。</small>
      {error && <p role="alert">{error}</p>}
      <div className="button-row"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="danger" disabled={busy || value !== name}>{busy ? '处理中…' : action}</button></div>
    </form>
  </dialog>
}
export function DeleteNovelDialog(props: { name: string; busy: boolean; error: string; onClose: () => void; onConfirm: (name: string) => void; returnFocusTo?: HTMLElement | null }) {
  return <NameConfirmation {...props} title="删除整本小说" action="移入回收站" description="全部章节、人物、世界观、关系、规划和资料引用将一同进入回收站，保留 30 天。期限内可整体恢复；已经单独删除的项目仍在回收站中。" />
}
