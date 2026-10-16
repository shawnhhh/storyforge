import { useEffect, useRef, type ReactNode } from 'react'

export function LocalDialog({ title, onClose, children, returnFocusTo, className = '' }: { title: string; onClose: () => void; children: ReactNode; returnFocusTo: HTMLElement | null; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = ref.current
    element?.showModal()
    return () => { element?.close(); if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true }) }
  }, [returnFocusTo])
  return <dialog ref={ref} className={`local-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}>
    <header><h2>{title}</h2><button aria-label={`关闭${title}`} onClick={onClose}>完成</button></header>{children}
  </dialog>
}
