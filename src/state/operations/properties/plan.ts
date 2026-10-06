import type { State } from '../..'
import { applyEaseEdit } from '../../../ease'
import type { Entity } from '../../entities'
import { createTransaction, type Transaction, type TransactionOptions } from '../../transaction'
import { editBpm, editSelectedBpm } from '../bpm'
import { isEditableEntity, type EditableEntity, type EditableObject } from '../editable'
import { editSelectedCameraEvent } from '../events/camera'
import { editSelectedStageMaskEvent } from '../events/stage/mask'
import { editSelectedStagePivotEvent } from '../events/stage/pivot'
import { editSelectedStageStyleEvent } from '../events/stage/style'
import { editSelectedStageTransformEvent } from '../events/stage/transform'
import { editSelectedNote } from '../note'
import { editSelectedTimeScale, editTimeScale } from '../timeScale'

export type PlanOptions = TransactionOptions & {
    /** Edits only these selected objects; the rest stay selected unchanged. */
    only?: (entity: Entity) => boolean
    /** A lone object edits as its tool would, moving or replacing by beat. */
    single?: boolean
}

const edits = {
    bpm: editSelectedBpm,
    timeScale: editSelectedTimeScale,
    cameraEventJoint: editSelectedCameraEvent,
    stageMaskEventJoint: editSelectedStageMaskEvent,
    stagePivotEventJoint: editSelectedStagePivotEvent,
    stageStyleEventJoint: editSelectedStageStyleEvent,
    stageTransformEventJoint: editSelectedStageTransformEvent,
    note: editSelectedNote,
}

/** Edits one object in place, as each kind's tool does without moving it. */
export const editEntity = (
    transaction: Transaction,
    entity: EditableEntity,
    object: EditableObject,
): Entity[] => edits[entity.type](transaction, entity as never, object)

const easeKeys = new Set(['connectorEase', 'eventEase', 'timeScaleEase'])

/** Whether an edit would change any value the object holds. */
export const editChanges = (entity: Entity, object: EditableObject) => {
    const values = entity as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(object as Record<string, unknown>)) {
        if (value === undefined || !(key in entity)) continue
        const next = easeKeys.has(key) ? applyEaseEdit(value as never, values[key] as never) : value
        if (next !== values[key]) return true
    }
    if (entity.type !== 'note') return false
    // Fake and Critical also set the connector's flags, as the note op does.
    return (
        (object.connectorIsFake === undefined &&
            object.isFake !== undefined &&
            object.isFake !== entity.connectorIsFake) ||
        (object.connectorActiveIsCritical === undefined &&
            object.isCritical !== undefined &&
            object.isCritical !== entity.connectorActiveIsCritical)
    )
}

/** What an edit of the selection does: the new state and the objects it changed. */
export const planEdit = (
    source: State,
    selected: Entity[],
    object: EditableObject,
    { only, single = true, ...options }: PlanOptions = {},
) => {
    const changed = selected.filter(
        (entity) =>
            isEditableEntity(entity) && (!only || only(entity)) && editChanges(entity, object),
    )
    const transaction = createTransaction(source, options)
    const editable = selected.filter(isEditableEntity)
    const lone = single && editable.length === 1 ? editable[0] : undefined
    const state = transaction.commit(
        selected.flatMap((entity) => {
            if (!changed.includes(entity)) return [entity]
            if (entity === lone && entity.type === 'bpm')
                return editBpm(transaction, entity, object)
            if (entity === lone && entity.type === 'timeScale')
                return editTimeScale(transaction, entity, object)
            return edits[entity.type as keyof typeof edits](transaction, entity as never, object)
        }),
    )
    return { state, changed }
}
