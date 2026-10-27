import { characterFields } from '../../shared/contracts/story-bible.js'
import type { PlanningProposal, GeneratedCharacter } from '../../shared/contracts/ai-planning.js'
export const planningProposal = { title: '云海', content: '虚构设定：文明位于浮空岛，资源限制带来冲突。<script>仅为文本</script>' }
export const generatedCharacter: GeneratedCharacter = { category: '主角', tags: ['勇敢', '调查者'], fields: { ...Object.fromEntries(Object.keys(characterFields).filter(key => key !== 'notes').map(key => [key, ''])) as GeneratedCharacter['fields'], aliases: '观星者', gender: '女', age: '28', identity: '浮空岛档案管理员', appearance: '银色短发', personality: '谨慎而执着', background: '成长于失落港口', goals: '寻找家族失踪的真相', arc: '从独自追寻到信任伙伴' } }
export const characterProposal: PlanningProposal = { ...planningProposal, character: generatedCharacter }
