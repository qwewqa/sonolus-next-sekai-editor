import { EngineArchetypeDataName, type LevelDataEntity } from '@sonolus/core'
import { serializeEventsToLevelDataEntities } from '.'
import { getStoreEntities } from '..'
import { easeLevelDataValue } from '../../../../ease'
import type { Store } from '../../../../state/store'

export const serializeCameraEventsToLevelDataEntities = (
    isDynamicStages: boolean,
    initialization: LevelDataEntity,
    store: Store,
    getName: () => string,
) => {
    if (!isDynamicStages) return []

    const { ref, entities } = serializeEventsToLevelDataEntities(
        getStoreEntities(store.grid.cameraEventConnection),
        store.globalEventRanges.cameraEventJoint,
        getName,
        (joint) => ({
            archetype: 'CameraChange',
            data: [
                {
                    name: EngineArchetypeDataName.Beat,
                    value: joint.beat,
                },
                {
                    name: 'lane',
                    value: joint.cameraLeft + joint.cameraSize / 2,
                },
                {
                    name: 'size',
                    value: joint.cameraSize / 2,
                },
                {
                    name: 'zoom',
                    value: joint.cameraZoom,
                },
                {
                    name: 'zoomTargetLane',
                    value: joint.cameraZoomTargetLane,
                },
                {
                    name: 'zoomTargetY',
                    value: joint.cameraZoomTargetY,
                },
                {
                    name: 'zoomVerticalAlign',
                    value: zoomVerticalAligns[joint.cameraZoomVerticalAlign],
                },
                {
                    name: 'rotate',
                    value: joint.cameraRotation,
                },
                {
                    name: 'stageTilt',
                    value: joint.cameraStageTilt,
                },
                {
                    name: 'ease',
                    value: easeLevelDataValue(joint.eventEase),
                },
            ],
        }),
    )

    if (ref) {
        initialization.data.push({
            name: 'firstCamera',
            ref,
        })
    }

    return entities
}

const zoomVerticalAligns = {
    default: 0,
    center: 1,
}
