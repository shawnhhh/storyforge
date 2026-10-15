import { useState } from 'react'
import type { SaveState } from './autosave.js'

const statusLabels = { saved: '已保存', pending: '等待保存…', saving: '保存中…', failed: '保存失败', conflict: '版本冲突 · 未保存' }
export function ProfileControls({ state, disabled, onSave, onExport, onReload }: { state: SaveState; disabled: boolean; onSave: () => void; onExport: () => void; onReload: () => void }) {
  return <>
    <div className="profile-save-bar">
      <span className={`profile-save-status save-status ${state.status}`} role="status">{statusLabels[state.status]}</span>
      <button disabled={disabled || !state.dirty || state.status === 'saving' || state.status === 'conflict'} onClick={onSave}>立即保存</button>
    </div>
    {(state.status === 'failed' || state.status === 'conflict') && <div className="save-error" role="alert">
      <p>{state.message}</p><p>草稿仍保留在当前表单中。重新加载前可先导出草稿；服务重启或备份恢复后需刷新整个页面。</p>
      <div className="button-row">
        {state.status === 'failed' && <button disabled={disabled} onClick={onSave}>重试保存</button>}
        <button onClick={onExport}>导出资料草稿</button><button disabled={disabled} onClick={onReload}>重新加载资料</button>
      </div>
    </div>}
  </>
}
export function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [tag, setTag] = useState('')
  const normalized = tag.trim()
  const allowed = Boolean(normalized) && tags.length < 50 && !tags.includes(normalized)
  function add() { if (allowed) { onChange([...tags, normalized]); setTag('') } }
  return <div className="profile-tags-editor">
    <div className="profile-tags">{tags.map(item => <span key={item}>{item}<button aria-label={`移除标签 ${item}`} onClick={() => onChange(tags.filter(value => value !== item))}>×</button></span>)}</div>
    <div className="profile-inline"><label>新标签<input maxLength={80} value={tag} placeholder="自定义标签" onChange={event => setTag(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add() }
    }} /></label><button disabled={!allowed} onClick={add}>添加标签</button></div>
    <small>最多 50 个标签，每个最多 80 字；输入后点击添加。</small>
  </div>
}
