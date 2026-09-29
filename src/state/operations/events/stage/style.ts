import type { StageStyleEventObject } from '../../../../chart/events/stage/style'
import type { StageStyleEventJointEntity } from '../../../entities/events/joints/stage/style'
import {
    addStageStyleEventJoint,
    removeStageStyleEventJoint,
} from '../../../mutations/events/stage/style'
import type { Transaction } from '../../../transaction'

export const editSelectedStageStyleEvent = (
    transaction: Transaction,
    entity: StageStyleEventJointEntity,
    object: Partial<StageStyleEventObject>,
) => {
    removeStageStyleEventJoint(transaction, entity)
    return addStageStyleEventJoint(transaction, {
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        editorLane: object.editorLane ?? entity.editorLane,
        judgmentLineColor: object.judgmentLineColor ?? entity.judgmentLineColor,
        judgmentLineStyle: object.judgmentLineStyle ?? entity.judgmentLineStyle,
        leftBorderStyle: object.leftBorderStyle ?? entity.leftBorderStyle,
        rightBorderStyle: object.rightBorderStyle ?? entity.rightBorderStyle,
        isFullWidth: object.isFullWidth ?? entity.isFullWidth,
        noteAlpha: object.noteAlpha ?? entity.noteAlpha,
        laneAlpha: object.laneAlpha ?? entity.laneAlpha,
        judgmentLineAlpha: object.judgmentLineAlpha ?? entity.judgmentLineAlpha,
        divisionLineAlpha: object.divisionLineAlpha ?? entity.divisionLineAlpha,
        eventEase: object.eventEase ?? entity.eventEase,
    })
}
