import type { StageTransformEventObject } from '../../../../chart/events/stage/transform'
import { applyEaseEdit, type WithEaseEdits } from '../../../../ease'
import type { StageTransformEventJointEntity } from '../../../entities/events/joints/stage/transform'
import {
    addStageTransformEventJoint,
    removeStageTransformEventJoint,
    replaceStageTransformEventJoint,
} from '../../../mutations/events/stage/transform'
import type { Transaction } from '../../../transaction'

export const editSelectedStageTransformEvent = (
    transaction: Transaction,
    entity: StageTransformEventJointEntity,
    object: Partial<WithEaseEdits<StageTransformEventObject>>,
) => {
    const edited = {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        rotation: object.rotation ?? entity.rotation,
        xTranslation: object.xTranslation ?? entity.xTranslation,
        yTranslation: object.yTranslation ?? entity.yTranslation,
        elevation: object.elevation ?? entity.elevation,
        anchor: object.anchor ?? entity.anchor,
        eventEase: applyEaseEdit(object.eventEase, entity.eventEase),
    }
    // Same-beat joints keep their order on their track.
    if (edited.beat === entity.beat && edited.stageId === entity.stageId)
        return replaceStageTransformEventJoint(transaction, entity, edited)

    removeStageTransformEventJoint(transaction, entity)
    return addStageTransformEventJoint(transaction, edited)
}
