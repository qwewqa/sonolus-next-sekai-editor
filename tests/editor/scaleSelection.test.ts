import assert from 'node:assert/strict'
import test from 'node:test'
import { createState } from '../../src/state'
import type { EntityOfType, EntityType } from '../../src/state/entities'
import type { SlideId } from '../../src/state/entities/slides'
import {
    canScaleSelection,
    getScaleEntities,
    getScalePivot,
    getScaledSelectionValues,
} from '../../src/state/operations/scaleValues'

const source = <T extends EntityType>(type: T, beat: number, elevation = 0) =>
    Object.freeze({ type, beat, elevation }) as EntityOfType<T>

const emptyState = () =>
    createState(
        {
            initialLife: 1000,
            isDynamicStages: false,
            bpms: [{ beat: 0, bpm: 120 }],
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
    )

test('beat scaling includes every editable event family and anchors the earliest eligible beat', () => {
    const selected = [
        source('note', 8),
        source('bpm', 4),
        source('timeScale', 6),
        source('cameraEventJoint', 2),
        source('stageMaskEventJoint', 3),
        source('stagePivotEventJoint', 5),
        source('stageStyleEventJoint', 7),
        source('stageTransformEventJoint', 9),
    ]
    const connector = source('connector', -100)
    const connection = source('stageTransformEventConnection', -200)
    const selection = [connector, ...selected, connection, selected[0]!]
    assert.deepEqual(getScaleEntities(selection, 'beat'), selected)
    assert.equal(getScalePivot(selection, 'beat'), 2)
    const result = getScaledSelectionValues(selection, 'beat', 1.5)
    assert.ok(result)
    assert.deepEqual([...result.keys()], selected)
    assert.deepEqual([...result.values()], [11, 5, 8, 2, 3.5, 6.5, 9.5, 12.5])
    assert.deepEqual(
        selected.map((entity) => entity.beat),
        [8, 4, 6, 2, 3, 5, 7, 9],
    )
})

test('elevation scaling shares the lowest stored elevation across notes and stage transforms', () => {
    const note = source('note', 1, 3)
    const stage = source('stageTransformEventJoint', 100, -1)
    const ignored = [
        source('cameraEventJoint', -100, -200),
        source('stagePivotEventJoint', 0, -300),
    ]
    const selection = [note, ...ignored, stage]
    assert.deepEqual(getScaleEntities(selection, 'elevation'), [note, stage])
    assert.equal(getScalePivot(selection, 'elevation'), -1)
    assert.equal(canScaleSelection(selection, 'elevation'), true)
    const result = getScaledSelectionValues(selection, 'elevation', 0.5)
    assert.ok(result)
    assert.deepEqual(
        [...result],
        [
            [note, 1],
            [stage, -1],
        ],
    )
    assert.equal(note.beat, 1)
    assert.equal(note.elevation, 3)
    assert.equal(stage.beat, 100)
    assert.equal(stage.elevation, -1)
})

test('fractional scaling preserves the anchor and equal-value ties without quantizing', () => {
    const first = source('note', 1 / 3, 0)
    const tied = source('note', 1 / 3, 0)
    const last = source('note', 2 / 3, 4)
    const beat = getScaledSelectionValues([last, first, tied], 'beat', 0.125)
    assert.ok(beat)
    assert.equal(beat.get(first), 1 / 3)
    assert.equal(beat.get(tied), beat.get(first))
    assert.ok(Math.abs(beat.get(last)! - 0.375) < 1e-12)
    const elevation = getScaledSelectionValues([last, first, tied], 'elevation', 0.25)
    assert.ok(elevation)
    assert.deepEqual([...elevation.values()], [1, 0, 0])
})

test('scaling requires two unique eligible entities with a nonzero span', () => {
    const note = source('note', 4, 2)
    const same = source('note', 4, 2)
    const distinct = source('note', 5, 3)
    const connection = source('cameraEventConnection', 1, -20)
    for (const axis of ['beat', 'elevation'] as const) {
        for (const selected of [[], [note], [note, note], [note, connection], [note, same]]) {
            assert.equal(canScaleSelection(selected, axis), false)
            assert.equal(getScaledSelectionValues(selected, axis, 2), undefined)
        }
        assert.equal(canScaleSelection([note, same, distinct], axis), true)
        assert.equal(canScaleSelection([note, distinct, connection], axis), true)
    }
})

test('invalid selected coordinates reject scaling while ignored connections do not affect it', () => {
    const first = source('note', 0, 0)
    const second = source('note', 2, 2)
    for (const value of [Number.NaN, Infinity, -Infinity]) {
        for (const axis of ['beat', 'elevation'] as const) {
            const invalid = source(
                'note',
                axis === 'beat' ? value : 1,
                axis === 'elevation' ? value : 1,
            )
            assert.equal(canScaleSelection([first, second, invalid], axis), false)
            assert.equal(getScaledSelectionValues([first, second, invalid], axis, 2), undefined)
            const ignored = source('connector', value, value)
            assert.equal(canScaleSelection([first, second, ignored], axis), true)
            assert.deepEqual(
                [...getScaledSelectionValues([first, second, ignored], axis, 2)!.values()],
                [0, 4],
            )
        }
    }
})

test('invalid and unchanged scale factors produce no replacement values', () => {
    const selected = [source('note', 0, -1), source('note', 8, 3)]
    for (const factor of [0, -1, Number.NaN, Infinity, -Infinity, 1]) {
        assert.equal(getScaledSelectionValues(selected, 'beat', factor), undefined)
        assert.equal(getScaledSelectionValues(selected, 'elevation', factor), undefined)
    }
    assert.deepEqual(
        selected.map(({ beat, elevation }) => [beat, elevation]),
        [
            [0, -1],
            [8, 3],
        ],
    )
})

test('overflow and numerical collapse are rejected before any entity is changed', () => {
    const first = source('note', 1e308, 1e308)
    const second = source('note', 1.5e308, 1.5e308)
    for (const axis of ['beat', 'elevation'] as const) {
        assert.equal(getScaledSelectionValues([first, second], axis, 10), undefined)
        assert.equal(getScaledSelectionValues([first, second], axis, Number.MIN_VALUE), undefined)
    }
    assert.equal(first.beat, 1e308)
    assert.equal(second.elevation, 1.5e308)
    const smallest = getScaledSelectionValues(
        [source('note', 0), source('note', 1)],
        'beat',
        Number.MIN_VALUE,
    )
    assert.ok(smallest)
    assert.deepEqual([...smallest.values()], [0, Number.MIN_VALUE])
})

test('attached slide interiors are read-only in elevation while endpoints and beats remain eligible', () => {
    const state = emptyState()
    const slideId = 1 as SlideId
    const head = { ...source('note', 0, 1), slideId, isAttached: true }
    const interior = { ...source('note', 2, 9), slideId, isAttached: true }
    const tail = { ...source('note', 4, 3), slideId, isAttached: true }
    state.store.slides.note.set(slideId, [head, interior, tail])
    assert.deepEqual(getScaleEntities([tail, interior, head], 'elevation', state), [tail, head])
    assert.deepEqual(getScaleEntities([tail, interior, head], 'beat', state), [
        tail,
        interior,
        head,
    ])
    assert.equal(getScalePivot([interior, tail, head], 'elevation', state), 1)
    assert.deepEqual(
        [...getScaledSelectionValues([tail, interior, head], 'elevation', 2, state)!.values()],
        [5, 1],
    )
    assert.equal(interior.elevation, 9)
})

test('connected grid expansion is bounded while large point-grid positions remain allowed', () => {
    const state = emptyState()
    const slideId = 1 as SlideId
    const head = { ...source('note', 0), slideId }
    const tail = { ...source('note', 4), slideId }
    state.store.slides.note.set(slideId, [head, tail])
    const boundary = getScaledSelectionValues([head, tail], 'beat', 250001, state)
    assert.ok(boundary)
    assert.deepEqual([...boundary.values()], [0, 1000004])
    assert.equal(getScaledSelectionValues([head, tail], 'beat', 250001.25, state), undefined)
    assert.equal(getScaledSelectionValues([head, tail], 'beat', 1e12, state), undefined)
    const largePoint = getScaledSelectionValues(
        [source('bpm', 0), source('bpm', 4)],
        'beat',
        1e12,
        state,
    )
    assert.ok(largePoint)
    assert.deepEqual([...largePoint.values()], [0, 4e12])
    assert.deepEqual(
        [...getScaledSelectionValues([head, tail], 'beat', 0.5, state)!.values()],
        [0, 2],
    )
})
