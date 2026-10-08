import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { serializeToLevelData } from '../../src/levelData/serialize'
import { attachEasedFrac, buildPreviewChart } from '../../src/preview/engine/chart'
import { createState, type State } from '../../src/state'
import { getMaterializedNotePositions } from '../../src/state/operations/notePositions'

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
    assert.equal(place(1e-7), 1)
    assert.equal(place(1e-6), 1)
    assert.ok(Math.abs(place(3e-6) - -1) < 1e-9)
})
