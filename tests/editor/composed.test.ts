import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { StageMaskEventObject } from '../../src/chart/events/stage/mask'
import type { StagePivotEventObject } from '../../src/chart/events/stage/pivot'
import type { StageStyleEventObject } from '../../src/chart/events/stage/style'
import type { StageTransformEventObject } from '../../src/chart/events/stage/transform'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { ease, eases, isStepEase } from '../../src/ease'
import { createComposedLayout, divisionGridOffset } from '../../src/editor/composed'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import { getStageProps } from '../../src/preview/engine/stage'
import { createState } from '../../src/state'
import { toConnectorEntity } from '../../src/state/entities/slides/connector'
import { toNoteEntity } from '../../src/state/entities/slides/note'
import { beatToTime, calculateBpms } from '../../src/state/integrals/bpms'
import { addBpm } from '../../src/state/mutations/bpm'
import { addStagePivotEventJoint } from '../../src/state/mutations/events/stage/pivot'
import { replaceNote } from '../../src/state/mutations/slides/note'
import { createTransaction } from '../../src/state/transaction'

const groupId = 1 as GroupId
const stageA = 1 as StageId
const stageB = 2 as StageId
const note = (beat: number, left = 0, extra: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId: stageA,
    beat,
    left,
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
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...extra,
})
const pivot = (
    beat: number,
    pivotLane: number,
    extra: Partial<StagePivotEventObject> = {},
): StagePivotEventObject => ({
    stageId: stageA,
    beat,
    pivotLane,
    divisionSize: 2,
    divisionParity: 'even',
    yOffset: 0,
    yOffsetBeat: 0,
    eventEase: 'linear',
    ...extra,
})
const transform = (
    beat: number,
    xTranslation: number,
    extra: Partial<StageTransformEventObject> = {},
): StageTransformEventObject => ({
    stageId: stageA,
    beat,
    xTranslation,
    yTranslation: 0,
    rotation: 0,
    elevation: 0,
    anchor: 'default',
    eventEase: 'linear',
    ...extra,
})
const mask = (
    beat: number,
    maskLeft: number,
    maskSize: number,
    extra: Partial<StageMaskEventObject> = {},
): StageMaskEventObject => ({
    stageId: stageA,
    beat,
    maskLeft,
    maskSize,
    isMaskNotes: false,
    eventEase: 'linear',
    ...extra,
})
const style = (
    beat: number,
    extra: Partial<StageStyleEventObject> = {},
): StageStyleEventObject => ({
    stageId: stageA,
    beat,
    editorLane: 0,
    judgmentLineColor: 'purple',
    judgmentLineStyle: 'default',
    leftBorderStyle: 'medium',
    rightBorderStyle: 'light',
    isFullWidth: false,
    noteAlpha: 1,
    laneAlpha: 1,
    judgmentLineAlpha: 1,
    divisionLineAlpha: 1,
    eventEase: 'linear',
    ...extra,
})
const state = (overrides: Partial<Chart> = {}) =>
    createState(
        {
            initialLife: 1000,
            isDynamicStages: true,
            bpms: [{ beat: 0, bpm: 60 }],
            groups: new Map([[groupId, { name: 'Default' }]]),
            stages: new Map(
                [stageA, stageB].map((id) => [
                    id,
                    {
                        name: `${id}`,
                        isFromStart: true,
                        isUntilEnd: true,
                        generateSimLines: 'global' as const,
                    },
                ]),
            ),
            cameraEvents: [],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            timeScales: [],
            slides: [],
            ...overrides,
        },
        0,
    )
const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('composed notes add pivot and horizontal translation; masks only add translation', () => {
    const source = state({
        stagePivotEvents: [pivot(0, 3)],
        stageTransformEvents: [transform(0, 4)],
        stageMaskEvents: [mask(0, -6, 12)],
        slides: [[note(2, -1)]],
    })
    const layout = createComposedLayout(source)
    const entity = [...source.store.slides.note.values()][0]![0]!
    assert.deepEqual(layout.notePosition(entity), { left: 6, size: 2 })
    assert.deepEqual(layout.hitbox(entity), { lane: 7, beat: 2, w: 1, h: 0.3 })
    assert.equal(layout.stage(stageA, 2)!.left, -2)
    assert.equal(layout.stage(stageA, 2)!.right, 10)
    assert.equal(layout.offset(stageA, -1), 7)
    assert.equal(layout.offset(999 as StageId, 2), 0)
    assert.equal(createComposedLayout(source), layout)
    assert.equal(
        layout.hitbox(
            [...source.store.grid.stagePivotEventJoint.values()][0]!.values().next().value!,
        ),
        [...source.store.grid.stagePivotEventJoint.values()][0]!.values().next().value!.hitbox,
    )
})

