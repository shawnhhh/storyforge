import { validatePlanning, PlanningValidationError } from '../../../../shared/domain/planning.js'
import { HttpError } from '../novels/store.js'
export function planningInput(value: unknown) {
  try { return validatePlanning(value) }
  catch (error) { if (error instanceof PlanningValidationError) throw new HttpError(400, error.message); throw error }
}
