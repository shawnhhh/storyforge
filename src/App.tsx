import { useEffect, useState } from 'react'
import { Workspace } from './features/novels/Workspace'
import { VideoWorkspace } from './features/video/VideoWorkspace'
export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => { const changed = () => setHash(window.location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [])
  if (hash === '#video') return <VideoWorkspace />
  return <><a className="video-entry" href="#video">视频工作台</a><Workspace /></>
}