test('interpolation uses elapsed seconds across tempo changes and agrees with preview stage evaluation', () => {
    const source = state({
        bpms: [
            { beat: 0, bpm: 60 },
            { beat: 2, bpm: 120 },
        ],
        stagePivotEvents: [pivot(0, 0), pivot(4, 6)],
        stageTransformEvents: [transform(0, 1), transform(4, 4)],
        stageMaskEvents: [mask(0, -6, 12), mask(4, -2, 4)],
        stageStyleEvents: [style(0), style(4, { isFullWidth: true, laneAlpha: 0.2 })],
    })
    const layout = createComposedLayout(source)
    close(layout.offset(stageA, 2), 7)
    const preview = buildPreviewChart(source, 10).stages[0]!
    for (const beat of [0, 1, 2, 2.5, 3, 4, 6]) {
        const expected = getStageProps(preview, beatToTime(source.bpms, beat))
        const actual = layout.stage(stageA, beat)!
        for (const field of [
            'lane',
            'width',
            'pivotLane',
            'xLaneTranslate',
            'fullWidth',
            'laneAlpha',
        ] as const)
            close(actual[field], expected[field])
        assert.deepEqual(actual.leftBorderStyle, expected.leftBorderStyle)
    }
})

test('step boundaries use note-time left limits and right limits for the next stage slice', () => {
    const source = state({
        bpms: [{ beat: 0, bpm: 150 }],
        stagePivotEvents: [pivot(1, 0, { eventEase: 'inOutStep' }), pivot(5, 8)],
        stageTransformEvents: [transform(0, 1, { eventEase: 'none' }), transform(3, 4)],
    })
    const layout = createComposedLayout(source)
    assert.equal(layout.offset(stageA, 3), 1)
    assert.equal(layout.offset(stageA, 3, { rightLimit: true }), 12)
    assert.ok(layout.stages.get(stageA)!.breakpoints.some((beat) => Math.abs(beat - 3) < 1e-9))
})

test('draw lifetime follows mask endpoints and missing masks stay collapsed', () => {
    const source = state({
        stages: new Map([
            [
                stageA,
                { name: 'A', isFromStart: false, isUntilEnd: false, generateSimLines: 'global' },
            ],
        ]),
        stageMaskEvents: [mask(2, -2, 4), mask(6, 0, 2)],
        stagePivotEvents: [pivot(0, 4), pivot(8, 10)],
    })
    const layout = createComposedLayout(source)
    for (const [beat, visible] of [
        [0, false],
        [2, true],
        [4, true],
        [6, true],
        [7, false],
    ] as const)
        assert.equal(layout.stage(stageA, beat)!.visible, visible)
    const empty = createComposedLayout(state()).stage(stageA, 1)!
    assert.equal(empty.width, 0)
    assert.equal(empty.laneAlpha, 0)
})

test('attached cross-stage notes and connectors sample both stage offsets at the intermediate time', () => {
    const source = state({
        stagePivotEvents: [
            pivot(0, 0),
            pivot(4, 8),
            pivot(0, 10, { stageId: stageB }),
            pivot(4, 2, { stageId: stageB }),
        ],
        stageTransformEvents: [transform(0, 2)],
        slides: [
            [
                note(0, -2),
                note(1, 50, { isAttached: true, stageId: stageB }),
                note(4, 4, { stageId: stageB, size: 4 }),
            ],
        ],
    })
    const [head, attached, tail] = [...source.store.slides.note.values()][0]!
    const layout = createComposedLayout(source)
    // At beat 1: head center = -1 + 2 + 2 = 3; tail center = 6 + 8 = 14.
    assert.deepEqual(layout.notePosition(attached!), { left: 4.5, size: 2.5 })
    assert.deepEqual(layout.notePosition(head!), { left: 0, size: 2 })
    assert.deepEqual(layout.notePosition(tail!), { left: 6, size: 4 })
    const connector = [...source.store.slides.connector.values()][0]![0]!
    assert.deepEqual(layout.connectorPosition(connector, 1), { left: 4.5, size: 2.5 })
    assert.equal(layout.hitbox(attached!)!.lane, 5.75)
})

