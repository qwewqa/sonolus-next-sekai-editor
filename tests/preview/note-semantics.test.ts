import { EngineArchetypeDataName, type LevelDataEntity } from '@sonolus/core'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject, NoteType } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { getNoteVisualType } from '../../src/editor/canvas/notes'
import { serializeSlidesToLevelDataEntities } from '../../src/levelData/entities/serialize/slide'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import { NoteKind, type NoteKindValue } from '../../src/preview/engine/model'
import { createState, type State } from '../../src/state'

const groupId = 1 as GroupId
const stageId = 1 as StageId

const note = (beat: number, properties: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId,
    beat,
    left: -3,
    size: 2,
    noteType: 'default',
    noteStyle: 'default',
    connectorStyle: 'default',
    isCritical: false,
    isAttached: false,
    flickDirection: 'none',
    isFake: false,
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
    ...properties,
})

const state = (slides: NoteObject[][]) =>
    createState(
        {
            initialLife: 1000,
            isDynamicStages: false,
            bpms: [{ beat: 0, bpm: 120 }],
            groups: new Map([[groupId, { name: 'Default' }]]),
            stages: new Map([
                [
                    stageId,
                    {
                        name: 'Default',
                        isFromStart: true,
                        isUntilEnd: true,
                        generateSimLines: 'global',
                    },
                ],
            ]),
            cameraEvents: [],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            timeScales: [],
            slides,
        } satisfies Chart,
        0,
    )

const exported = (source: State) => {
    let nextName = 0
    return serializeSlidesToLevelDataEntities(
        new Map([[groupId, { archetype: 'TimeScaleGroup', data: [] }]]),
        undefined,
        source.store,
        source.stages,
        () => `${++nextName}`,
    )
}

const value = (entity: LevelDataEntity, name: string) => {
    const data = entity.data.find((data) => data.name === name)
    assert.ok(data && 'value' in data)
    return data.value
}

type ExpectedNote = readonly [string, NoteKindValue, ReturnType<typeof getNoteVisualType>]
const tap: ExpectedNote = ['Tap', NoteKind.tap, 'single']
const head: ExpectedNote = ['HeadTap', NoteKind.headTap, 'head']
const tail: ExpectedNote = ['TailRelease', NoteKind.tailRelease, 'tail']
const tick: ExpectedNote = ['Tick', NoteKind.tick, 'tick']
const trace: ExpectedNote = ['Trace', NoteKind.trace, 'trace']
const anchor: ExpectedNote = ['Anchor', NoteKind.anchor, 'anchor']
const damage: ExpectedNote = ['Damage', NoteKind.damage, 'damage']

// Each row covers isolated, active head, active middle, and active tail positions.
const expected: Record<NoteType, readonly ExpectedNote[]> = {
    default: [tap, head, tick, tail],
    forceNonTick: [tap, head, tap, tail],
    forceTick: [tick, tick, tick, tick],
    trace: [
        trace,
        ['HeadTrace', NoteKind.headTrace, 'trace'],
        trace,
        ['TailTrace', NoteKind.tailTrace, 'trace'],
    ],
    anchor: [anchor, anchor, anchor, anchor],
    damage: [damage, damage, damage, damage],
}

const flicks = new Map<NoteKindValue, readonly [string, NoteKindValue]>([
    [NoteKind.tap, ['Flick', NoteKind.flick]],
    [NoteKind.headTap, ['HeadFlick', NoteKind.headFlick]],
    [NoteKind.tailRelease, ['TailFlick', NoteKind.tailFlick]],
    [NoteKind.trace, ['TraceFlick', NoteKind.traceFlick]],
    [NoteKind.headTrace, ['HeadTraceFlick', NoteKind.headTraceFlick]],
    [NoteKind.tailTrace, ['TailTraceFlick', NoteKind.tailTraceFlick]],
])

test('export, preview and Canvas agree on note roles across active positions and explicit types', () => {
    for (const noteType of Object.keys(expected) as NoteType[]) {
        for (const [position, [baseArchetype, baseKind, visualType]] of expected[
            noteType
        ].entries()) {
            for (const isFlick of [false, true]) {
                for (const isCritical of [false, true]) {
                    for (const isFake of [false, true]) {
                        const notes = position ? [note(0), note(1), note(2)] : [note(0)]
                        const index = Math.max(position - 1, 0)
                        notes[index] = note(index, {
                            noteType,
                            flickDirection: isFlick ? 'downLeft' : 'none',
                            isCritical,
                            isFake,
                        })
                        const source = state([notes])
                        const preview = buildPreviewChart(source, 10).notes[index]!
                        const entity = exported(source)[index]!
                        const [archetype, kind] = isFlick
                            ? (flicks.get(baseKind) ?? [baseArchetype, baseKind])
                            : [baseArchetype, baseKind]
                        const color =
                            noteType === 'anchor' || noteType === 'damage'
                                ? ''
                                : isCritical
                                  ? 'Critical'
                                  : 'Normal'
                        const label = `${noteType}, position ${position}, flick ${isFlick}, critical ${isCritical}, fake ${isFake}`
                        assert.equal(
                            entity.archetype,
                            `${isFake ? 'Fake' : ''}${color}${archetype}Note`,
                            label,
                        )
                        assert.equal(preview.kind, kind, label)
                        assert.equal(preview.isCritical, isCritical, label)
                        assert.equal(preview.isFake, isFake, label)
                        const infos = source.store.slides.info.values().next().value!
                        assert.equal(
                            getNoteVisualType(infos[index]!.note, infos),
                            visualType,
                            label,
                        )
                    }
                }
            }
        }
    }
})

test('export and preview share simultaneous-line eligibility and attachment boundaries', () => {
    const slide = [
        note(0, { isAttached: true }),
        note(1, { isAttached: true }),
        note(2, { isAttached: true, noteType: 'forceNonTick', isFake: true }),
        note(3, { isAttached: true, noteType: 'trace' }),
        note(4, { isAttached: true, noteType: 'forceTick' }),
        note(5, { isAttached: true }),
    ]
    const source = state([slide, ...slide.map(({ beat }) => [note(beat, { left: 2 })])])
    const preview = buildPreviewChart(source, 10)
    const entities = exported(source)
    const references = new Map(entities.map((entity) => [entity.name, entity]))
    const simBeats = entities
        .filter(({ archetype }) => archetype === 'SimLine')
        .map((line) => {
            const left = line.data.find(({ name }) => name === 'left')
            assert.ok(left && 'ref' in left)
            const entity = references.get(left.ref)
            assert.ok(entity)
            return value(entity, EngineArchetypeDataName.Beat)
        })
    assert.deepEqual(simBeats, [0, 2, 3, 5])
    assert.deepEqual(
        preview.simLines.map(({ left }) => left.targetTime * 2),
        simBeats,
    )

    const noteEntities = entities.slice(0, slide.length)
    assert.deepEqual(
        noteEntities.map((entity) => value(entity, 'isAttached')),
        [0, 1, 1, 1, 1, 0],
    )
    assert.deepEqual(
        preview.notes.filter(({ lane }) => lane < 0).map(({ isAttached }) => +isAttached),
        [0, 1, 1, 1, 1, 0],
    )
})
