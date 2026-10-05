import type { TimeScaleObject } from '../../chart/timeScale'
import { applyEaseEdit, type WithEaseEdits } from '../../ease'
import type { TimeScaleEntity } from '../entities/timeScale'
import { addTimeScale, removeTimeScale, replaceTimeScale } from '../mutations/timeScale'
import { getInStoreGrid } from '../store/grid'
import type { Transaction } from '../transaction'

export const editSelectedTimeScale = (
    transaction: Transaction,
    entity: TimeScaleEntity,
    object: Partial<WithEaseEdits<TimeScaleObject>>,
) => {
    const edited = {
        groupId: object.groupId ?? entity.groupId,
        beat: object.beat ?? entity.beat,
        editorLane: object.editorLane ?? entity.editorLane,
        timeScale: object.timeScale ?? entity.timeScale,
        skip: object.skip ?? entity.skip,
        timeScaleEase: applyEaseEdit(object.timeScaleEase, entity.timeScaleEase),
        timeScaleTransition: object.timeScaleTransition ?? entity.timeScaleTransition,
        hideNotes: object.hideNotes ?? entity.hideNotes,
    }
    // Same-beat time scales keep their order.
    if (edited.beat === entity.beat) return replaceTimeScale(transaction, entity, edited)

    removeTimeScale(transaction, entity)
    return addTimeScale(transaction, edited)
}

export const editTimeScale = (
    transaction: Transaction,
    entity: TimeScaleEntity,
    object: Partial<WithEaseEdits<TimeScaleObject>>,
) => {
    const beat = object.beat ?? entity.beat
    const groupId = object.groupId ?? entity.groupId
    if (beat !== entity.beat) {
        const overlap = getInStoreGrid(transaction.store.grid, 'timeScale', beat)?.find(
            (candidate) => candidate.beat === beat && candidate.groupId === groupId,
        )
        if (overlap) removeTimeScale(transaction, overlap)
    }
    return editSelectedTimeScale(transaction, entity, object)
}
