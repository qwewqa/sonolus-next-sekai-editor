import type { Entity, EntityHitbox } from '../../state/entities'
import type { ConnectorEntity } from '../../state/entities/slides/connector'
import { computedArray } from '../../utils/array'
import type { Range } from '../../utils/range'

export const isConnectorVisible = (entity: ConnectorEntity) =>
    entity.tail.beat > entity.head.beat &&
    (entity.segmentHead.connectorType !== 'guide' ||
        entity.segmentHead.connectorGuideAlpha !== 0 ||
        entity.segmentTail.connectorGuideAlpha !== 0)

export const computedVisibleEntities = (
    getEntities: () => Entity[],
    getRange: () => Range<number>,
) =>
    computedArray(() => {
        const { min, max } = getRange()

        return getEntities().filter((entity) => isEntityInBeatRange(entity, min, max))
    })

export const isEntityInBeatRange = (entity: Entity, min: number, max: number) => {
    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
        case 'timeScale':
        case 'note':
            return entity.beat >= min && entity.beat <= max
        case 'cameraEventConnection':
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return entity.min.beat <= max && entity.max.beat >= min
        case 'connector':
            return entity.head.beat <= max && entity.tail.beat >= min
    }
}

export const isHitboxInView = (
    hitbox: EntityHitbox,
    y: number,
    viewBox: { l: number; r: number; t: number; b: number },
    strokePadding = 0,
) =>
    hitbox.lane + hitbox.w + 0.1 + strokePadding >= viewBox.l &&
    hitbox.lane - hitbox.w - 0.1 - strokePadding <= viewBox.r &&
    y + hitbox.h + 0.1 + strokePadding >= viewBox.t &&
    y - hitbox.h - 0.1 - strokePadding <= viewBox.b
