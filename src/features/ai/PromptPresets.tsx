import { useState } from 'react'
import type { AiAction } from '../../../shared/contracts/ai'

const presets: { id: string; action: AiAction; label: string; instructions: string }[] = [
  { id: 'continue-scene', action: 'continue', label: '推进当前场景', instructions: '延续当前叙述视角、时态和人物口吻，通过具体行动推进场景。保持已提供的人物与世界规则，不重复前文；背景不足时保留悬念，不擅自揭示关键真相。' },
  { id: 'continue-suspense', action: 'continue', label: '悬念续写', instructions: '沿用当前视角，以克制的动作、环境细节和信息差推进悬念。遵守已提供的设定与伏笔，不替未提供的背景下定论，不重复选文。' },
  { id: 'polish-voice', action: 'polish', label: '保留口吻润色', instructions: '保留原意、人物口吻、叙述视角和全部事实，精简重复表达，改善语句节奏与衔接。不要新增情节、人物或世界规则。' },
  { id: 'expand-scene', action: 'expand', label: '动作与感官扩写', instructions: '保持原有情节、人物动机和因果关系，补充贴合视角的动作、感官与环境细节。避免堆砌形容词，不新增关键事件或设定。' },
  { id: 'rewrite-dialogue', action: 'rewrite', label: '对话与潜台词', instructions: '在保持事实、人物关系和剧情结果的前提下，改写选文的对话及相关动作，让表达符合人物身份，并通过停顿和行为表现潜台词。不要改变叙述视角。' },
  { id: 'inspire-options', action: 'inspire', label: '三种后续走向', instructions: '依据已提供的章节与明确引用的资料，提出三种可选的后续走向，分别说明人物动机、冲突、代价与需要核实的设定。清楚区分已有事实和新增建议，不声称已修改作品。' },
]

export function PromptPresets({ action, onApply }: { action: AiAction; onApply: (instructions: string) => void }) {
  const [selectedId, setSelectedId] = useState('')
  const options = presets.filter(preset => preset.action === action)
  const selected = options.find(preset => preset.id === selectedId)
  return <div className="ai-prompt-presets">
    <label>提示词模板<select aria-label="提示词模板" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>
      <option value="">选择模板…</option>
      {options.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
    </select></label>
    {selected && <p className="ai-note" aria-label="模板内容">{selected.instructions}</p>}
    <button type="button" disabled={!selected} onClick={() => { if (selected) onApply(selected.instructions) }}>用模板替换写作要求</button>
    <p className="ai-note">仅替换下方要求，可继续编辑。点击生成才发送请求；模板不会自动附带资料或修改正文。</p>
  </div>
}
