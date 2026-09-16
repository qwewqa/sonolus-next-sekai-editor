import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { buildPreviewChart, createPreviewChartBuilder } from '../../src/preview/engine/chart'
import type { PreviewChart } from '../../src/preview/engine/model'
import { createState, type State } from '../../src/state'

const groupA = 1 as GroupId
const groupB = 2 as GroupId
const stageA = 1 as StageId
const stageB = 2 as StageId
const speed = 10

const note = (overrides: Partial<NoteObject> = {}): NoteObject => ({
    groupId: groupA,
    stageId: stageA,
    beat: 4,
    noteType: 'default',
    isAttached: false,
    left: -4,
    size: 2,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideColor: 'neutral',
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...overrides,
})

const chart = (): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 120 }],
    groups: new Map([
        [groupA, { name: 'A' }],
        [groupB, { name: 'B', forceNoteSpeed: 7 }],
    ]),
    stages: new Map([
        [stageA, { name: 'A', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' }],
        [stageB, { name: 'B', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' }],
    ]),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [
        {
            stageId: stageA,
            beat: 2,
            pivotLane: 1,
            divisionSize: 2,
            divisionParity: 'even',
            yOffset: 0.2,
            yOffsetBeat: 1,
            eventEase: 'linear',
        },
    ],
    stageStyleEvents: [],
    stageTransformEvents: [],
    timeScales: [
        {
            groupId: groupA,
            beat: 0,
            editorLane: 0,
            timeScale: 1.5,
            skip: 0,
            timeScaleEase: 'none',
            timeScaleTransition: 'timeScale',
            hideNotes: false,
        },
    ],
    slides: [
        [note(), note({ beat: 6, isAttached: true }), note({ beat: 8, left: 0, size: 4 })],
        [
            note({ groupId: groupB, stageId: stageB, left: 2 }),
            note({ groupId: groupB, stageId: stageB, left: 4, beat: 8 }),
        ],
    ],
})

const equalToFreshBuild = (actual: PreviewChart, state: State, noteSpeed = speed) => {
    assert.deepEqual(actual, buildPreviewChart(state, noteSpeed))
}

test('chart cache ignores selection, audio, filename and wrapper-only history changes', () => {
    const source = createState(chart(), 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const selected = source.store.slides.info.values().next().value![0]!.note

    assert.equal(build(source, speed), first)
    assert.equal(
        build(
            {
                ...source,
                selectedEntities: [selected],
                filename: 'renamed.json',
                bgm: { offset: 2 },
                initialLife: 2000,
            },
            speed,
        ),
        first,
    )
})

test('editing one slide reuses other graphs without mutating the previously compiled chart', () => {
    const raw = chart()
    const source = createState(raw, 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const snapshot = structuredClone(first)
    const editedSlide = first.slides[0]!
    const untouchedSlide = first.slides[1]!
    const attached = first.notes.find((value) => value.isAttached)!

    raw.slides[0]![0] = note({ left: -5, size: 4 })
    const replacement = createState(raw, 0)
    const info = new Map(source.store.slides.info)
    const firstId = info.keys().next().value!
    // Match transaction structural sharing: only the edited slide's info array changes.
    info.set(firstId, replacement.store.slides.info.values().next().value!)
    const edited: State = {
        ...source,
        store: { ...source.store, slides: { ...source.store.slides, info } },
    }
    const next = build(edited, speed)
    const newAttached = next.notes.find((value) => value.isAttached)!

    assert.notEqual(next, first)
    assert.equal(next.groups, first.groups)
    assert.equal(next.stages, first.stages)
    assert.equal(next.cameras, first.cameras)
    assert.equal(next.slides[1], untouchedSlide)
    assert.equal(next.slides[1]!.connectors[0], untouchedSlide.connectors[0])
    assert.equal(next.slides[1]!.activeHead, untouchedSlide.activeHead)
    assert.equal(next.slides[1]!.activeTail, untouchedSlide.activeTail)
    assert.notEqual(next.slides[0], editedSlide)
    assert.notEqual(next.slides[0]!.connectors[0], editedSlide.connectors[0])
    assert.notEqual(newAttached, attached)
    assert.equal(newAttached.attachHead, next.slides[0]!.activeHead)
    assert.equal(newAttached.attachTail, next.slides[0]!.activeTail)
    assert.notEqual(newAttached.size, attached.size)
    assert.equal(next.slides[0]!.connectors[0]!.head, newAttached.attachHead)
    assert.equal(next.slides[0]!.connectors[0]!.tail, newAttached.attachTail)
    assert.deepEqual(first, snapshot)
    equalToFreshBuild(next, edited)
})

test('stage event edits rebuild stage geometry while retaining every note and connector', () => {
    const raw = chart()
    const source = createState(raw, 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    raw.stagePivotEvents[0]!.pivotLane = -3
    const replacement = createState(raw, 0)
    const edited: State = {
        ...source,
        store: {
            ...source.store,
            grid: {
                ...source.store.grid,
                stagePivotEventJoint: replacement.store.grid.stagePivotEventJoint,
            },
        },
    }
    const next = build(edited, speed)

    assert.notEqual(next.stages, first.stages)
    assert.equal(next.stages[0]!.pivots[0]!.lane, -3)
    assert.equal(first.stages[0]!.pivots[0]!.lane, 1)
    for (const [index, value] of first.notes.entries()) assert.equal(next.notes[index], value)
    for (const [index, value] of first.connectors.entries()) {
        assert.equal(next.connectors[index], value)
    }
    assert.equal(next.groups, first.groups)
    equalToFreshBuild(next, edited)
})

test('BPM edits invalidate note timing, timescales and stage event timing', () => {
    const raw = chart()
    const source = createState(raw, 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    raw.bpms[0]!.bpm = 240
    const edited = { ...source, bpms: createState(raw, 0).bpms }
    const next = build(edited, speed)

    assert.notEqual(next.notes[0], first.notes[0])
    assert.notEqual(next.groups, first.groups)
    assert.notEqual(next.stages, first.stages)
    assert.equal(next.notes[0]!.targetTime, first.notes[0]!.targetTime / 2)
    assert.equal(next.stages[0]!.pivots[0]!.time, first.stages[0]!.pivots[0]!.time / 2)
    equalToFreshBuild(next, edited)
})

test('timescale edits invalidate scaled note positions and retain unrelated stage geometry', () => {
    const raw = chart()
    const source = createState(raw, 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    raw.timeScales[0]!.timeScale = 3
    const replacement = createState(raw, 0)
    const edited: State = {
        ...source,
        store: {
            ...source.store,
            grid: { ...source.store.grid, timeScale: replacement.store.grid.timeScale },
        },
    }
    const next = build(edited, speed)

    assert.notEqual(next.groups, first.groups)
    assert.notEqual(next.notes[0], first.notes[0])
    assert.equal(next.notes[0]!.targetScaledTime, first.notes[0]!.targetScaledTime * 2)
    assert.equal(next.stages, first.stages)
    equalToFreshBuild(next, edited)
})

test('group reordering refreshes note indexes without changing their scaled positions', () => {
    const source = createState(chart(), 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const edited = { ...source, groups: new Map([...source.groups].reverse()) }
    const next = build(edited, speed)

    assert.notEqual(next.notes[0], first.notes[0])
    assert.equal(next.notes[0]!.groupIndex, 1)
    assert.equal(next.notes[1]!.groupIndex, 0)
    assert.equal(next.notes[0]!.targetScaledTime, first.notes[0]!.targetScaledTime)
    assert.equal(next.groups[0]!.forceNoteSpeed, 7)
    assert.equal(next.stages, first.stages)
    equalToFreshBuild(next, edited)
})

test('stage reordering refreshes note stage indexes and stage event ownership', () => {
    const source = createState(chart(), 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const edited = { ...source, stages: new Map([...source.stages].reverse()) }
    const next = build(edited, speed)

    assert.notEqual(next.notes[0], first.notes[0])
    assert.equal(next.notes[0]!.stageIndex, 1)
    assert.equal(next.notes[1]!.stageIndex, 0)
    assert.equal(next.stages[0]!.pivots.length, 0)
    assert.equal(next.stages[1]!.pivots[0]!.lane, 1)
    assert.equal(next.groups, first.groups)
    equalToFreshBuild(next, edited)
})

test('dynamic stage changes rebuild note assignments and simultaneous line partitions', () => {
    const source = createState(chart(), 0)
    source.stages.get(stageA)!.generateSimLines = 'isolated'
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const edited = { ...source, isDynamicStages: false }
    const next = build(edited, speed)

    assert.equal(first.simLines.length, 0)
    assert.equal(next.simLines.length, 2)
    assert.equal(next.stages.length, 0)
    assert.equal(next.isDynamicStages, false)
    assert.notEqual(next.notes[0], first.notes[0])
    assert.ok(next.notes.every((value) => value.stageIndex === -1))
    assert.equal(next.groups, first.groups)
    equalToFreshBuild(next, edited)
})

test('note speed changes update beat-based stage offsets while reusing note graphs', () => {
    const source = createState(chart(), 0)
    const build = createPreviewChartBuilder()
    const first = build(source, speed)
    const next = build(source, 8)

    assert.notEqual(next.stages[0]!.pivots[0]!.yOffset, first.stages[0]!.pivots[0]!.yOffset)
    for (const [index, value] of first.notes.entries()) assert.equal(next.notes[index], value)
    assert.equal(next.slides[0], first.slides[0])
    assert.equal(next.groups, first.groups)
    equalToFreshBuild(next, source, 8)
})
