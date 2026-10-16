import { useEffect, useRef, useState } from 'react'
import type { Novel } from '../../../shared/contracts/novels'

interface Props {
  novel: Novel | null
  busy: boolean
  error: string
  returnFocusTo: HTMLElement | null
  onClose: () => void
  onSubmit: (title: string, description: string) => void
}

export function NovelDialog({ novel, busy, error, returnFocusTo, onClose, onSubmit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(novel?.title ?? '')
  const [description, setDescription] = useState(novel?.description ?? '')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true }) }
  }, [returnFocusTo])
  return <dialog ref={dialog} className="novel-dialog" aria-labelledby="dialog-title" onCancel={event => {
    event.preventDefault()
    if (!busy) onClose()
  }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && title.trim()) onSubmit(title, description) }}>
      <h2 id="dialog-title">{novel ? '小说设置' : '创建小说'}</h2>
      <label>小说名称<input autoFocus required disabled={busy} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="为故事起一个名字" /></label>
      <label>简介<textarea disabled={busy} maxLength={4000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="故事的起点、主题或一句话梗概" /></label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存'}</button></div>
    </form>
  </dialog>
}
