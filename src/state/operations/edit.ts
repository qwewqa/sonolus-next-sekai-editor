import type { State } from '..'
import type { Entity } from '../entities'
import type { EditableObject } from './editable'
import { planEdit, type PlanOptions } from './properties/plan'

export type EditOptions = PlanOptions

// History, notifications, and viewport changes belong to callers. Speculative
// callers can disable automatic group creation to retain unchanged cache keys.
export const createEditedEntitiesState = (
    source: State,
    selected: Entity[],
    object: EditableObject,
    options?: EditOptions,
): State => planEdit(source, selected, object, options).state
