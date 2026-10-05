import { addStageEventJoint, removeStageEventJoint, replaceStageEventJoint } from '.'
import type { AddMutation, RemoveMutation, ReplaceMutation } from '../..'
import type { StageTransformEventObject } from '../../../../chart/events/stage/transform'
import { toStageTransformEventConnectionEntity } from '../../../entities/events/connections/stage/transform'
import {
    toStageTransformEventJointEntity,
    type StageTransformEventJointEntity,
} from '../../../entities/events/joints/stage/transform'

export const addStageTransformEventJoint: AddMutation<StageTransformEventObject> = (
    { store },
    object,
) =>
    addStageEventJoint(
        store,
        object,
        'stageTransformEventJoint',
        toStageTransformEventJointEntity,
        'stageTransformEventConnection',
        toStageTransformEventConnectionEntity,
    )

export const removeStageTransformEventJoint: RemoveMutation<StageTransformEventJointEntity> = (
    { store },
    entity,
) => {
    removeStageEventJoint(
        store,
        entity,
        'stageTransformEventJoint',
        'stageTransformEventConnection',
        toStageTransformEventConnectionEntity,
    )
}

export const replaceStageTransformEventJoint: ReplaceMutation<
    StageTransformEventJointEntity,
    StageTransformEventObject
> = ({ store }, entity, object) =>
    replaceStageEventJoint(
        store,
        entity,
        toStageTransformEventJointEntity(object),
        'stageTransformEventJoint',
        'stageTransformEventConnection',
        toStageTransformEventConnectionEntity,
    )
