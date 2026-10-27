import { useEffect, useState } from 'react'
import { Workspace } from './features/novels/Workspace'
import { MusicWorkspace } from './features/music/MusicWorkspace'
export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { const change = () => { if (dirty) { history.replaceState(null, '', '#music'); return }; setHash(window.location.hash) }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [dirty])
  return hash === '#music' ? <MusicWorkspace onDirtyChange={setDirty} /> : <><a href="#music" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 20, background: 'var(--sf-surface,white)', color: 'var(--sf-text,#222)', padding: '10px 16px', border: '1px solid var(--sf-border,#ddd)', borderRadius: 12 }}>音乐工作台</a><Workspace /></>
}
