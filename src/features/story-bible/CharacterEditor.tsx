import { useState } from 'react'
import { characterFields, worldCategories, type Character, type WorldEntry } from '../../../shared/contracts/story-bible.js'
import { storyApi } from './api.js'
import { ProfileControls, TagsEditor } from './ProfileControls.js'
import { useProfileDraft } from './useProfileDraft.js'

interface Props {
  record: Character
  characters: Character[]
  world: WorldEntry[]
  disabled: boolean
  onSaved: (record: Character) => void
  onDirty: (dirty: boolean) => void
  onReload: () => void
}
export function CharacterEditor({ record, characters, world, disabled, onSaved, onDirty, onReload }: Props) {
  const draft = useProfileDraft(record, storyApi.saveCharacter, onSaved, onDirty, disabled)
  const { value, change } = draft
  const [targetId, setTargetId] = useState('')
  const [kind, setKind] = useState('朋友')
  const canAdd = targetId && kind.trim() && value.relations.length < 200 && !value.relations.some(item => item.targetId === targetId && item.kind === kind.trim())
  const incoming = characters.flatMap(item => item.relations.filter(relation => relation.targetId === record.id).map(relation => ({ name: item.name, kind: relation.kind, id: item.id })))
  return <section className="profile-detail" aria-label="人物详情">
    <ProfileControls state={draft.state} disabled={disabled} onSave={draft.flush} onExport={draft.exportDraft} onReload={onReload} />
    <fieldset disabled={disabled} className="profile-form" onCompositionStart={() => draft.composition(true)} onCompositionEnd={() => draft.composition(false)}>
      <legend className="sr-only">编辑人物档案</legend>
      <div className="profile-form-grid">
        <label>姓名<input autoComplete="off" maxLength={200} value={value.name} onChange={event => change({ name: event.target.value })} /></label>
        <label>角色分类<input maxLength={80} list="character-categories" value={value.category} onChange={event => change({ category: event.target.value })} placeholder="主角、配角、反派或自定义" /><datalist id="character-categories">{['主角', '配角', '反派'].map(item => <option key={item} value={item} />)}</datalist></label>
        {Object.entries(characterFields).map(([key, label]) => <label className={['appearance', 'personality', 'background', 'goals', 'arc', 'notes'].includes(key) ? 'profile-wide' : ''} key={key}>{label}<textarea aria-label={label} rows={['aliases', 'gender', 'age', 'identity'].includes(key) ? 1 : 3} maxLength={20000} value={value.fields[key as keyof typeof characterFields]} onChange={event => change({ fields: { ...value.fields, [key]: event.target.value } })} /></label>)}
      </div>
      <h3>人物标签</h3><TagsEditor tags={value.tags} onChange={tags => change({ tags })} />
      <h3>人物关系</h3><p className="profile-hint">关系有方向，按“当前人物 → 目标人物”记录；反向关系可在对方档案中添加。</p>
      <ul className="profile-associations">{value.relations.map((item, index) => <li key={`${item.targetId}:${item.kind}`}><span>{value.name} → {characters.find(person => person.id === item.targetId)?.name ?? '已删除人物'} · {item.kind}</span><button aria-label={`移除关系 ${index + 1}`} onClick={() => change({ relations: value.relations.filter((_, row) => row !== index) })}>移除</button></li>)}</ul>
      <div className="profile-relation-add"><label>目标人物<select aria-label="目标人物" value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">选择人物</option>{characters.filter(item => item.id !== record.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>关系类型<input maxLength={80} list="relation-kinds" value={kind} onChange={event => setKind(event.target.value)} /><datalist id="relation-kinds">{['亲属', '朋友', '敌对', '师徒'].map(item => <option key={item} value={item} />)}</datalist></label>
        <button disabled={!canAdd} onClick={() => { if (canAdd) { change({ relations: [...value.relations, { targetId, kind: kind.trim() }] }); setTargetId('') } }}>添加关系</button>
      </div>
      {!characters.some(item => item.id !== record.id) && <p className="profile-hint">创建第二位人物后即可建立关系。</p>}
      {incoming.length > 0 && <><h4>其他人物指向此人物的关系</h4><ul className="profile-associations">{incoming.map(item => <li key={`${item.id}:${item.kind}`}>{item.name} → {value.name} · {item.kind}</li>)}</ul></>}
      <h3>关联世界观</h3><p className="profile-hint">选择人物相关的地点、势力或其他设定，最多 200 项。</p>
      <div className="profile-world-links">{world.map(item => <label key={item.id}><input type="checkbox" disabled={!value.worldIds.includes(item.id) && value.worldIds.length >= 200} checked={value.worldIds.includes(item.id)} onChange={event => change({ worldIds: event.target.checked ? [...value.worldIds, item.id] : value.worldIds.filter(id => id !== item.id) })} /><span>{item.name} <small>{worldCategories[item.category]}</small></span></label>)}</div>
      {!world.length && <p className="profile-hint">先在“世界观”中创建资料，再回来关联。</p>}
    </fieldset>
    <footer className="profile-footer">自动保存至本机 · 人物资料与小说正文独立保存</footer>
  </section>
}