test('ghost attachments use their supplied slide infos and first/last attached flags do not attach', () => {
    const source = state({ stagePivotEvents: [pivot(0, 3)], slides: [[note(0), note(4, 4)]] })
    const layout = createComposedLayout(source)
    const id = [...source.store.slides.note.keys()][0]!
    const head = toNoteEntity(id, note(0, 0, { isAttached: true }))
    const middle = toNoteEntity(id, note(2, 99, { isAttached: true }))
    const tail = toNoteEntity(id, note(4, 4, { isAttached: true }))
    const slideInfos = [head, middle, tail].map((entity) => ({
        note: entity,
        attachHead: head,
        attachTail: tail,
        segmentHead: head,
        segmentTail: tail,
    }))
    assert.equal(layout.notePosition(middle, 2, { slideInfos }).left, 5)
    assert.equal(layout.notePosition(head, 0, { slideInfos }).left, 3)
    assert.equal(layout.notePosition(tail, 4, { slideInfos }).left, 7)
})

test('overshooting attached widths collapse around the interpolated center', () => {
    const source = state({
        slides: [
            [
                note(0, 0, { size: 4, connectorEase: 'outBack' }),
                note(3, 20, { isAttached: true }),
                note(4, 6, { size: 0 }),
            ],
        ],
    })
    const attached = [...source.store.slides.note.values()][0]![1]!
    const position = createComposedLayout(source).notePosition(attached)
    const fraction = ease('outBack', 0.75)
    assert.equal(position.size, 0)
    close(position.left, 2 + 4 * fraction)
})

test('non-dynamic charts preserve notes and hitboxes exactly despite stage events', () => {
    const source = state({
        isDynamicStages: false,
        stagePivotEvents: [pivot(0, 20)],
        slides: [[note(0), note(1, 7, { isAttached: true }), note(3, 4)]],
    })
    const layout = createComposedLayout(source)
    assert.equal(layout.stages.size, 0)
    assert.equal(layout.offset(stageA, 3), 0)
    for (const entity of [...source.store.slides.note.values()].flat()) {
        assert.deepEqual(layout.notePosition(entity), { left: entity.left, size: entity.size })
        assert.equal(layout.hitbox(entity), entity.hitbox)
    }
})

test('connector step pieces hold exact sides of their jump', () => {
    for (const connectorEase of ['none', 'inStep', 'outStep', 'outInStep', 'inOutStep'] as const) {
        const source = state({ slides: [[note(0, 0, { connectorEase }), note(4, 4, { size: 4 })]] })
        const layout = createComposedLayout(source)
        const connector = [...source.store.slides.connector.values()][0]![0]!
        const expected =
            connectorEase === 'outStep'
                ? { left: 4, size: 4 }
                : connectorEase === 'outInStep'
                  ? { left: 2, size: 3 }
                  : { left: 0, size: 2 }
        assert.deepEqual(layout.connectorPosition(connector, 0, { rightLimit: true }), expected)
        assert.deepEqual(layout.connectorPosition(connector, 2), expected)
        assert.deepEqual(
            layout.connectorPosition(connector, 2, { rightLimit: true }),
            connectorEase === 'inOutStep' ? { left: 4, size: 4 } : expected,
        )
    }
})

test('attached connector pieces with matching eased endpoints use a straight fallback', () => {
    const source = state()
    const layout = createComposedLayout(source)
    const id = 100 as import('../../src/state/entities/slides').SlideId
    const head = toNoteEntity(id, note(0, -3.5, { size: 1, connectorEase: 'inBack' }))
    const tail = toNoteEntity(id, note(4, 2.5, { size: 1 }))
    const separator = toNoteEntity(
        id,
        note((4 * 1.70158) / 2.70158, -3.5, {
            size: 1,
            isAttached: true,
            isConnectorSeparator: true,
        }),
    )
    const connector = toConnectorEntity(head, separator, head, tail, head, tail)
    for (const beat of [0, 0.5, 1, 2, separator.beat]) {
        const position = layout.connectorPosition(connector, beat)
        close(position.left, -3.5)
        close(position.size, 1)
    }
})

