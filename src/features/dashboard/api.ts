import type { WritingDashboard } from '../../../shared/contracts/dashboard'
import { request } from '../../shared/api/client'

export const dashboardApi = {
  read: (signal?: AbortSignal) => request<WritingDashboard>('/dashboard', 'GET', undefined, signal),
  setGoal: (dailyGoal: number) => request<{ dailyGoal: number }>('/dashboard/goal', 'PUT', { dailyGoal }),
}
