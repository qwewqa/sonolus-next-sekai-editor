import type { Entity } from '../../state/entities'

// Classify a selection once, outside the per-entity move/paste loops.
export const getOnlyEntityType = (entities: readonly Entity[]) => {
    const type = entities[0]?.type
    return entities.every((entity) => entity.type === type) ? type : undefined
}