test('stage geometry is reused across note selections and invalidated by tempo changes', () => {
    const source = state({ stagePivotEvents: [pivot(0, 0), pivot(4, 6)] })
    const first = createComposedLayout(source)
    const selection = createComposedLayout({ ...source, selectedEntities: [] })
    assert.equal(selection, first)
    assert.equal(selection.stages, first.stages)
    const changed = createComposedLayout({
        ...source,
        bpms: calculateBpms([
            { x: 0, y: 0, s: 1 },
            { x: 2, y: 0, s: 0.5 },
        ]),
    })
    assert.notEqual(changed.stages, first.stages)
    assert.equal(first.offset(stageA, 2), 3)
    assert.equal(changed.offset(stageA, 2), 4)
})

test('selection layout reuse invalidates for note, tempo, stage-event and stage-metadata edits', () => {
    const source = state({
        slides: [[note(2), note(4, 0, { isAttached: true }), note(6, 2)]],
        stagePivotEvents: [pivot(0, 0), pivot(8, 8)],
        stageMaskEvents: [mask(0, -6, 12), mask(8, -3, 6)],
    })
    const first = createComposedLayout(source)
    const notes = [...source.store.slides.note.values()][0]!
    assert.equal(createComposedLayout({ ...source, selectedEntities: notes }), first)
    assert.equal(
        createComposedLayout({ ...source, filename: 'Renamed', bgm: { offset: 2 } }),
        first,
    )

    const noteTransaction = createTransaction(source)
    const edited = replaceNote(noteTransaction, notes[0]!, { ...notes[0]!, left: 3 })
    const noteState = noteTransaction.commit(edited)
    const noteLayout = createComposedLayout(noteState)
    assert.notEqual(noteLayout, first)
    assert.equal(noteLayout.stages, first.stages)
    assert.notEqual(
        noteLayout.noteLeft(noteState.selectedEntities[0] as (typeof notes)[number]),
        first.noteLeft(notes[0]!),
    )

    const bpmTransaction = createTransaction(source)
    const bpms = addBpm(bpmTransaction, { beat: 4, bpm: 120 })
    const tempoLayout = createComposedLayout(bpmTransaction.commit(bpms))
    assert.notEqual(tempoLayout, first)
    assert.notEqual(tempoLayout.offset(stageA, 4), first.offset(stageA, 4))

    const stageTransaction = createTransaction(source)
    const event = addStagePivotEventJoint(stageTransaction, pivot(4, -5))
    const stageLayout = createComposedLayout(stageTransaction.commit(event))
    assert.notEqual(stageLayout, first)
    assert.equal(stageLayout.offset(stageA, 4), -5)

    const stages = new Map(source.stages)
    stages.set(stageA, { ...stages.get(stageA)!, isUntilEnd: false })
    const metadataLayout = createComposedLayout({ ...source, stages })
    assert.notEqual(metadataLayout, first)
    assert.equal(metadataLayout.stage(stageA, 10)?.visible, false)
    assert.equal(first.stage(stageA, 10)?.visible, true)

    const staticLayout = createComposedLayout({ ...source, isDynamicStages: false })
    assert.notEqual(staticLayout, first)
    assert.equal(staticLayout.offset(stageA, 4), 0)

    // Revisiting an undo snapshot also refreshes the reusable geometry record.
    assert.equal(createComposedLayout(source), first)
    assert.equal(createComposedLayout({ ...source, selectedEntities: [notes[1]!] }), first)
})

test('event breakpoints preserve the source beat on either side of a rounded time conversion', () => {
    for (const beat of [1322 / 480, 2.975]) {
        const source = state({
            bpms: [
                { beat: 0, bpm: 61 },
                { beat: 7 / 3, bpm: 68 },
            ],
            stagePivotEvents: [pivot(0, 1, { eventEase: 'none' }), pivot(beat, 7)],
        })
        const layout = createComposedLayout(source)
        const breaks = layout.stages.get(stageA)!.breakpoints
        assert.ok(breaks.includes(beat))
        const atEvent = breaks.find((point) => Math.abs(point - beat) < 1e-12)!
        assert.equal(atEvent, beat)
        assert.equal(layout.offset(stageA, atEvent), 1)
        assert.equal(layout.offset(stageA, atEvent, { rightLimit: true }), 7)
    }
})

