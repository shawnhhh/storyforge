export type EditorShortcut = 'save' | 'focus' | 'previous' | 'next' | 'escape'
interface KeyEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
  repeat: boolean
  defaultPrevented: boolean
}

// Require all three modifiers so browser Save, Find, Print, tab switching and OS
// fullscreen shortcuts retain their native behavior. Ignore IME/repeats/handled keys.
export function editorShortcut(event: KeyEvent): EditorShortcut | null {
  if (event.isComposing || event.repeat || event.defaultPrevented) return null
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event
  if (key === 'Escape' && !ctrlKey && !metaKey && !altKey && !shiftKey) return 'escape'
  if (ctrlKey === metaKey || !altKey || !shiftKey) return null
  switch ((event.code === 'KeyS' ? 's' : event.code === 'KeyF' ? 'f' : key).toLowerCase()) {
    // macOS Option can produce a different event.key for letter shortcuts; the
    // listener normalizes physical KeyS/KeyF to preserve the advertised bindings.
    case 's': return 'save'
    case 'f': return 'focus'
    case 'arrowup': return 'previous'
    case 'arrowdown': return 'next'
    default: return null
  }
}
