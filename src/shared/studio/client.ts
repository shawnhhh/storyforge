import { request } from '../api/client'
import type { StudioAsset, StudioKind, StudioProject, StudioTask, StudioVersion } from '../../../shared/contracts/studio'
export const studioClient = {
  list: (kind: StudioKind) => request<StudioProject[]>(`/studio/projects?kind=${kind}`),
  create: (kind: StudioKind, title: string) => request<StudioProject>('/studio/projects', 'POST', { kind, title }),
  save: (project: StudioProject) => request<StudioProject>(`/studio/projects/${project.id}`, 'PUT', project),
  history: (id: string) => request<StudioVersion[]>(`/studio/projects/${id}/history`),
  assets: (id: string) => request<StudioAsset[]>(`/studio/projects/${id}/assets`),
  tasks: (id: string) => request<StudioTask[]>(`/studio/projects/${id}/tasks`),
  cancel: (id: string) => request<StudioTask>(`/studio/tasks/${id}/cancel`, 'POST', {}),
  generate: (project: StudioProject, prompt: string) => request<StudioTask>(`/studio/projects/${project.id}/generate`, 'POST', { version: project.version, prompt, idempotencyKey: crypto.randomUUID() }),
}