test('same-time stage events retain the first left value and final right value', () => {
    const source = state({
        stagePivotEvents: [pivot(0, 2), pivot(0, 3), pivot(2, 5), pivot(2, 7), pivot(4, 11)],
        stageMaskEvents: [mask(0, -3, 6, { isMaskNotes: true }), mask(2, -2, 4), mask(2, -1, 2)],
    })
    const layout = createComposedLayout(source)
    assert.equal(layout.offset(stageA, 0), 2)
    assert.equal(layout.offset(stageA, 0, { rightLimit: true }), 3)
    assert.equal(layout.offset(stageA, 2), 5)
    assert.equal(layout.offset(stageA, 2, { rightLimit: true }), 7)
    assert.equal(layout.offset(stageA, 3), 9)
    assert.equal(layout.stage(stageA, 2)!.maskNotes, true)
    assert.equal(layout.stage(stageA, 2, { rightLimit: true })!.maskNotes, false)
    assert.equal(layout.stage(stageA, 2)!.width, 2)
    assert.equal(layout.stage(stageA, 2, { rightLimit: true })!.width, 1)
})

test('mask overshoot collapses width without clipping the moving center or pivot', () => {
    const source = state({
        stageMaskEvents: [mask(0, -2, 4, { eventEase: 'outBack' }), mask(4, 6, 0)],
        stagePivotEvents: [pivot(0, 0, { eventEase: 'outBack' }), pivot(4, 6)],
    })
    const props = createComposedLayout(source).stage(stageA, 3)!
    assert.equal(props.width, 0)
    assert.ok(props.left > 6)
    assert.equal(props.left, props.right)
    close(props.pivotLane, ease('outBack', 0.75) * 6)
})

test('attachments with tiny or coincident time spans use the engine middle fraction', () => {
    for (const span of [0, 1e-7]) {
        const source = state({
            stagePivotEvents: [pivot(0, 2), pivot(0, 4, { stageId: stageB })],
            slides: [
                [
                    note(0, 0, { connectorEase: 'inQuad' }),
                    note(span / 4, 20, { isAttached: true }),
                    note(span, 8, { stageId: stageB, size: 6 }),
                ],
            ],
        })
        const layout = createComposedLayout(source)
        const attached = [...source.store.slides.note.values()][0]![1]!
        // Fraction .5 eased by In Quad is .25; projected centers are 3 and 15.
        assert.deepEqual(layout.notePosition(attached), { left: 4.5, size: 3 })
        const connector = [...source.store.slides.connector.values()][0]![0]!
        assert.deepEqual(layout.connectorPosition(connector, span / 4), { left: 4.5, size: 3 })
    }
})

test('missing stage references stay local while attached notes follow available endpoint stages', () => {
    const missing = 999 as StageId
    const source = state({
        stagePivotEvents: [pivot(0, 4), pivot(0, 100, { stageId: missing })],
        slides: [
            [
                note(0, 0),
                note(2, 0, { isAttached: true, stageId: missing }),
                note(4, 4, { stageId: missing }),
            ],
        ],
    })
    const layout = createComposedLayout(source)
    const notes = [...source.store.slides.note.values()][0]!
    assert.equal(layout.stage(missing, 2), undefined)
    assert.equal(layout.offset(missing, 2), 0)
    assert.equal(layout.noteLeft(notes[1]!), 4)
    assert.equal(layout.noteLeft(notes[2]!), 4)
})

test('ordinary charts remain identical through dynamic option toggles and missing stage references', () => {
    const source = state({
        stagePivotEvents: [pivot(0, 4)],
        slides: [[note(0), note(2, 9, { isAttached: true, stageId: 999 as StageId }), note(4, 4)]],
    })
    const dynamic = createComposedLayout(source)
    const basic = createComposedLayout({ ...source, isDynamicStages: false })
    assert.notEqual(dynamic.stages, basic.stages)
    assert.equal(basic.stages.size, 0)
    assert.equal(basic.offset(stageA, 2), 0)
    for (const entity of [...source.store.slides.note.values()].flat()) {
        assert.deepEqual(basic.notePosition(entity), { left: entity.left, size: entity.size })
        assert.equal(basic.hitbox(entity), entity.hitbox)
    }
    assert.equal(createComposedLayout(source), dynamic)
    assert.equal(dynamic.offset(stageA, 2), 4)
})

