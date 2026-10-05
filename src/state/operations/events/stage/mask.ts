import type { StageMaskEventObject } from '../../../../chart/events/stage/mask'
import { applyEaseEdit, type WithEaseEdits } from '../../../../ease'
import type { StageMaskEventJointEntity } from '../../../entities/events/joints/stage/mask'
import {
    addStageMaskEventJoint,
    removeStageMaskEventJoint,
    replaceStageMaskEventJoint,
} from '../../../mutations/events/stage/mask'
import type { Transaction } from '../../../transaction'

export const editSelectedStageMaskEvent = (
    transaction: Transaction,
    entity: StageMaskEventJointEntity,
    object: Partial<WithEaseEdits<StageMaskEventObject>>,
) => {
    const edited = {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        maskLeft: object.maskLeft ?? entity.maskLeft,
        maskSize: object.maskSize ?? entity.maskSize,
        isMaskNotes: object.isMaskNotes ?? entity.isMaskNotes,
        eventEase: applyEaseEdit(object.eventEase, entity.eventEase),
    }
    // Same-beat joints keep their order on their track.
    if (edited.beat === entity.beat && edited.stageId === entity.stageId)
        return replaceStageMaskEventJoint(transaction, entity, edited)

    removeStageMaskEventJoint(transaction, entity)
    return addStageMaskEventJoint(transaction, edited)
}
