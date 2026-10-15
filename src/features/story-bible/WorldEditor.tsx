import { worldCategories, type Character, type WorldEntry, type WorldCategory } from '../../../shared/contracts/story-bible.js'
import { storyApi } from './api.js'
import { ProfileControls, TagsEditor } from './ProfileControls.js'
import { useProfileDraft } from './useProfileDraft.js'

interface Props {
  record: WorldEntry
  characters: Character[]
  disabled: boolean
  onSaved: (record: WorldEntry) => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
}
export function WorldEditor({ record, characters, disabled, onSaved, onDirty, onReload }: Props) {
  const draft = useProfileDraft(record, storyApi.saveWorld, onSaved, onDirty, disabled)
  const { value, change } = draft
  const related = characters.filter(item => item.worldIds.includes(record.id))
  return <section className="profile-detail" aria-label="设定详情">
    <ProfileControls state={draft.state} disabled={disabled} onSave={draft.flush} onExport={draft.exportDraft} onReload={onReload} />
    <fieldset disabled={disabled} className="profile-form" onCompositionStart={() => draft.composition(true)} onCompositionEnd={() => draft.composition(false)}>
      <legend className="sr-only">编辑世界观设定</legend>
      <div className="profile-form-grid">
        <label>设定名称<input maxLength={200} value={value.name} onChange={event => change({ name: event.target.value })} /></label>
        <label>设定分类<select aria-label="设定分类" value={value.category} onChange={event => change({ category: event.target.value as WorldCategory })}>{Object.entries(worldCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="profile-wide">设定内容<textarea aria-label="设定内容" rows={12} maxLength={100000} value={value.description} onChange={event => change({ description: event.target.value })} /></label>
      </div>
      <h3>设定标签</h3><TagsEditor tags={value.tags} onChange={tags => change({ tags })} />
      <h3>事件时间线</h3>
      <label className="profile-checkbox"><input type="checkbox" checked={value.onTimeline} onChange={event => change({ onTimeline: event.target.checked })} />加入重要事件时间线</label>
      <div className="profile-form-grid">
        <label>时间文本<input maxLength={200} value={value.timeText} placeholder="例如：新纪元三年·冬" onChange={event => change({ timeText: event.target.value })} /></label>
        <label>时间线顺序<input type="number" min={-1000000000} max={1000000000} step={1} value={Number.isNaN(value.sortOrder) ? '' : value.sortOrder} onChange={event => change({ sortOrder: event.target.valueAsNumber })} /></label>
      </div><p className="profile-hint">按顺序数字升序排列；时间文本可自由填写，同序号按创建时间排列。</p>
      <h3>关联人物</h3>{related.length ? <ul className="profile-associations">{related.map(item => <li key={item.id}>{item.name}{item.category ? ` · ${item.category}` : ''}</li>)}</ul> : <p className="profile-hint">暂无关联人物。在人物档案中勾选此条设定即可关联。</p>}
    </fieldset>
    <footer className="profile-footer">自动保存至本机 · 世界观资料与小说正文独立保存</footer>
  </section>
}
