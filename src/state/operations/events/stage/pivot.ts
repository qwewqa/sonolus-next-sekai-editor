import type { StagePivotEventObject } from '../../../../chart/events/stage/pivot'
import { applyEaseEdit, type WithEaseEdits } from '../../../../ease'
import type { StagePivotEventJointEntity } from '../../../entities/events/joints/stage/pivot'
import {
    addStagePivotEventJoint,
    removeStagePivotEventJoint,
    replaceStagePivotEventJoint,
} from '../../../mutations/events/stage/pivot'
import type { Transaction } from '../../../transaction'

export const editSelectedStagePivotEvent = (
    transaction: Transaction,
    entity: StagePivotEventJointEntity,
    object: Partial<WithEaseEdits<StagePivotEventObject>>,
) => {
    const edited = {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        pivotLane: object.pivotLane ?? entity.pivotLane,
        divisionSize: object.divisionSize ?? entity.divisionSize,
        divisionParity: object.divisionParity ?? entity.divisionParity,
        yOffset: object.yOffset ?? entity.yOffset,
        yOffsetBeat: object.yOffsetBeat ?? entity.yOffsetBeat,
        eventEase: applyEaseEdit(object.eventEase, entity.eventEase),
    }
    // Same-beat joints keep their order on their track.
    if (edited.beat === entity.beat && edited.stageId === entity.stageId)
        return replaceStagePivotEventJoint(transaction, entity, edited)

    removeStagePivotEventJoint(transaction, entity)
    return addStagePivotEventJoint(transaction, edited)
}
