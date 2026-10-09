import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { createComposedLayout } from '../../src/editor/composed'
import { serializeToLevelData } from '../../src/levelData/serialize'
import { attachEasedFrac, buildPreviewChart } from '../../src/preview/engine/chart'
import { createState, type State } from '../../src/state'
import { sameBeatAttachmentFraction } from '../../src/state/entities/slides/attachment'
import { editSelectedNote } from '../../src/state/operations/note'
import { getMaterializedNotePositions } from '../../src/state/operations/notePositions'
import { getNoteFieldsIn } from '../../src/state/operations/properties/noteFields'
import { scaleSelection } from '../../src/state/operations/scaleSelection'
import { getScaleEntities } from '../../src/state/operations/scaleValues'
import { createTransaction } from '../../src/state/transaction'

const groupId = 1 as GroupId
const stageId = 1 as StageId

const note = (beat: number, lane: number, extra: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId,
    beat,
    noteType: 'default',
    isAttached: false,
    left: lane - 1,
    size: 2,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    noteStyle: 'default',
    connectorStyle: 'default',
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...extra,
})

const chart = (bpms: Chart['bpms'], extra: Partial<NoteObject> = {}): Chart => ({
    initialLife: 1000,
    isDynamicStages: false,
    bpms,
    groups: new Map([[groupId, { name: 'Default' }]]),
    stages: new Map([
        [
            stageId,
            { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
        ],
    ]),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    stageTransformEvents: [],
    timeScales: [],
    slides: [
        [
            note(0, -3, extra),
            note(2, 0, { isAttached: true }),
            { ...note(4, 5), left: 3.5, size: 3 },
        ],
    ],
})

const attached = (state: State) =>
    [...state.store.slides.note.values()].flat().find((entity) => entity.isAttached)!

const center = (state: State) => attached(state).left + attached(state).size / 2

// The engine's lane for the tick: its time fraction along the eased attachment.
const engineCenter = (state: State) => {
    const compiled = buildPreviewChart(state, 6).notes.find((entity) => entity.isAttached)!
    return -3 + 8 * attachEasedFrac(compiled)
}

test('attached notes sit at their time fraction when the BPM changes inside the slide', () => {
    // 60 BPM, then 120 BPM: beat 2 is 1.5 s into a 2.5 s slide.
    const state = createState(
        chart([
            { beat: 0, bpm: 60 },
            { beat: 1, bpm: 120 },
        ]),
        0,
    )
    assert.ok(Math.abs(center(state) - 1.8) < 1e-12)
    assert.ok(Math.abs(center(state) - engineCenter(state)) < 1e-12)
})

test('attached notes follow the ease at their time fraction', () => {
    const state = createState(
        chart(
            [
                { beat: 0, bpm: 60 },
                { beat: 1, bpm: 120 },
            ],
            { connectorEase: 'inQuad' },
        ),
        0,
    )
    assert.ok(Math.abs(center(state) - (-3 + 8 * 0.36)) < 1e-12)
    assert.ok(Math.abs(center(state) - engineCenter(state)) < 1e-12)
    const compiled = buildPreviewChart(state, 6).notes.find((entity) => entity.isAttached)!
    assert.ok(Math.abs(attached(state).size - compiled.size * 2) < 1e-12)
})

test('attached notes export clean lanes when their time fraction carries float noise', () => {
    // At 70 BPM the tick's time fraction is 0.4999999999999997, not 0.5.
    const state = createState(
        {
            ...chart([
                { beat: 0, bpm: 60 },
                { beat: 1, bpm: 70 },
            ]),
            slides: [
                [
                    note(3, -3),
                    note(4, 0, { isAttached: true }),
                    { ...note(5, 0), left: 3, size: 4 },
                ],
            ],
        },
        0,
    )
    const { entities } = serializeToLevelData(
        state.initialLife,
        state.isDynamicStages,
        0,
        state.store,
        state.groups,
        state.stages,
    )
    const value = (entity: (typeof entities)[number], name: string) =>
        (entity.data.find((item) => item.name === name && 'value' in item) as { value: number })
            ?.value
    const tick = entities.find((entity) => value(entity, 'isAttached') === 1)!
    assert.deepEqual([value(tick, 'lane'), value(tick, 'size')], [1, 1.5])
    // Materializing it, as Make Vertical does, places it as cleanly.
    const { left, size } = getMaterializedNotePositions(state, [attached(state)]).get(
        attached(state),
    )!
    assert.deepEqual([left, size], [-0.5, 3])
})

test('attached notes take the middle of a slide shorter than the engine resolves', () => {
    // At 120 BPM, under 2e-6 beats is under 1e-6 s, which the engine treats as no span.
    const place = (gap: number) => {
        const state = createState(
            {
                ...chart([{ beat: 0, bpm: 120 }]),
                slides: [
                    [note(1, -3), note(1 + gap / 4, 0, { isAttached: true }), note(1 + gap, 5)],
                ],
            },
            0,
        )
        assert.ok(Math.abs(center(state) - engineCenter(state)) < 1e-9)
        return center(state)
    }
    // A same-beat head and tail.
    assert.equal(place(0), 1)
    assert.equal(place(1e-7), 1)
    assert.equal(place(1e-6), 1)
    assert.ok(Math.abs(place(3e-6) - -1) < 1e-9)
})

test('attached notes are stored with clean lanes', () => {
    // A fifth of the way along, lerp(-4, 3, 0.2) is -2.5999999999999996.
    const state = createState(
        {
            ...chart([{ beat: 0, bpm: 120 }]),
            slides: [[note(0, -3), note(1, 0, { isAttached: true }), note(5, 4)]],
        },
        0,
    )
    assert.deepEqual([attached(state).left, attached(state).size], [-2.6, 2])
})

test('materialized attached notes drop the float noise a kept tick carries', () => {
    // Within 1e-9 of its place, a tick keeps its stored size.
    const state = createState(
        {
            ...chart([{ beat: 0, bpm: 60 }]),
            slides: [
                [
                    note(3, -3),
                    { ...note(4, 0, { isAttached: true }), left: -0.5, size: 3.0000000000000004 },
                    { ...note(5, 0), left: 3, size: 4 },
                ],
            ],
        },
        0,
    )
    assert.equal(attached(state).size, 3.0000000000000004)
    const { left, size } = getMaterializedNotePositions(state, [attached(state)]).get(
        attached(state),
    )!
    assert.deepEqual([left, size], [-0.5, 3])
})

const elevationAttachment = (head = 0, own = 2, tail = 4, tailBeat = 2) =>
    createState(
        {
            ...chart([{ beat: 0, bpm: 120 }]),
            isDynamicStages: true,
            slides: [
                [
                    note(2, 0, { elevation: head, size: 2, connectorEase: 'inQuad' }),
                    note(2, 99, { elevation: own, isAttached: true }),
                    note(tailBeat, 4, { elevation: tail, left: 2, size: 4 }),
                ],
            ],
        },
        0,
    )

test('same-beat attachments ease lanes and widths from each stored elevation', () => {
    for (const [head, own, tail, fraction] of [
        [0, 1, 4, 0.25],
        [0, 2, 4, 0.5],
        [4, 3, 0, 0.25],
        [0, -1, 4, 0],
        [0, 5, 4, 1],
        [3, 3, 3, 0.5],
        [3, 100, 3 + 1e-7, 0.5],
    ]) {
        const source = elevationAttachment(head, own, tail)
        const tick = attached(source)
        const eased = fraction! ** 2
        assert.equal(tick.left + tick.size / 2, 4 * eased)
        assert.equal(tick.size, 2 + 2 * eased)
        assert.equal(tick.elevation, own)
        assert.deepEqual(createComposedLayout(source).notePosition(tick), {
            left: tick.left,
            size: tick.size,
        })
        assert.equal(getNoteFieldsIn(source.store, tick).elevation, true)
        assert.deepEqual(getScaleEntities([tick], 'width', source), [])
        assert.deepEqual(getScaleEntities([tick], 'elevation', source), [tick])
    }
})

test('elevation attachment domain requires exact authored beat equality', () => {
    const source = elevationAttachment(0, 4, 4, 2 + 1e-7)
    const tick = attached(source)
    // A tiny but distinct time span keeps the existing midpoint-time fallback.
    assert.equal(center(source), 1)
    assert.equal(getNoteFieldsIn(source.store, tick).elevation, false)
    assert.deepEqual(getScaleEntities([tick], 'elevation', source), [])
    assert.equal(
        sameBeatAttachmentFraction(
            { beat: 2, elevation: 0 },
            { beat: 2 + 1e-7, elevation: 4 },
            tick,
        ),
        undefined,
    )
})

test('editing or scaling stored elevation rebuilds attached geometry without detaching', () => {
    const source = elevationAttachment()
    const original = attached(source)
    const transaction = createTransaction(source)
    const selection = editSelectedNote(transaction, original, { elevation: 1 })
    const edited = transaction.commit(selection)
    assert.equal(center(edited), 0.25)
    assert.equal(attached(edited).elevation, 1)
    assert.equal(attached(edited).isAttached, true)
    assert.equal(center(source), 1)
    const head = [...edited.store.slides.note.values()][0]![0]!
    const scaled = scaleSelection(edited, [head, attached(edited)], 'elevation', 2, 0)
    assert.equal(center(scaled), 1)
    assert.equal(attached(scaled).elevation, 2)
    assert.equal(attached(scaled).isAttached, true)
})

test('same-beat materialization keeps effective elevation at the raw attachment fraction', () => {
    const source = elevationAttachment(0, 1, 4)
    const tick = attached(source)
    const position = getMaterializedNotePositions(source, [tick]).get(tick)!
    assert.equal(position.elevation, 1)
    assert.equal(position.left + position.size / 2, 0.25)
    assert.equal(position.size, 2.125)
})

test('stored attached elevation survives exact-to-distinct beat edits', () => {
    const restored = elevationAttachment(0, 1, 4)
    assert.equal(attached(restored).elevation, 1)
    assert.equal(center(restored), 0.25)
    const tail = [...restored.store.slides.note.values()][0]!.at(-1)!
    const transaction = createTransaction(restored)
    const selected = editSelectedNote(transaction, tail, { beat: 4 })
    const distinct = transaction.commit(selected)
    assert.equal(attached(distinct).elevation, 1)
    assert.equal(center(distinct), 0)
    assert.equal(getNoteFieldsIn(distinct.store, attached(distinct)).elevation, false)
    // The immutable old snapshot keeps both its parameter and original derived lane.
    assert.equal(center(restored), 0.25)
})
