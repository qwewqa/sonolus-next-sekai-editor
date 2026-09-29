import type { StageTransformEventObject } from '../../../../chart/events/stage/transform'
import type { StageTransformEventJointEntity } from '../../../entities/events/joints/stage/transform'
import {
    addStageTransformEventJoint,
    removeStageTransformEventJoint,
} from '../../../mutations/events/stage/transform'
import type { Transaction } from '../../../transaction'

export const editSelectedStageTransformEvent = (
    transaction: Transaction,
    entity: StageTransformEventJointEntity,
    object: Partial<StageTransformEventObject>,
) => {
    removeStageTransformEventJoint(transaction, entity)
    return addStageTransformEventJoint(transaction, {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        rotation: object.rotation ?? entity.rotation,
        xTranslation: object.xTranslation ?? entity.xTranslation,
        yTranslation: object.yTranslation ?? entity.yTranslation,
        elevation: object.elevation ?? entity.elevation,
        anchor: object.anchor ?? entity.anchor,
        eventEase: object.eventEase ?? entity.eventEase,
    })
}
