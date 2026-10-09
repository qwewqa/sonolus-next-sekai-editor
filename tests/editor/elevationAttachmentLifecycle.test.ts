import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { serializeToLevelDataEntities } from '../../src/levelData/entities/serialize'
import { createState, type State } from '../../src/state'
import { combineNotes } from '../../src/state/operations/combineNotes'
import { editSelectedNote } from '../../src/state/operations/note'
import { getMaterializedNotePositions } from '../../src/state/operations/notePositions'
import { scaleSelection } from '../../src/state/operations/scaleSelection'
import { splitHold } from '../../src/state/operations/splitHold'
import { createTransaction } from '../../src/state/transaction'

const groupId = 1 as GroupId
const stageA = 1 as StageId
const stageB = 2 as StageId
const note = (elevation: number, extra: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId: stageA,
    beat: 2,
    elevation,
    left: 0,
    size: 2,
    noteType: 'default',
    isAttached: false,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    noteStyle: 'default',
    connectorStyle: 'default',
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'inQuad',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...extra,
})
const chart = (): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 120 }],
    groups: new Map([[groupId, { name: 'Group' }]]),
    stages: new Map(
        [stageA, stageB].map((id) => [
            id,
            { name: `${id}`, isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
        ]),
    ),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    timeScales: [],
    stageTransformEvents: [stageA, stageB].map((stageId, index) => ({
        stageId,
        beat: 0,
        elevation: (index + 1) * 10,
        xTranslation: 0,
        yTranslation: 0,
        rotation: 0,
        anchor: 'default',
        eventEase: 'linear',
    })),
    slides: [
        [
            note(0),
            note(1, { isAttached: true, stageId: stageB }),
            note(4, { left: 4, stageId: stageB }),
        ],
    ],
})
const notes = (source: State) => [...source.store.slides.note.values()].flat()
const rebuild = (source: State) => {
    const serialized = serializeToLevelDataEntities(
        source.initialLife,
        source.isDynamicStages,
        source.store,
        source.groups,
        source.stages,
    ).filter((entity) => entity.data.some((property) => property.name === '#TIMESCALE_GROUP'))
    assert.deepEqual(
        serialized.map((entity) => {
            const property = entity.data.find((property) => property.name === 'elevation')
            return property && 'value' in property ? property.value : 0
        }),
        notes(source).map((note) => note.elevation),
    )
    return createState(
        {
            ...chart(),
            groups: source.groups,
            stages: source.stages,
            slides: [...source.store.slides.note.values()],
            stageTransformEvents: [
                ...new Set(
                    [...source.store.grid.stageTransformEventJoint.values()].flatMap((bucket) => [
                        ...bucket,
                    ]),
                ),
            ],
        },
        0,
    )
}
const fields = (source: State) =>
    notes(source).map(({ beat, elevation, left, size, isAttached }) => ({
        beat,
        elevation,
        left,
        size,
        isAttached,
    }))

test('same-beat attachment heights survive export, rebuild, splitting and combining across stages', () => {
    const source = rebuild(createState(chart(), 0))
    assert.deepEqual(fields(source), [
        { beat: 2, elevation: 0, left: 0, size: 2, isAttached: false },
        { beat: 2, elevation: 1, left: 0.25, size: 2, isAttached: true },
        { beat: 2, elevation: 4, left: 4, size: 2, isAttached: false },
    ])
    const tick = notes(source)[1]!
    const materialized = getMaterializedNotePositions(source, [tick]).get(tick)!
    // Effective height is 10 + (24 - 10) * .25, then expressed in the tick's stage.
    assert.equal(materialized.elevation, -6.5)
    assert.equal(materialized.left, 0.25)
    const split = splitHold(source, [tick])
    assert.equal(split.store.slides.note.size, 2)
    assert.equal(notes(split).find((value) => value.left === 0.25)!.elevation, -6.5)
    assert.equal(notes(split).find((value) => value.left === 0.25)!.isAttached, false)
    const combined = combineNotes(split, notes(split))
    assert.equal(combined.store.slides.note.size, 1)
    assert.deepEqual(fields(rebuild(combined)), fields(combined))
    assert.equal(notes(combined).find((value) => value.left === 0.25)!.elevation, -6.5)
    // The original immutable snapshot retains its own attachment parameter.
    assert.equal(tick.elevation, 1)
    assert.equal(tick.isAttached, true)
})

test('tiny distinct-beat departure and return reactivate the stored elevation without mutating history', () => {
    const original = createState(chart(), 0)
    const transaction = createTransaction(original)
    const tail = notes(original).at(-1)!
    const moved = transaction.commit(editSelectedNote(transaction, tail, { beat: 2 + 1e-7 }))
    assert.equal(notes(moved)[1]!.left, 1)
    assert.equal(notes(moved)[1]!.elevation, 1)
    const back = createTransaction(moved)
    const restored = back.commit(editSelectedNote(back, notes(moved).at(-1)!, { beat: 2 }))
    assert.deepEqual(fields(restored), fields(original))
    assert.equal(notes(moved)[1]!.left, 1)
    assert.equal(notes(original)[1]!.left, 0.25)
    assert.ok(
        notes(restored).includes(restored.selectedEntities[0] as ReturnType<typeof notes>[number]),
    )
})

test('mixed stage and attached elevation scaling applies authored values once and rebuilds derived lanes', () => {
    const original = createState(chart(), 0)
    const [head, tick, tail] = notes(original)
    const stageEvent = [...original.store.grid.stageTransformEventJoint.values()]
        .flatMap((bucket) => [...bucket])
        .find((event) => event.stageId === stageA)!
    const result = scaleSelection(original, [head!, tick!, stageEvent], 'elevation', 2, 0)
    const attached = notes(result).find((note) => note.isAttached)!
    assert.equal(attached.elevation, 2)
    assert.equal(attached.left, 1)
    assert.equal(notes(result).at(-1)!.elevation, tail!.elevation)
    const changedStage = result.selectedEntities.find(
        (entity) => entity.type === 'stageTransformEventJoint',
    )!
    assert.ok(changedStage.type === 'stageTransformEventJoint')
    assert.equal(changedStage.elevation, 20)
    const materialized = getMaterializedNotePositions(result, [attached]).get(attached)!
    assert.equal(materialized.elevation, 2)
    assert.deepEqual(fields(rebuild(result)), fields(result))
    assert.equal(tick!.elevation, 1)
})
