export interface Preferences {
  theme: 'system' | 'light' | 'dark'
  font: 'system' | 'serif' | 'mono'
  fontSize: number
  layout: 'standard' | 'wide' | 'compact'
  shortcutHints: boolean
}
export const defaultPreferences: Preferences = { theme: 'system', font: 'system', fontSize: 17, layout: 'standard', shortcutHints: true }
export const preferencesKey = 'storyforge:preferences:v1'
export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function validatePreferences(value: unknown): Preferences {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    theme: typeof data.theme === 'string' && ['system', 'light', 'dark'].includes(data.theme) ? data.theme as Preferences['theme'] : 'system',
    font: typeof data.font === 'string' && ['system', 'serif', 'mono'].includes(data.font) ? data.font as Preferences['font'] : 'system',
    fontSize: typeof data.fontSize === 'number' && Number.isInteger(data.fontSize) && data.fontSize >= 12 && data.fontSize <= 28 ? data.fontSize : 17,
    layout: typeof data.layout === 'string' && ['standard', 'wide', 'compact'].includes(data.layout) ? data.layout as Preferences['layout'] : 'standard',
    shortcutHints: typeof data.shortcutHints === 'boolean' ? data.shortcutHints : true,
  }
}
export function readPreferences(storage: PreferenceStorage): Preferences {
  const stored = storage.getItem(preferencesKey)
  return stored ? validatePreferences(JSON.parse(stored)) : { ...defaultPreferences }
}
export function writePreferences(storage: PreferenceStorage, value: Preferences) {
  storage.setItem(preferencesKey, JSON.stringify(validatePreferences(value)))
}
