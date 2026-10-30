import type { Preferences } from '../../features/preferences/model'

/** A shared control for the persisted appearance preference in every workspace. */
export function ThemeControl({ value, onChange }: { value: Preferences['theme']; onChange: (theme: Preferences['theme']) => void }) {
  return <label className="theme-control"><span aria-hidden="true">◐</span><select aria-label="工作台外观" value={value} onChange={event => onChange(event.target.value as Preferences['theme'])}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
}
