import { useEffect, useState } from 'react'
import { DraftProtection } from './protection'

export function useDraftProtection<T extends object>(key: string, initial: T) {
  const [protection] = useState(() => new DraftProtection(key, initial))
  const [state, setState] = useState(protection.state)
  useEffect(() => { const unsubscribe = protection.subscribe(setState); void protection.load(); return unsubscribe }, [protection])
  return { protection, state, blocked: state.loading || state.candidates.length > 0 }
}
