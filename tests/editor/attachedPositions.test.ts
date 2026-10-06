import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { attachEasedFrac, buildPreviewChart } from '../../src/preview/engine/chart'
import { createState, type State } from '../../src/state'

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
