import { useState } from 'react'
import type { PlanningSnapshot } from '../../../shared/contracts/planning'
import { cardStatuses } from '../../../shared/contracts/planning'
import type { StoryBible } from '../../../shared/contracts/story-bible'
import type { ChapterSummary } from '../../../shared/contracts/novels'
import type { KnowledgeSnapshot } from '../../../shared/contracts/knowledge'
import { storyTimeline } from '../../../shared/domain/timeline'
import type { OpenMaterial } from '../story-bible/KnowledgeLinks'

export function StoryTimeline({ snapshot, bible, knowledge, chapters, disabled, onCard, onCreate, onOpen }: {
  snapshot: PlanningSnapshot; bible: StoryBible; knowledge: KnowledgeSnapshot; chapters: ChapterSummary[]
  disabled: boolean; onCard: (id: string) => void; onCreate: () => void; onOpen?: OpenMaterial
}) {
  const [search, setSearch] = useState(''), [source, setSource] = useState('')
  const [person, setPerson] = useState(''), [place, setPlace] = useState(''), [chapter, setChapter] = useState('')
  const [status, setStatus] = useState('')
  const places = bible.world.filter(row => row.category === 'location')
  const events = storyTimeline(snapshot, bible, knowledge).filter(row =>
    (!source || row.source === source) && (!person || row.characterIds.includes(person)) &&
    (!place || row.worldIds.includes(place)) && (!chapter || row.chapterIds.includes(chapter)) &&
    (!status || row.status === status) && `${row.title} ${row.description} ${row.storyTime}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <section className="story-timeline" aria-label="故事时间线">
    <p className="profile-hint">剧情卡片即故事事件，与资料库的重要事件共同展示。按故事时间序号升序，同序号保留原顺序；未填序号置后。时间文本支持虚构纪年，不按现实日历推算。</p>
    <div className="planning-tools"><button className="primary" onClick={onCreate}>新建事件</button>
      <input aria-label="搜索事件" placeholder="搜索事件名称、描述或时间" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="事件来源" value={source} onChange={event => setSource(event.target.value)}><option value="">全部来源</option><option value="card">剧情卡片</option><option value="world">资料库重要事件</option></select>
      <select aria-label="筛选参与人物" value={person} onChange={event => setPerson(event.target.value)}><option value="">全部人物</option>{bible.characters.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <select aria-label="筛选事件地点" value={place} onChange={event => setPlace(event.target.value)}><option value="">全部地点</option>{places.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <select aria-label="筛选事件章节" value={chapter} onChange={event => setChapter(event.target.value)}><option value="">全部章节</option>{chapters.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select>
      <select aria-label="筛选事件状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(cardStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
    </div>
    <p role="status">共 {events.length} 个事件</p>
    <ol className="timeline-events">{events.map(row => <li key={`${row.source}:${row.id}`}>
      <div className="timeline-date">{row.storyTime || '未设定故事时间'}<small>{row.order === null ? '未设定序号' : `序号 ${row.order}`}</small></div>
      <article><div className="timeline-heading"><h3>{row.title || '未命名'}</h3><small>{row.source === 'world' ? '资料库重要事件' : cardStatuses[row.status!]}</small></div>
        <p className="timeline-description">{row.description || '暂无事件描述'}</p>
        <dl><dt>地点</dt><dd>{row.worldIds.map(id => places.find(place => place.id === id)?.name).filter(Boolean).join('、') || '未关联地点'}</dd>
          <dt>参与人物</dt><dd>{row.characterIds.map(id => bible.characters.find(person => person.id === id)?.name).filter(Boolean).join('、') || '未关联人物'}</dd>
          <dt>章节</dt><dd>{row.chapterIds.map(id => chapters.find(chapter => chapter.id === id)?.title).filter(Boolean).join('、') || '未关联章节'}</dd></dl>
        <button disabled={row.source === 'world' && (disabled || !onOpen)} onClick={() => row.source === 'card' ? onCard(row.id) : onOpen?.('world', row.id)}>{row.source === 'card' ? '编辑剧情事件' : '打开资料库事件'}</button>
      </article></li>)}</ol>
    {!events.length && <p className="planning-empty">没有符合条件的事件。新建事件会创建剧情卡片，可随时编辑并关联资料。</p>}
  </section>
}