test('every continuous ease joins projected attached separator notes across stages and tempo changes', () => {
    for (const connectorEase of eases.filter((value) => !isStepEase(value))) {
        const source = state({
            bpms: [
                { beat: 0, bpm: 150 },
                { beat: 1.5, bpm: 83 },
                { beat: 5, bpm: 227 },
            ],
            stagePivotEvents: [
                pivot(0, -4),
                pivot(8, 7),
                pivot(0, 3, { stageId: stageB }),
                pivot(8, -6, { stageId: stageB }),
            ],
            stageTransformEvents: [transform(0, 1, { eventEase: 'inOutBack' }), transform(8, -2)],
            slides: [
                [
                    note(0, -2, { connectorEase }),
                    note(1, 50, { isAttached: true, isConnectorSeparator: true, stageId: stageB }),
                    note(2, 50, { isAttached: true, isConnectorSeparator: true }),
                    note(4, 3, { stageId: stageB, size: 0.1, connectorEase }),
                    note(6, 50, { isAttached: true, isConnectorSeparator: true }),
                    note(8, -3, { size: 4 }),
                ],
            ],
        })
        const layout = createComposedLayout(source)
        for (const connector of [...source.store.slides.connector.values()].flat()) {
            for (const note of [connector.head, connector.tail]) {
                const expected = layout.notePosition(note)
                const actual = layout.connectorPosition(connector, note.beat)
                close(actual.left, expected.left)
                close(actual.size, expected.size)
            }
        }
    }
})

test('authoring grid phase follows odd parity and odd division size independently of note width', () => {
    for (const divisionParity of ['even', 'odd'] as const) {
        for (const divisionSize of [0, 1, 2, 3, 4, 5]) {
            const phase = divisionParity === 'odd' && divisionSize % 2 === 1 ? 0.5 : 0
            const source = state({
                stagePivotEvents: [pivot(0, 1.25, { divisionParity, divisionSize })],
                stageTransformEvents: [transform(0, -0.25)],
                slides: [1, 2, 3, 4].map((size) => [note(2, phase, { size })]),
            })
            const layout = createComposedLayout(source)
            assert.equal(layout.gridOffset(stageA, 2), phase)
            assert.equal(layout.gridOrigin(stageA, 2), 1 + phase)
            for (const entity of [...source.store.slides.note.values()].flat()) {
                const position = layout.notePosition(entity)
                assert.equal(position.left, layout.gridOrigin(stageA, 2))
                assert.equal(layout.hitbox(entity)!.lane, 1 + phase + entity.size / 2)
            }
        }
    }
})

test('dominant division grids normalize equivalent phases and select the new set at equal weight', () => {
    const start = { size: 2, parity: 1 }
    const end = { size: 3, parity: 1 }
    for (const [progress, phase] of [
        [-0.1, 0],
        [0.49, 0],
        [0.5, 0.5],
        [1.1, 0.5],
    ]) {
        assert.equal(divisionGridOffset({ start, end, progress: progress! }), phase)
    }
    assert.equal(divisionGridOffset({ start, end: { size: 4, parity: 1 }, progress: 0.7 }), 0)
    assert.equal(divisionGridOffset({ start, end: { size: 0, parity: 1 }, progress: 1 }), 0)
    assert.equal(divisionGridOffset({ start, end: { size: -3, parity: 1 }, progress: 1 }), 0)
    assert.equal(divisionGridOffset({ start, end: { size: 3.9, parity: 1 }, progress: 1 }), 0.5)
})

