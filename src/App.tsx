import { useEffect, useState } from 'react'
import { Workspace } from './features/novels/Workspace'
import { MusicWorkspace } from './features/music/MusicWorkspace'
import { VideoWorkspace } from './features/video/VideoWorkspace'

export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  const [musicDirty, setMusicDirty] = useState(false)

  useEffect(() => {
    const changed = () => {
      const next = window.location.hash
      if (hash === '#music' && next !== '#music' && musicDirty) {
        history.replaceState(null, '', '#music')
        return
      }
      if (hash === '#video' && next !== '#video' &&
        !window.dispatchEvent(new Event('storyforge:leave-video', { cancelable: true }))) {
        history.replaceState(null, '', '#video')
        return
      }
      if (hash !== '#music' && hash !== '#video' && ['#music', '#video'].includes(next) &&
        !window.dispatchEvent(new Event('storyforge:leave-story', { cancelable: true }))) {
        history.replaceState(null, '', hash || '#story')
        return
      }
      setHash(next)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [hash, musicDirty])

  if (hash === '#music') return <MusicWorkspace onDirtyChange={setMusicDirty} />
  if (hash === '#video') return <VideoWorkspace />
  return <Workspace moduleEntries={[
    { href: '#music', label: '音乐工作台' },
    { href: '#video', label: '视频工作台' },
  ]} />
}
