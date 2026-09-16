import type { GroupId } from '../../chart/groups'
import type { StageId } from '../../chart/stages'
import type { Entity, EntityType } from '../../state/entities'

const layers = {
    timeScale: 0,
    bpm: 1,

    cameraEventConnection: 10,
    cameraEventJoint: 11,

    stageMaskEventConnection: 12,
    stageMaskEventJoint: 13,

    stagePivotEventConnection: 14,
    stagePivotEventJoint: 15,

    stageStyleEventConnection: 16,
    stageStyleEventJoint: 17,

    stageTransformEventConnection: 18,
    stageTransformEventJoint: 19,

    connector: {
        under: {
            active: 20,
            damage: 21,
            guide: 22,
        },
        bottom: {
            active: 23,
            damage: 24,
            guide: 25,
        },
        top: {
            active: 26,
            damage: 27,
            guide: 28,
        },
        over: {
            active: 40,
            damage: 41,
            guide: 42,
        },
    },

    note: 30,
}

const getLayer = (entity: Entity) => {
    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'stageMaskEventJoint':
        case 'stageMaskEventConnection':
        case 'stagePivotEventJoint':
        case 'stagePivotEventConnection':
        case 'stageStyleEventJoint':
        case 'stageStyleEventConnection':
        case 'stageTransformEventJoint':
        case 'stageTransformEventConnection':
        case 'timeScale':
        case 'note':
            return layers[entity.type]
        case 'connector':
            return layers.connector[entity.head.connectorLayer][entity.head.connectorType]
    }
}

const isEntityVisibleByGroup = (entity: Entity, groupId: GroupId | undefined) => {
    if (groupId === undefined) return true

    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'stageMaskEventJoint':
        case 'stageMaskEventConnection':
        case 'stagePivotEventJoint':
        case 'stagePivotEventConnection':
        case 'stageStyleEventJoint':
        case 'stageStyleEventConnection':
        case 'stageTransformEventJoint':
        case 'stageTransformEventConnection':
            return true
        case 'timeScale':
        case 'note':
            return entity.groupId === groupId
        case 'connector':
            return entity.attachHead.groupId === groupId || entity.attachTail.groupId === groupId
    }
}

const isEntityVisibleByStage = (entity: Entity, stageId: StageId | undefined) => {
    if (stageId === undefined) return true

    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'timeScale':
            return true
        case 'note':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return entity.stageId === stageId
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return entity.min.stageId === stageId
        case 'connector':
            return entity.attachHead.stageId === stageId || entity.attachTail.stageId === stageId
    }
}

export type EntityVisibility = {
    groupId: GroupId | undefined
    stageId: StageId | undefined
    visibilities: Record<EntityType, boolean>
    showOtherGroups: boolean
    showOtherStages: boolean
    showOtherObjects: boolean
}

export const orderEntities = (
    entities: Entity[],
    selected: ReadonlySet<Entity>,
    visibility: EntityVisibility,
) =>
    entities
        .map((entity) => ({
            entity,
            isSelected: selected.has(entity),
            isVisibleByGroup: isEntityVisibleByGroup(entity, visibility.groupId),
            isVisibleByStage: isEntityVisibleByStage(entity, visibility.stageId),
            isVisibleByType: visibility.visibilities[entity.type],
            layer: getLayer(entity),
        }))
        .filter(
            (info) =>
                (visibility.showOtherGroups || info.isVisibleByGroup) &&
                (visibility.showOtherStages || info.isVisibleByStage) &&
                (visibility.showOtherObjects || info.isVisibleByType),
        )
        .sort(
            (a, b) =>
                +a.isSelected - +b.isSelected ||
                +(a.isVisibleByGroup && a.isVisibleByStage && a.isVisibleByType) -
                    +(b.isVisibleByGroup && b.isVisibleByStage && b.isVisibleByType) ||
                a.layer - b.layer ||
                b.entity.beat - a.entity.beat,
        )
        .map((info) => ({
            entity: info.entity,
            highlighted: info.isSelected,
            opacity:
                info.isVisibleByGroup && info.isVisibleByStage && info.isVisibleByType ? 1 : 0.25,
        }))
