import type { StagePivotEventObject } from '../../../../chart/events/stage/pivot'
import type { StagePivotEventJointEntity } from '../../../entities/events/joints/stage/pivot'
import {
    addStagePivotEventJoint,
    removeStagePivotEventJoint,
} from '../../../mutations/events/stage/pivot'
import type { Transaction } from '../../../transaction'

export const editSelectedStagePivotEvent = (
    transaction: Transaction,
    entity: StagePivotEventJointEntity,
    object: Partial<StagePivotEventObject>,
) => {
    removeStagePivotEventJoint(transaction, entity)
    return addStagePivotEventJoint(transaction, {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        pivotLane: object.pivotLane ?? entity.pivotLane,
        divisionSize: object.divisionSize ?? entity.divisionSize,
        divisionParity: object.divisionParity ?? entity.divisionParity,
        yOffset: object.yOffset ?? entity.yOffset,
        yOffsetBeat: object.yOffsetBeat ?? entity.yOffsetBeat,
        eventEase: object.eventEase ?? entity.eventEase,
    })
}
