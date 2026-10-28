/** Platform-neutral DTOs. Native clients can implement StudioClient over their own transport. */
export type StudioKind = 'music' | 'video'
export type StudioSettings = Record<string, string | number | boolean | string[]>
export interface StudioProject { id: string; kind: StudioKind; title: string; content: string; settings: StudioSettings; version: number; createdAt: string; updatedAt: string }
export interface StudioVersion { id: number; projectId: string; version: number; title: string; content: string; settings: StudioSettings; createdAt: string }
export interface StudioAsset { id: string; projectId: string; name: string; mime: string; bytes: number; createdAt: string }
export interface StudioTask { id: string; projectId: string; provider: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; prompt: string; assetId: string | null; mediaId?:string|null; error: string | null; createdAt: string }
export interface GenerationInput { project: StudioProject; prompt: string }
export type GenerationOutput = { name:string;mime:string;data:Uint8Array;mediaUploadId?:never } | { name:string;mime:string;mediaUploadId:string;data?:never }
export interface CreativeProvider { readonly id: string; generate(input: GenerationInput): Promise<GenerationOutput> }
export const studioPrompts = { music: '创作一段适合当前曲风与情绪的音乐。', video: '根据剧本与镜头描述生成可预览的分镜片段。' } as const

export type CreativeModuleId = 'story' | StudioKind
export interface ProjectSummary { id: string; module: CreativeModuleId; title: string; version: number; updatedAt: string }
/** Explicit adapters keep existing Story storage and API semantics intact. */
export const creativeModules = [
  { id: 'story', label: '小说', projectApi: '/api/novels', workspace: '#story' },
  { id: 'music', label: '音乐', projectApi: '/api/studio/projects?kind=music', workspace: '#music' },
  { id: 'video', label: '视频', projectApi: '/api/studio/projects?kind=video', workspace: '#video' },
] as const
