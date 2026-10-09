import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { StageId } from '../../src/chart/stages'
import { sampleComposed } from '../../src/editor/canvas/composedSampling'
import { drawComposedStages } from '../../src/editor/canvas/stages'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { createComposedLayout } from '../../src/editor/composed'
import { createScopeLookup, fullScope } from '../../src/editor/scopeRules'
import { createState } from '../../src/state'
import { calculateBpms } from '../../src/state/integrals/bpms'

const stageId = 1 as StageId
const chart = (): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 120 }],
    groups: new Map(),
    stages: new Map([
        [
            stageId,
            { name: 'Stage', isFromStart: false, isUntilEnd: false, generateSimLines: 'global' },
        ],
    ]),
    cameraEvents: [],
    timeScales: [],
    slides: [],
    stageTransformEvents: [],
    stageMaskEvents: [1, 3].map((beat) => ({
        stageId,
        beat,
        maskLeft: beat - 3,
        maskSize: 4,
        isMaskNotes: false,
        eventEase: 'linear',
    })),
    stagePivotEvents: [
        {
            stageId,
            beat: 0,
            pivotLane: 0,
            divisionSize: 2,
            divisionParity: 'even',
            yOffset: 0,
            yOffsetBeat: 0,
            eventEase: 'linear',
        },
    ],
    stageStyleEvents: [
        {
            stageId,
            beat: 0,
            editorLane: 0,
            judgmentLineColor: 'neutral',
            judgmentLineStyle: 'default',
            leftBorderStyle: 'default',
            rightBorderStyle: 'disabled',
            isFullWidth: false,
            noteAlpha: 1,
            laneAlpha: 1,
            judgmentLineAlpha: 1,
            divisionLineAlpha: 1,
            eventEase: 'linear',
        },
    ],
})

const fixture = (source = chart()) => {
    const fills: { alpha: number; points: number[][] }[] = []
    const strokes: { alpha: number; points: number[][]; clip?: number[][] }[] = []
    let points: number[][] = []
    let clip: number[][] | undefined
    const clips: (number[][] | undefined)[] = []
    const ctx = {
        globalAlpha: 1,
        save() {
            clips.push(clip)
        },
        restore() {
            clip = clips.pop()
        },
        clip() {
            clip = points
        },
        closePath() {},
        beginPath() {
            points = []
        },
        moveTo(...p: number[]) {
            points.push(p)
        },
        lineTo(...p: number[]) {
            points.push(p)
        },
        fill() {
            fills.push({ alpha: this.globalAlpha, points })
        },
        stroke() {
            strokes.push({ alpha: this.globalAlpha, points, clip })
        },
    }
    const state = createState(source, 0)
    const context = {
        ctx,
        state,
        composed: createComposedLayout(state),
        scale: 40,
        ups: -2,
        bounds: { l: -7, r: 7, t: -8, b: 0, w: 14, h: 8 },
    } as unknown as EditorDrawContext
    return { context, fills, strokes }
}

test('composed stage masks respect lifetime, curves, borders and stage scope', () => {
    const { context, fills, strokes } = fixture()
    drawComposedStages(context, { min: 0, max: 8 }, fullScope)
    assert.ok(fills.length > 0)
    assert.deepEqual(fills[0]!.points[0], [-2, -1])
    assert.deepEqual(fills.at(-1)!.points[1], [0, -3])
    assert.ok(fills.flatMap(({ points }) => points).every(([, y]) => y! <= -1 && y! >= -3))
    // Each slice draws authoring guides, one true divider set and the left border.
    assert.equal(strokes.length, fills.length * 3)
    const fullAlpha = fills[0]!.alpha
    fills.length = 0
    drawComposedStages(
        context,
        { min: 0, max: 8 },
        createScopeLookup({ stageId: 2 as StageId, showOtherStages: true }),
    )
    assert.equal(fills[0]!.alpha, fullAlpha * 0.25)
    fills.length = 0
    drawComposedStages(
        context,
        { min: 0, max: 8 },
        createScopeLookup({ stageVisibility: new Map([[stageId, 'hidden']]) }),
    )
    assert.equal(fills.length, 0)
    context.composed = undefined
    drawComposedStages(context, { min: 0, max: 8 }, fullScope)
    assert.equal(fills.length, 0)
})

test('composed sampling follows real time across BPMs and never bridges an event jump', () => {
    const bpms = calculateBpms([
        { x: 0, y: 0, s: 0.5 },
        { x: 2, y: 1, s: 1 },
    ])
    const strips = sampleComposed(bpms, [0, 2, 4], (beat, rightLimit) => ({
        left: beat > 2 || (beat === 2 && rightLimit) ? 10 : 0,
        size: 2,
    }))
    assert.equal(strips[0]!.at(-1)!.left, 0)
    assert.equal(strips[1]![0]!.left, 10)
    assert.equal(strips[0]!.at(-1)!.time, 1)
    assert.equal(strips[1]!.at(-1)!.time, 3)
    assert.ok(strips.flat().every(({ left }) => left === 0 || left === 10))
})

