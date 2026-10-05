import type { State } from '..'
import type { Entity } from '../entities'
import { createTransaction, type Transaction, type TransactionOptions } from '../transaction'
import { editBpm, editSelectedBpm } from './bpm'
import type { EditableObject } from './editable'
import { editSelectedCameraEvent } from './events/camera'
import { editSelectedStageMaskEvent } from './events/stage/mask'
import { editSelectedStagePivotEvent } from './events/stage/pivot'
import { editSelectedStageStyleEvent } from './events/stage/style'
import { editSelectedStageTransformEvent } from './events/stage/transform'
import { editSelectedNote } from './note'
import { editSelectedTimeScale, editTimeScale } from './timeScale'

const edits: {
    [T in Entity as T['type']]:
        ((transaction: Transaction, entity: T, object: EditableObject) => Entity[]) | undefined
} = {
    bpm: editSelectedBpm,
    timeScale: editSelectedTimeScale,
    cameraEventJoint: editSelectedCameraEvent,
    cameraEventConnection: undefined,
    stageMaskEventJoint: editSelectedStageMaskEvent,
    stageMaskEventConnection: undefined,
    stagePivotEventJoint: editSelectedStagePivotEvent,
    stagePivotEventConnection: undefined,
    stageStyleEventJoint: editSelectedStageStyleEvent,
    stageStyleEventConnection: undefined,
    stageTransformEventJoint: editSelectedStageTransformEvent,
    stageTransformEventConnection: undefined,
    note: editSelectedNote,
    connector: undefined,
}

export type EditOptions = TransactionOptions & {
    /** Edits only these selected objects; the rest stay selected unchanged. */
    only?: (entity: Entity) => boolean
}

// History, notifications, and viewport changes belong to callers. Speculative
// callers can disable automatic group creation to retain unchanged cache keys.
export const createEditedEntitiesState = (
    source: State,
    selected: Entity[],
    object: EditableObject,
    { only, ...options }: EditOptions = {},
): State => {
    const transaction = createTransaction(source, options)
    const single = selected.length === 1 ? selected[0] : undefined
    if (single && only && !only(single)) return transaction.commit(selected)
    if (single?.type === 'bpm') {
        return transaction.commit(editBpm(transaction, single, object))
    }
    if (single?.type === 'timeScale') {
        return transaction.commit(editTimeScale(transaction, single, object))
    }
    return transaction.commit(
        selected.flatMap((entity) =>
            only && !only(entity)
                ? [entity]
                : (edits[entity.type]?.(transaction, entity as never, object) ?? [entity]),
        ),
    )
}
