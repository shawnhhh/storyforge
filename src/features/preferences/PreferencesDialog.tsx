import { LocalDialog } from '../../shared/ui/LocalDialog'
import { defaultPreferences, type Preferences } from './model'

export function PreferencesDialog({ value, onChange, onClose, error, returnFocusTo }: { value: Preferences; onChange: (value: Preferences) => void; onClose: () => void; error: string; returnFocusTo: HTMLElement | null }) {
  const change = (patch: Partial<Preferences>) => onChange({ ...value, ...patch })
  return <LocalDialog title="偏好设置" returnFocusTo={returnFocusTo} onClose={onClose} className="preferences-dialog">
    <p className="local-note">即时应用 · 保存在当前浏览器，不修改作品内容。</p>
    {error && <p role="alert">{error}</p>}
    <label>外观主题<select value={value.theme} onChange={event => change({ theme: event.target.value as Preferences['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    <label>正文字体<select value={value.font} onChange={event => change({ font: event.target.value as Preferences['font'] })}><option value="system">系统字体</option><option value="serif">宋体 / 衬线字体</option><option value="mono">等宽字体</option></select></label>
    <label>正文字号<select value={value.fontSize} onChange={event => change({ fontSize: Number(event.target.value) })}>{Array.from({ length: 17 }, (_, i) => i + 12).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
    <label>编辑器布局<select value={value.layout} onChange={event => change({ layout: event.target.value as Preferences['layout'] })}><option value="standard">标准三栏</option><option value="wide">宽幅正文</option><option value="compact">紧凑侧栏</option></select></label>
    <label className="check-label"><input type="checkbox" checked={value.shortcutHints} onChange={event => change({ shortcutHints: event.target.checked })} />显示快捷键提示</label>
    <div className="preference-preview" style={{ fontSize: value.fontSize }}>故事，从一个灵感开始。<br />The next chapter starts here.</div>
    <button onClick={() => onChange({ ...defaultPreferences })}>恢复默认偏好</button>
  </LocalDialog>
}