test('grid transitions retain incoming stage-event limits, including same-beat pivots', () => {
    for (const eventEase of ['none', 'inStep', 'outStep', 'inOutStep', 'outInStep'] as const) {
        const source = state({
            stagePivotEvents: [
                pivot(0, 0, { divisionSize: 2, divisionParity: 'odd', eventEase }),
                pivot(4, 0, { divisionSize: 3, divisionParity: 'odd' }),
            ],
        })
        const layout = createComposedLayout(source)
        assert.equal(layout.gridOffset(stageA, 0), 0)
        assert.equal(
            layout.gridOffset(stageA, 0, { rightLimit: true }),
            eventEase === 'outStep' || eventEase === 'outInStep' ? 0.5 : 0,
        )
        if (eventEase === 'inOutStep') {
            assert.equal(layout.gridOffset(stageA, 2), 0)
            assert.equal(layout.gridOffset(stageA, 2, { rightLimit: true }), 0.5)
        }
        assert.equal(
            layout.gridOffset(stageA, 4),
            eventEase === 'none' || eventEase === 'inStep' ? 0 : 0.5,
        )
        assert.equal(layout.gridOffset(stageA, 4, { rightLimit: true }), 0.5)
    }
    const source = state({
        stagePivotEvents: [
            pivot(0, 0, { divisionSize: 3, divisionParity: 'odd' }),
            pivot(0, 0, { divisionSize: 2, divisionParity: 'odd' }),
        ],
    })
    assert.equal(createComposedLayout(source).gridOffset(stageA, 0), 0.5)
    assert.equal(createComposedLayout(source).gridOffset(stageA, 0, { rightLimit: true }), 0)
})

test('grid switching breakpoints follow eased real time across tempo changes', () => {
    const source = state({
        bpms: [
            { beat: 0, bpm: 60 },
            { beat: 2, bpm: 120 },
        ],
        stagePivotEvents: [
            pivot(0, 0, { divisionSize: 2, divisionParity: 'odd', eventEase: 'inQuad' }),
            pivot(4, 0, { divisionSize: 3, divisionParity: 'odd' }),
        ],
    })
    const layout = createComposedLayout(source)
    const switchBeat = 2 + (3 * Math.SQRT1_2 - 2) * 2
    assert.ok(
        layout.stages.get(stageA)!.breakpoints.some((beat) => Math.abs(beat - switchBeat) < 1e-12),
    )
    assert.equal(layout.gridOffset(stageA, switchBeat - 1e-7), 0)
    assert.equal(layout.gridOffset(stageA, switchBeat + 1e-7), 0.5)
})

test('all native ease grid switches split the guides, including repeated elastic and back crossings', () => {
    for (const eventEase of eases) {
        const source = state({
            stagePivotEvents: [
                pivot(0, 0, { divisionSize: 2, divisionParity: 'odd', eventEase }),
                pivot(8, 0, { divisionSize: 3, divisionParity: 'odd' }),
            ],
        })
        const layout = createComposedLayout(source)
        const breaks = layout.stages.get(stageA)!.breakpoints
        if (eventEase === 'outInBack') assert.equal(breaks.length, 5)
        if (eventEase === 'outInElastic') assert.equal(breaks.length, 17)
        for (let i = 1; i < breaks.length; i++) {
            const from = breaks[i - 1]!
            const to = breaks[i]!
            const phase = layout.gridOffset(stageA, (from + to) / 2)
            // Every open strip must use one lattice; test throughout, not only its midpoint.
            for (let sample = 1; sample < 32; sample++) {
                assert.equal(
                    layout.gridOffset(stageA, from + ((to - from) * sample) / 32),
                    phase,
                    `${eventEase}: grid changed inside ${from}..${to}`,
                )
            }
        }
    }
})

test('equivalent divider phases add no guide switches, and static or missing stages use the basic origin', () => {
    const source = state({
        stagePivotEvents: [
            pivot(0, 1, { divisionSize: 2, divisionParity: 'odd', eventEase: 'outInElastic' }),
            pivot(8, 3, { divisionSize: 4, divisionParity: 'odd' }),
        ],
    })
    const layout = createComposedLayout(source)
    assert.deepEqual(layout.stages.get(stageA)!.breakpoints, [0, 8])
    assert.equal(layout.gridOffset(999 as StageId, 2), 0)
    assert.equal(layout.gridOrigin(999 as StageId, 2), 0)
    const basic = createComposedLayout({ ...source, isDynamicStages: false })
    assert.equal(basic.gridOffset(stageA, 2), 0)
    assert.equal(basic.gridOrigin(stageA, 2), 0)
})
