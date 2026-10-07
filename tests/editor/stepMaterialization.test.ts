import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { StagePivotEventObject } from '../../src/chart/events/stage/pivot'
import type { StageTransformEventObject } from '../../src/chart/events/stage/transform'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { createState, type State } from '../../src/state'
import { getMaterializedNotePositions } from '../../src/state/operations/notePositions'

// An attached note on stage A at beat 2, where A's pivot and elevation step;
// its attachment ends sit on stage B, which never moves. Play holds A's values
// from before the step, so the note materializes at lane 1 and elevation 0.
// tests/browser/stepMaterialization.spec.ts runs the operations that use it.
const groupId = 1 as GroupId
const stageA = 1 as StageId
const stageB = 2 as StageId

const note = (beat: number, center: number, extra: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId: stageB,
    beat,
    noteType: 'default',
    isAttached: false,
    left: center - 1,
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

const pivot = (beat: number, pivotLane: number): StagePivotEventObject => ({
    stageId: stageA,
    beat,
    pivotLane,
    divisionSize: 1,
    divisionParity: 'even',
    yOffset: 0,
    yOffsetBeat: 0,
    eventEase: 'inStep',
})

const transform = (beat: number, elevation: number): StageTransformEventObject => ({
    stageId: stageA,
    beat,
    rotation: 0,
    xTranslation: 0,
    yTranslation: 0,
    elevation,
    anchor: 'default',
    eventEase: 'inStep',
})

// One beat is one second by default.
const state = (slides: NoteObject[][], overrides: Partial<Chart> = {}) => {
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: true,
        bpms: [{ beat: 0, bpm: 60 }],
        groups: new Map([[groupId, { name: 'Default' }]]),
        stages: new Map([
            [
                stageA,
                { name: 'A', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ],
            [
                stageB,
                { name: 'B', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ],
        ]),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [pivot(0, 0), pivot(2, 3)],
        stageStyleEvents: [],
        stageTransformEvents: [transform(0, 0), transform(2, 2)],
        timeScales: [],
        slides,
        ...overrides,
    }
    return createState(chart, 0)
}

const slide = () => [note(0, -3), note(2, 0, { stageId: stageA, isAttached: true }), note(4, 5)]

const allNotes = (source: State) => [...source.store.slides.note.values()].flat()
const held = { left: 0, size: 2, elevation: 0 }

test('a note on a stage step materializes at the held pivot and elevation', () => {
    const source = state([slide()])
    const attached = allNotes(source).find((entity) => entity.isAttached)!
    // Scaling reads the same positions for its bounds.
    assert.deepEqual(getMaterializedNotePositions(source, [attached]).get(attached), held)
})

test('a note on an In-Out Step midpoint an ulp after the jump materializes at the held values', () => {
    // At 150 BPM, beat 3 lands an ulp after the midpoint of beats 1 and 5.
    const inOutStep = { eventEase: 'inOutStep' } as const
    const source = state(
        [[note(0, -3), note(3, 0, { stageId: stageA, isAttached: true }), note(6, 5)]],
        {
            bpms: [{ beat: 0, bpm: 150 }],
            stagePivotEvents: [{ ...pivot(1, 0), ...inOutStep }, pivot(5, 3)],
            stageTransformEvents: [{ ...transform(1, 0), ...inOutStep }, transform(5, 2)],
        },
    )
    const attached = allNotes(source).find((entity) => entity.isAttached)!
    const position = getMaterializedNotePositions(source, [attached]).get(attached)!
    assert.ok(Math.abs(position.left - held.left) < 1e-9, `${position.left}`)
    assert.equal(position.size, held.size)
    assert.equal(position.elevation, held.elevation)
})
