import { useEffect, useState } from 'react'
import { defaultPreferences, preferencesKey, readPreferences, writePreferences, type Preferences } from './model'

export function usePreferences() {
  const [initial] = useState(() => {
    try { return { value: readPreferences(localStorage), error: '' } }
    catch { return { value: { ...defaultPreferences }, error: '无法读取偏好，已使用默认值。可重新设置；作品内容不受影响。' } }
  })
  const [value, setValue] = useState(initial.value)
  const [error, setError] = useState(initial.error)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = value.theme === 'system' ? media.matches ? 'dark' : 'light' : value.theme }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [value.theme])
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key !== preferencesKey && event.key !== null) return
      try { setValue(readPreferences(localStorage)); setError('') }
      catch { setError('无法同步偏好设置，请重新设置。') }
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [])
  function change(next: Preferences) {
    setValue(next)
    try { writePreferences(localStorage, next); setError('') }
    catch { setError('浏览器存储不可用。本次偏好仅在当前页面生效，请允许本地存储后重试。') }
  }
  return { value, error, change }
}
