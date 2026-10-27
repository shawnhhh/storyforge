import { useEffect, useState } from 'react'
import { Workspace } from './features/novels/Workspace'
import { VideoWorkspace } from './features/video/VideoWorkspace'
export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => { const changed = () => { if (hash === '#video' && window.location.hash !== '#video' && !window.dispatchEvent(new Event('storyforge:leave-video', { cancelable: true }))) { history.replaceState(null, '', '#video'); return } setHash(window.location.hash) }; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [hash])
  if (hash === '#video') return <VideoWorkspace />
  return <Workspace moduleEntry={{ href: '#video', label: '视频工作台' }} />
}
