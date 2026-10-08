import assert from 'node:assert/strict'
import test from 'node:test'
import { createState } from '../../src/state'
import type { Entity } from '../../src/state/entities'
import { toBpmEntity } from '../../src/state/entities/bpm'
import {
    addToStoreGrid,
    createStoreGridOwnership,
    removeFromStoreGrid,
    replaceInStoreGrid,
    type StoreGrid,
} from '../../src/state/store/grid'

const emptyGrid = () =>
    createState(
        {
            initialLife: 1000,
            isDynamicStages: false,
            bpms: [],
            groups: new Map(),
            stages: new Map(),
            slides: [],
            timeScales: [],
            cameraEvents: [],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
        },
        0,
    ).store.grid

const fork = (grid: StoreGrid) => {
    const result = { ...grid }
    for (const [type, map] of Object.entries(grid))
        Object.assign(result, { [type]: new Map<number, Set<Entity>>(map) })
    return result
}

const bpm = (value: number) => toBpmEntity({ beat: 4, bpm: value })

test('owned buckets copy source contents once and preserve insertion order across writes', () => {
    const source = emptyGrid()
    const [a, b, c, d, distant] = [60, 90, 120, 150, 180].map(bpm)
    addToStoreGrid(source, a!, 4)
    addToStoreGrid(source, b!, 4)
    addToStoreGrid(source, distant!, 10)
    const original = source.bpm.get(4)!
    const grid = fork(source)
    const ownership = createStoreGridOwnership(grid)

    addToStoreGrid(grid, c!, 4)
    const owned = grid.bpm.get(4)!
    assert.notEqual(owned, original)
    addToStoreGrid(grid, d!, 4)
    removeFromStoreGrid(grid, a!, 4)
    addToStoreGrid(grid, a!, 4)
    assert.equal(grid.bpm.get(4), owned)
    assert.deepEqual([...owned], [b, c, d, a])
    assert.deepEqual([...original], [a, b])
    assert.equal(grid.bpm.get(10), source.bpm.get(10))
    ownership.release()
})

test('replacement preserves same-beat rank and subsequent writes keep its bucket owned', () => {
    const source = emptyGrid()
    const [a, b, c, replacement, added] = [60, 90, 120, 150, 180].map(bpm)
    for (const entity of [a!, b!, c!]) addToStoreGrid(source, entity, 4)
    const original = source.bpm.get(4)!
    const grid = fork(source)
    const ownership = createStoreGridOwnership(grid)

    replaceInStoreGrid(grid, b!, replacement!, 4)
    const replaced = grid.bpm.get(4)!
    addToStoreGrid(grid, added!, 4)
    assert.equal(grid.bpm.get(4), replaced)
    assert.deepEqual([...replaced], [a, replacement, c, added])
    assert.deepEqual([...original], [a, b, c])
    ownership.release()
})

test('range mutations own each bucket independently and remove empty buckets', () => {
    const source = emptyGrid()
    const [a, b, c] = [60, 90, 120].map(bpm)
    addToStoreGrid(source, a!, 3.5, 5.5)
    addToStoreGrid(source, b!, 4, 5)
    const grid = fork(source)
    const ownership = createStoreGridOwnership(grid)

    addToStoreGrid(grid, c!, 3.5, 5.5)
    const buckets = [3, 4, 5].map((key) => grid.bpm.get(key)!)
    assert.notEqual(buckets[0], buckets[1])
    removeFromStoreGrid(grid, a!, 3.5, 5.5)
    removeFromStoreGrid(grid, c!, 3.5, 5.5)
    assert.equal(grid.bpm.has(3), false)
    assert.deepEqual([...grid.bpm.get(4)!], [b])
    assert.deepEqual([...grid.bpm.get(5)!], [b])
    assert.deepEqual([...source.bpm.get(3)!], [a])
    assert.deepEqual([...source.bpm.get(4)!], [a, b])

    addToStoreGrid(grid, a!, 3)
    const recreated = grid.bpm.get(3)
    addToStoreGrid(grid, c!, 3)
    assert.equal(grid.bpm.get(3), recreated)
    ownership.release()
})

test('resetting ownership protects published buckets and independent forks', () => {
    const grid = emptyGrid()
    const [a, b, c] = [60, 90, 120].map(bpm)
    const ownership = createStoreGridOwnership(grid)
    addToStoreGrid(grid, a!, 4)
    addToStoreGrid(grid, b!, 4)
    const published = fork(grid)
    const publishedBucket = published.bpm.get(4)!
    ownership.reset()
    removeFromStoreGrid(grid, a!, 4)
    assert.notEqual(grid.bpm.get(4), publishedBucket)
    assert.deepEqual([...publishedBucket], [a, b])

    const other = fork(published)
    const otherOwnership = createStoreGridOwnership(other)
    addToStoreGrid(other, c!, 4)
    assert.deepEqual([...grid.bpm.get(4)!], [b])
    assert.deepEqual([...other.bpm.get(4)!], [a, b, c])
    assert.deepEqual([...publishedBucket], [a, b])
    ownership.release()
    otherOwnership.release()
})

test('fresh store construction releases ownership before returning its buckets', () => {
    const grid = emptyGrid()
    const [a, b] = [60, 90].map(bpm)
    addToStoreGrid(grid, a!, 4)
    const published = grid.bpm.get(4)!
    addToStoreGrid(grid, b!, 4)
    assert.notEqual(grid.bpm.get(4), published)
    assert.deepEqual([...published], [a])
})
