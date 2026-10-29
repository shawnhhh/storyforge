import type { StudioProject, StudioSettings } from '../contracts/studio.js'
export interface VideoShot { id: string; description: string; duration: number; camera: string }
export interface VideoConfiguration { aspectRatio: string; shots: VideoShot[] }
export function readVideoConfiguration(settings: StudioSettings): VideoConfiguration {
  let shots: VideoShot[] = []
  try { const parsed: unknown = JSON.parse(String(settings.shots ?? '[]')); if (Array.isArray(parsed)) shots = parsed as VideoShot[] } catch { /* preserve editable empty configuration */ }
  return { aspectRatio: String(settings.aspectRatio ?? '16:9'), shots }
}
export function validateVideo(configuration: VideoConfiguration) {
  if (!['16:9', '9:16', '1:1'].includes(configuration.aspectRatio)) throw new Error('请选择有效画面比例')
  if (configuration.shots.length > 100) throw new Error('最多支持 100 个镜头')
  const ids = new Set<string>()
  for (const shot of configuration.shots) {
    if (!shot.id || ids.has(shot.id)) throw new Error('镜头标识不能重复')
    ids.add(shot.id)
    if (!shot.description.trim() || shot.description.length > 2000) throw new Error('镜头描述须为 1–2000 字')
    if (!Number.isFinite(shot.duration) || shot.duration < 1 || shot.duration > 60) throw new Error('镜头时长须为 1–60 秒')
    if (!shot.camera.trim() || shot.camera.length > 100) throw new Error('请填写运镜，最多 100 字')
  }
}
export interface VideoProviderAdapter { readonly id: string; prompt(project: StudioProject): string }
/** Prompt adapter is transport-independent; shared CreativeProvider executes generation. */
export class MockVideoAdapter implements VideoProviderAdapter {
  readonly id = 'mock'
  prompt(project: StudioProject) {
    const configuration = readVideoConfiguration(project.settings)
    validateVideo(configuration)
    if (!configuration.shots.length) throw new Error('请先添加分镜')
    return `视频分镜预览（Mock）\n画面比例：${configuration.aspectRatio}\n剧本：${project.content}\n${configuration.shots.map((shot, index) => `镜头 ${index + 1}：${shot.description}；${shot.duration} 秒；${shot.camera}`).join('\n')}`
  }
}