test('all stepped stage masks stay discontinuous rather than drawing a diagonal bridge', () => {
    for (const eventEase of ['none', 'inStep', 'outStep', 'inOutStep'] as const) {
        const source = chart()
        source.stageMaskEvents = source.stageMaskEvents.map((event, i) => ({
            ...event,
            maskLeft: i ? 4 : -4,
            maskSize: 2,
            eventEase,
        }))
        const { context, fills } = fixture(source)
        drawComposedStages(context, { min: 0, max: 4 }, fullScope)
        assert.ok(fills.length > 0, eventEase)
        for (const { points } of fills) {
            assert.equal(points[0]![0], points[1]![0], eventEase)
            assert.ok(points[0]![0] === -4 || points[0]![0] === 4, eventEase)
        }
        if (eventEase === 'inOutStep') {
            assert.ok(fills.some(({ points }) => points[0]![0] === -4))
            assert.ok(fills.some(({ points }) => points[0]![0] === 4))
        }
    }
})

test('invisible and full-width stage styles do not leave masks or dividers behind', () => {
    for (const change of [{ laneAlpha: 0 }, { isFullWidth: true }]) {
        const source = chart()
        source.stageStyleEvents = source.stageStyleEvents.map((event) => ({ ...event, ...change }))
        const { context, fills, strokes } = fixture(source)
        drawComposedStages(context, { min: 0, max: 4 }, fullScope)
        assert.equal(fills.length, 0)
        assert.equal(strokes.length, 0)
    }
})

test('zero division opacity skips both authoring-guide and stage-divider draw calls', () => {
    const source = chart()
    source.stageStyleEvents[0]!.divisionLineAlpha = 0
    const { context, fills, strokes } = fixture(source)
    drawComposedStages(context, { min: 1, max: 3 }, fullScope, 4)
    assert.ok(fills.length > 0)
    // Only the enabled stage border remains, with no invisible clipped strokes.
    assert.equal(strokes.length, fills.length)
    assert.ok(strokes.every(({ clip, alpha }) => !clip && alpha > 0))
})

test('stage subdivision guides follow the translated pivot, clip to masks and stay fainter than true dividers', () => {
    const source = chart()
    source.stagePivotEvents = [1, 3].map((beat) => ({
        ...source.stagePivotEvents[0]!,
        beat,
        pivotLane: beat / 4 + 0.1,
        divisionSize: 2,
        divisionParity: 'odd',
    }))
    source.stageTransformEvents = [
        {
            stageId,
            beat: 0,
            rotation: 0,
            xTranslation: 1,
            yTranslation: 0,
            elevation: 0,
            anchor: 'default',
            eventEase: 'linear',
        },
    ]
    source.stageStyleEvents[0]!.divisionLineAlpha = 0.2
    const { context, strokes } = fixture(source)
    drawComposedStages(context, { min: 1, max: 3 }, fullScope, 4)
    const guides = strokes.filter(({ alpha }) => Math.abs(alpha - 0.02) < 1e-9)
    const divisions = strokes.filter(({ alpha }) => Math.abs(alpha - 0.08) < 1e-9)
    assert.ok(guides.length > 0)
    assert.equal(guides.length, divisions.length)
    for (const guide of guides) {
        assert.equal(guide.clip?.length, 4)
        for (const [x, y] of guide.points) {
            const beat = -y!
            const relative = (x! - (beat / 4 + 0.1 + 1)) * 4
            assert.ok(Math.abs(relative - Math.round(relative)) < 1e-9)
        }
    }
    assert.notDeepEqual(guides[0]!.points, divisions[0]!.points)
})

test('authoring guides remain independent of zero stage divisions and suppress overly dense subdivisions', () => {
    const source = chart()
    source.stagePivotEvents[0]!.divisionSize = 0
    for (const [laneDivision, expected] of [
        [1, true],
        [4, true],
        [8, false],
        [0, false],
        [Infinity, false],
    ] as const) {
        const { context, strokes } = fixture(source)
        drawComposedStages(context, { min: 1, max: 3 }, fullScope, laneDivision)
        assert.equal(
            strokes.some(({ alpha }) => alpha === 0.1),
            expected,
        )
        assert.ok(strokes.every(({ points }) => points.flat().every(Number.isFinite)))
    }
    const { context, strokes } = fixture(source)
    drawComposedStages(
        context,
        { min: 1, max: 3 },
        createScopeLookup({ stageId: 2 as StageId, showOtherStages: true }),
        4,
    )
    assert.ok(strokes.some(({ alpha }) => alpha === 0.025))
})

