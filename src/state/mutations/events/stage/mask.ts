import { addStageEventJoint, removeStageEventJoint, replaceStageEventJoint } from '.'
import type { AddMutation, RemoveMutation, ReplaceMutation } from '../..'
import type { StageMaskEventObject } from '../../../../chart/events/stage/mask'
import { toStageMaskEventConnectionEntity } from '../../../entities/events/connections/stage/mask'
import {
    toStageMaskEventJointEntity,
    type StageMaskEventJointEntity,
} from '../../../entities/events/joints/stage/mask'

export const addStageMaskEventJoint: AddMutation<StageMaskEventObject> = ({ store }, object) =>
    addStageEventJoint(
        store,
        object,
        'stageMaskEventJoint',
        toStageMaskEventJointEntity,
        'stageMaskEventConnection',
        toStageMaskEventConnectionEntity,
    )

export const removeStageMaskEventJoint: RemoveMutation<StageMaskEventJointEntity> = (
    { store },
    entity,
) => {
    removeStageEventJoint(
        store,
        entity,
        'stageMaskEventJoint',
        'stageMaskEventConnection',
        toStageMaskEventConnectionEntity,
    )
}

export const replaceStageMaskEventJoint: ReplaceMutation<
    StageMaskEventJointEntity,
    StageMaskEventObject
> = ({ store }, entity, object) =>
    replaceStageEventJoint(
        store,
        entity,
        toStageMaskEventJointEntity(object),
        'stageMaskEventJoint',
        'stageMaskEventConnection',
        toStageMaskEventConnectionEntity,
    )
