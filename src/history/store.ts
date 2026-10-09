import { computed } from 'vue'
import { state } from '.'
import { getComposedLayout } from '../editor/composedView'
import { view } from '../editor/view'
import { settings } from '../settings'
import type { State } from '../state'
import type { Entity, EntityOfType, EntityType } from '../state/entities'
import { beatToTime, timeToBeat } from '../state/integrals/bpms'
import type { Store } from '../state/store'
import { beatToKey } from '../state/store/grid'

export const store = computed(() => state.value.store)

export const walkAllEntities = (callback: (entity: Entity) => void) => {
    for (const map of Object.values(store.value.grid)) {
        for (const entities of map.values()) {
            entities.forEach(callback)
        }
    }
}

export const getAllEntities = () => {
    const entities = new Set<Entity>()

    walkAllEntities((entity) => entities.add(entity))

    return entities
}

export const cullEntities = <T extends EntityType>(
    type: T,
    minKey: number,
    maxKey: number,
    source: Store = store.value,
) => {
    if (!Number.isFinite(maxKey)) maxKey = minKey

    const culled = new Set<EntityOfType<T>>()

    for (let i = minKey; i <= maxKey; i++) {
        const entities = source.grid[type].get(i)
        if (!entities) continue

        for (const entity of entities) {
            culled.add(entity)
        }
    }

    return culled
}

export const cullAllEntities = (minKey: number, maxKey: number, source: Store = store.value) => {
    if (!Number.isFinite(maxKey)) maxKey = minKey

    const culled = new Set<Entity>()

    for (const map of Object.values(source.grid)) {
        for (let i = minKey; i <= maxKey; i++) {
            const entities = map.get(i)
            if (!entities) continue

            for (const entity of entities) {
                culled.add(entity)
            }
        }
    }

    return culled
}

export const hitEntities = <T extends EntityType>(
    type: T,
    laneMin: number,
    laneMax: number,
    timeMin: number,
    timeMax: number,
    minimumNoteWidth = 0,
    source: State = state.value,
) =>
    hitEntitiesByGetter(
        laneMin,
        laneMax,
        timeMin,
        timeMax,
        (minKey, maxKey) => cullEntities(type, minKey, maxKey, source.store),
        minimumNoteWidth,
        source,
    )

export const hitAllEntities = (
    laneMin: number,
    laneMax: number,
    timeMin: number,
    timeMax: number,
    minimumNoteWidth = 0,
    source: State = state.value,
) =>
    hitEntitiesByGetter(
        laneMin,
        laneMax,
        timeMin,
        timeMax,
        (minKey, maxKey) => cullAllEntities(minKey, maxKey, source.store),
        minimumNoteWidth,
        source,
    )

const hitEntitiesByGetter = <T extends Entity>(
    laneMin: number,
    laneMax: number,
    timeMin: number,
    timeMax: number,
    getEntities: (minKey: number, maxKey: number) => Set<T>,
    minimumNoteWidth: number,
    source: State,
) => {
    const integrals = source.bpms
    const composed = getComposedLayout(source)
    const spu = view.w / settings.width / settings.pps

    // Include the tallest hitbox (BPM, h = 0.4) across beat-bucket boundaries.
    // The exact hitbox filter below still decides which objects are selected.
    const minKey = beatToKey(timeToBeat(integrals, Math.max(0, timeMin - 0.4 * spu)))
    const maxKey = beatToKey(timeToBeat(integrals, Math.max(0, timeMax + 0.4 * spu)))

    return [...getEntities(minKey, maxKey)].filter((entity) => {
        const { type } = entity
        const hitbox = composed ? composed.hitbox(entity) : entity.hitbox
        if (!hitbox) return false

        const { lane } = hitbox
        const w = type === 'note' ? Math.max(hitbox.w, minimumNoteWidth / 2) : hitbox.w
        const h = hitbox.h * spu

        const time = beatToTime(integrals, hitbox.beat)

        return laneMax > lane - w && laneMin < lane + w && timeMax > time - h && timeMin < time + h
    })
}