test('odd stage parity shifts authoring guides only for odd effective division sizes', () => {
    for (const [divisionSize, divisionParity, phase] of [
        [3, 'odd', 0.5],
        [3, 'even', 0],
        [2, 'odd', 0],
        [3.9, 'odd', 0.5],
        [2.9, 'odd', 0],
        [0, 'odd', 0],
    ] as const) {
        const source = chart()
        Object.assign(source.stagePivotEvents[0]!, { divisionSize, divisionParity })
        const { context, fills, strokes } = fixture(source)
        drawComposedStages(context, { min: 1, max: 3 }, fullScope, 1)
        const guides = strokes.filter(({ alpha }) => alpha === 0.1)
        assert.equal(guides.length, fills.length)
        assert.ok(guides.length > 0)
        for (const { points } of guides)
            for (const [x] of points) {
                assert.ok(
                    Math.abs(x! - phase - Math.round(x! - phase)) < 1e-9,
                    `${divisionSize}/${divisionParity}: guide at ${x}`,
                )
            }
    }
})

test('parity guide switches follow eased progress without slanted bridges or duplicate lattices', () => {
    for (const eventEase of ['linear', 'inQuad', 'inOutStep'] as const) {
        const source = chart()
        source.stagePivotEvents = [1, 3].map((beat, index) => ({
            ...source.stagePivotEvents[0]!,
            beat,
            pivotLane: 0,
            divisionSize: index ? 3 : 2,
            divisionParity: 'odd',
            eventEase,
        }))
        const crossing = eventEase === 'inQuad' ? 1 + 2 * Math.sqrt(0.5) : 2
        for (const laneDivision of [1, 2]) {
            const { context, fills, strokes } = fixture(source)
            drawComposedStages(context, { min: 1, max: 3 }, fullScope, laneDivision)
            const guides = strokes.filter(({ alpha }) => alpha === 0.1)
            assert.equal(
                guides.length,
                fills.length,
                'draw exactly one authoring lattice per slice',
            )
            for (const { points } of guides) {
                const from = -points[0]![1]!
                const to = -points[1]![1]!
                assert.ok(!(from < crossing - 1e-9 && to > crossing + 1e-9))
                const phase = (from + to) / 2 < crossing ? 0 : 0.5
                const xs = []
                for (let i = 0; i < points.length; i += 2) {
                    const x = points[i]![0]!
                    assert.equal(x, points[i + 1]![0], 'a discrete phase switch must not slant')
                    assert.ok(
                        Math.abs(
                            (x - phase) * laneDivision - Math.round((x - phase) * laneDivision),
                        ) < 1e-9,
                    )
                    xs.push(x)
                }
                assert.equal(new Set(xs).size, xs.length)
            }
        }
    }
})

test('oscillating parity transitions draw every discrete grid change without diagonal guide artifacts', () => {
    const source = chart()
    source.stagePivotEvents = [1, 3].map((beat, i) => ({
        ...source.stagePivotEvents[0]!,
        beat,
        pivotLane: 0,
        divisionSize: i ? 3 : 2,
        divisionParity: 'odd',
        eventEase: 'outInElastic',
    }))
    const { context, strokes } = fixture(source)
    const layout = context.composed!
    const breaks = layout.stages.get(stageId)!.breakpoints.filter((beat) => beat > 1 && beat < 3)
    assert.equal(breaks.length, 15)
    drawComposedStages(context, { min: 1, max: 3 }, fullScope, 1)
    for (const { points } of strokes.filter(({ alpha }) => alpha === 0.1)) {
        const from = -points[0]![1]!
        const to = -points[1]![1]!
        assert.ok(!breaks.some((beat) => from < beat - 1e-9 && to > beat + 1e-9))
        const phase = layout.gridOffset(stageId, (from + to) / 2)
        for (let i = 0; i < points.length; i += 2) {
            const x = points[i]![0]!
            assert.equal(x, points[i + 1]![0])
            assert.ok(
                Math.abs(x - phase - Math.round(x - phase)) < 1e-9,
                `${from}..${to}: x=${x},phase=${phase}`,
            )
        }
    }
})

test('stage sampling resolves curved pivots even when both mask edges remain static', () => {
    const bpms = calculateBpms([{ x: 0, y: 0, s: 0.5 }])
    const [points] = sampleComposed(
        bpms,
        [0, 64],
        (beat) => ({
            left: -6,
            size: 12,
            pivot: 10 * Math.sin((beat * Math.PI) / 32),
        }),
        { coordinates: (point) => [point.pivot], maxTimeStep: 0.1 },
    )
    assert.ok(points && points.length > 100)
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!
        const b = points[i]!
        assert.ok(b.time - a.time <= 0.1)
        const actualMidpoint = 10 * Math.sin(((a.time + b.time) * Math.PI) / 32)
        assert.ok(Math.abs(actualMidpoint - (a.pivot + b.pivot) / 2) <= 0.01)
    }
})
