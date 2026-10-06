import { EngineArchetypeDataName, type LevelDataEntity } from '@sonolus/core'
import { serializeStageEventsToLevelDataEntities } from '.'
import { getStoreEntities } from '../..'
import type { StageId } from '../../../../../chart/stages'
import { easeLevelDataValue } from '../../../../../ease'
import type { Store } from '../../../../../state/store'

export const serializeStageMaskEventsToLevelDataEntities = (
    isDynamicStages: boolean,
    stageEntities: Map<StageId, LevelDataEntity> | undefined,
    store: Store,
    getName: () => string,
) => {
    if (!isDynamicStages) return []

    return serializeStageEventsToLevelDataEntities(
        getStoreEntities(store.grid.stageMaskEventConnection),
        store.stageEventRanges.stageMaskEventJoint,
        getName,
        (joint) => ({
            archetype: 'StageMaskChange',
            data: [
                {
                    name: EngineArchetypeDataName.Beat,
                    value: joint.beat,
                },
                {
                    name: 'lane',
                    value: joint.maskLeft + joint.maskSize / 2,
                },
                {
                    name: 'size',
                    value: joint.maskSize / 2,
                },
                {
                    name: 'maskNotes',
                    value: +joint.isMaskNotes,
                },
                {
                    name: 'ease',
                    value: easeLevelDataValue(joint.eventEase),
                },
            ],
        }),
        stageEntities,
        'firstMaskChange',
    )
}
