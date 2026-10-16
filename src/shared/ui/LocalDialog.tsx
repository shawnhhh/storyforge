import { useEffect, useRef, type ReactNode } from 'react'

export function LocalDialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = ref.current
    element?.showModal()
    return () => { element?.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  return <dialog ref={ref} className={`local-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}>
    <header><h2>{title}</h2><button aria-label={`关闭${title}`} onClick={onClose}>完成</button></header>{children}
  </dialog>
}
