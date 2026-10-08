import type { EntityOfType, EntityType } from '../entities'

export type StoreGrid = {
    [T in EntityType]: Map<number, Set<EntityOfType<T>>>
}

// Sets read from an earlier state stay shared until their first write. A transaction
// can then update its own buckets without copying them again for every entity.
const bucketOwners = new WeakMap<StoreGrid, WeakSet<object>>()

export const createStoreGridOwnership = (grid: StoreGrid) => {
    bucketOwners.set(grid, new WeakSet())

    return {
        reset() {
            bucketOwners.set(grid, new WeakSet())
        },
        release() {
            bucketOwners.delete(grid)
        },
    }
}

const writableBucket = <T extends EntityType>(
    grid: StoreGrid,
    type: T,
    key: number,
    entities = grid[type].get(key),
) => {
    const owned = bucketOwners.get(grid)
    if (entities && owned?.has(entities)) return entities

    const bucket = new Set(entities)
    grid[type].set(key, bucket)
    owned?.add(bucket)
    return bucket
}

export const beatToKey = (beat: number) => Math.floor(beat)

export const getInStoreGrid = <T extends EntityType>(grid: StoreGrid, type: T, beat: number) => {
    const entities = grid[type].get(Math.floor(beat))
    if (!entities) return

    return [...entities]
}

export const addToStoreGrid = <T extends EntityType>(
    grid: StoreGrid,
    entity: EntityOfType<T>,
    fromBeat: number,
    toBeat = fromBeat,
) => {
    for (let key = Math.floor(fromBeat); key <= Math.floor(toBeat); key++) {
        writableBucket(grid, entity.type, key).add(entity)
    }
}

export const removeFromStoreGrid = <T extends EntityType>(
    grid: StoreGrid,
    entity: EntityOfType<T>,
    fromBeat: number,
    toBeat = fromBeat,
) => {
    for (let key = Math.floor(fromBeat); key <= Math.floor(toBeat); key++) {
        const entities = grid[entity.type].get(key)
        if (!entities) continue

        if (!entities.has(entity)) return

        if (entities.size === 1) {
            grid[entity.type].delete(key)
        } else {
            writableBucket(grid, entity.type, key, entities).delete(entity)
        }
    }
}

/** Swaps an entity for another at the same beat, keeping its place among its neighbours. */
export const replaceInStoreGrid = <T extends EntityType>(
    grid: StoreGrid,
    entity: EntityOfType<T>,
    replacement: EntityOfType<T>,
    fromBeat: number,
    toBeat = fromBeat,
) => {
    for (let key = Math.floor(fromBeat); key <= Math.floor(toBeat); key++) {
        const entities = grid[entity.type].get(key)
        if (!entities?.has(entity)) continue

        const bucket = new Set(
            [...entities].map((other) => (other === entity ? replacement : other)),
        )
        grid[entity.type].set(key, bucket)
        bucketOwners.get(grid)?.add(bucket)
    }
}
