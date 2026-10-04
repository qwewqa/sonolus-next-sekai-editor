import type { State } from '..'
import type { Entity } from '../entities'
import { isEditableEntity, type EditableEntity, type EditableObject } from './editable'
import { isWithinGridBudget } from './scaleValues'

export const getMakeVerticalChanges = (selected: Entity[], source?: State) => {
    const entities = [...new Set(selected.filter(isEditableEntity))]
    const notes = entities.filter((entity) => entity.type === 'note')
    if (!notes.length) return
    let beat = Infinity
    for (const note of notes) beat = Math.min(beat, note.beat)
    if (!Number.isFinite(beat) || !Number.isSafeInteger(Math.floor(beat))) return
    if (entities.every((entity) => entity.beat === beat)) return
    const changes = new Map<EditableEntity, EditableObject>()
    for (const entity of entities) {
        if (!Number.isFinite(entity.beat)) return
        const elevation = entity.beat - beat
        if (!Number.isFinite(elevation)) return
        if (entity.type === 'note') {
            changes.set(entity, { beat, elevation, isAttached: false })
        } else {
            changes.set(entity, { beat })
        }
    }
    if (source && !isWithinGridBudget(source, new Map(entities.map((entity) => [entity, beat]))))
        return
    return changes
}
export const canMakeVertical = (selected: Entity[], source?: State) =>
    getMakeVerticalChanges(selected, source) !== undefined
