import type { PlanningData, PlanningSnapshot } from '../../../shared/contracts/planning'
import { request } from '../../shared/api/client'
export const planningApi = {
  read: (id: string) => request<PlanningSnapshot>(`/novels/${id}/planning`, 'GET', undefined, AbortSignal.timeout(12000)),
  save: (id: string, version: number, data: PlanningData) => request<PlanningSnapshot>(`/novels/${id}/planning`, 'PUT', { ...data, version, confirmed: true }, AbortSignal.timeout(12000)),
}
