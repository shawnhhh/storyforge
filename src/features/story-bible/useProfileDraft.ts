import { useEffect, useRef, useState } from 'react'
import type { Character, WorldEntry } from '../../../shared/contracts/story-bible.js'
import { ProfileSaver, type SaveState } from './autosave.js'
import { validateProfile } from './model.js'

export function useProfileDraft<T extends Character | WorldEntry>(record: T, save: (value: T) => Promise<T>, onSaved: (value: T) => void, onDirty: (dirty: boolean) => void, disabled: boolean) {
  const [initial] = useState(record)
  const [value, setValue] = useState(record)
  const current = useRef(record)
  const queue = useRef<ProfileSaver<T> | null>(null)
  const [state, setState] = useState<SaveState>({ status: 'saved', dirty: false, message: '' })
  useEffect(() => {
    const saver = new ProfileSaver(initial, save, validateProfile)
    queue.current = saver
    const unsubscribe = saver.subscribe((next, result) => {
      setState(next); onDirty(next.dirty)
      if (result) onSaved(result)
    })
    return () => { unsubscribe(); saver.dispose(); queue.current = null }
  }, [initial, save, onSaved, onDirty])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.current?.state.dirty) { event.preventDefault(); event.returnValue = '' }
    }
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!disabled) void queue.current?.flush() }
    }
    window.addEventListener('beforeunload', warn); window.addEventListener('keydown', shortcut)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', shortcut) }
  }, [disabled])
  function change(patch: Partial<T>) {
    const next = { ...current.current, ...patch }
    current.current = next; setValue(next); queue.current?.change(next)
  }
  function exportDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current.current, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'StoryForge-资料草稿.json'
    document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  return { value, state, change, exportDraft, flush: () => { if (!disabled) void queue.current?.flush() }, composition: (active: boolean) => queue.current?.composition(active) }
}
