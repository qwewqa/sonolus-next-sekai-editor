import { addStageEventJoint, removeStageEventJoint, replaceStageEventJoint } from '.'
import type { AddMutation, RemoveMutation, ReplaceMutation } from '../..'
import type { StageStyleEventObject } from '../../../../chart/events/stage/style'
import { toStageStyleEventConnectionEntity } from '../../../entities/events/connections/stage/style'
import {
    toStageStyleEventJointEntity,
    type StageStyleEventJointEntity,
} from '../../../entities/events/joints/stage/style'

export const addStageStyleEventJoint: AddMutation<StageStyleEventObject> = ({ store }, object) =>
    addStageEventJoint(
        store,
        object,
        'stageStyleEventJoint',
        toStageStyleEventJointEntity,
        'stageStyleEventConnection',
        toStageStyleEventConnectionEntity,
    )

export const removeStageStyleEventJoint: RemoveMutation<StageStyleEventJointEntity> = (
    { store },
    entity,
) => {
    removeStageEventJoint(
        store,
        entity,
        'stageStyleEventJoint',
        'stageStyleEventConnection',
        toStageStyleEventConnectionEntity,
    )
}

export const replaceStageStyleEventJoint: ReplaceMutation<
    StageStyleEventJointEntity,
    StageStyleEventObject
> = ({ store }, entity, object) =>
    replaceStageEventJoint(
        store,
        entity,
        toStageStyleEventJointEntity(object),
        'stageStyleEventJoint',
        'stageStyleEventConnection',
        toStageStyleEventConnectionEntity,
    )
