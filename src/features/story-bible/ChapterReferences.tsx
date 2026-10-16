import { useEffect, useState } from 'react'
import type { ChapterSummary } from '../../../shared/contracts/novels.js'
import type { StoryBible } from '../../../shared/contracts/story-bible.js'
import { KnowledgeLinks, type OpenMaterial } from './KnowledgeLinks.js'
import { storyApi } from './api.js'

interface Props { novelId: string; chapterId: string; chapters: ChapterSummary[]; disabled: boolean; onBusy: (busy: boolean) => void; onOpen: OpenMaterial }
export function ChapterReferences(props: Props) {
  const [open, setOpen] = useState(false)
  return <div className="chapter-references"><button aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(value => !value)}>{open ? '收起创作资料' : '查阅与引用创作资料'}</button>{open && <ReferenceContent key={props.chapterId} {...props} />}</div>
}
function ReferenceContent({ novelId, chapterId, chapters, disabled, onBusy, onOpen }: Props) {
  const [data, setData] = useState<StoryBible | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    storyApi.list(novelId).then(value => { if (active) { setData(value); setError('') } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取资料失败') })
    return () => { active = false }
  }, [novelId, attempt])
  return <>{error && <p role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>重试读取创作资料</button></p>}{data ? <KnowledgeLinks novelId={novelId} source={{ kind: 'chapter', id: chapterId }} data={data} chapters={chapters} disabled={disabled} onBusy={onBusy} onOpen={onOpen} /> : !error && <p role="status">正在读取创作资料…</p>}</>
}
