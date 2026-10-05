import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { StageId } from '../../src/chart/stages'
import type { TimeScaleObject } from '../../src/chart/timeScale'
import { drawEvent, drawEventInfinities } from '../../src/editor/canvas/events'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { getPathD } from '../../src/editor/entities/events/path'
import { createScopeLookup, fullScope } from '../../src/editor/scopeRules'
import { createState } from '../../src/state'
import type { EntityType } from '../../src/state/entities'
import type { StageMaskEventJointEntity } from '../../src/state/entities/events/joints/stage/mask'
import type { TimeScaleEntity } from '../../src/state/entities/timeScale'
import { calculateBpms } from '../../src/state/integrals/bpms'

class RecordingCanvas {
    globalAlpha = 1
    lineWidth = 1
    lineCap = 'butt'
    lineJoin = 'miter'
    strokeStyle = '#000'
    fillStyle = '#000'
    font = ''
    textAlign = 'start'
    textBaseline = 'alphabetic'
    fontKerning = 'auto'
    transform: [number, number, number, number] = [1, 1, 0, 0]
    lineDashOffset = 0
    dash: number[] = []
    currentPath: unknown[] = []
    strokes: { alpha: number; color: string; width: number; dash: number[]; path: unknown }[] = []
    labels: { text: string; x: number; y: number; align: string; alpha: number }[] = []
    saved: (() => void)[] = []

    save() {
        const properties = {
            globalAlpha: this.globalAlpha,
            lineWidth: this.lineWidth,
            lineCap: this.lineCap,
            lineJoin: this.lineJoin,
            strokeStyle: this.strokeStyle,
            fillStyle: this.fillStyle,
            font: this.font,
            textAlign: this.textAlign,
            textBaseline: this.textBaseline,
            fontKerning: this.fontKerning,
            transform: this.transform,
            lineDashOffset: this.lineDashOffset,
            dash: this.dash,
        }
        this.saved.push(() => Object.assign(this, properties))
    }

    restore() {
        this.saved.pop()?.()
    }

    setLineDash(dash: number[]) {
        this.dash = dash
    }

    translate(x: number, y: number) {
        const [sx, sy, tx, ty] = this.transform
        this.transform = [sx, sy, tx + sx * x, ty + sy * y]
    }

    scale(x: number, y: number) {
        const [sx, sy, tx, ty] = this.transform
        this.transform = [sx * x, sy * y, tx, ty]
    }

    beginPath() {
        this.currentPath = []
    }

    moveTo(x: number, y: number) {
        this.currentPath.push(['M', x, y])
    }

    lineTo(x: number, y: number) {
        this.currentPath.push(['L', x, y])
    }

    closePath() {
        this.currentPath.push(['Z'])
    }

    arc(x: number, y: number, radius: number) {
        this.currentPath.push(['arc', x, y, radius])
    }

    fill() {}

    stroke(path?: unknown) {
        this.strokes.push({
            alpha: this.globalAlpha,
            color: this.strokeStyle,
            width: this.lineWidth,
            dash: this.dash,
            path: path ?? this.currentPath,
        })
    }

    fillText(text: string, x: number, y: number) {
        const [sx, sy, tx, ty] = this.transform
        this.labels.push({
            text,
            x: tx + x * sx,
            y: ty + y * sy,
            align: this.textAlign,
            alpha: this.globalAlpha,
        })
    }
}

const groupId = 1 as GroupId
const stageId = 1 as StageId

const makeContext = () => {
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: true,
        bpms: [{ beat: 0, bpm: 120 }],
        groups: new Map(),
        stages: new Map([
            [
                stageId,
                {
                    name: 'Stage A',
                    isFromStart: true,
                    isUntilEnd: false,
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
        slides: [],
    }
    const canvas = new RecordingCanvas()
    const context: EditorDrawContext = {
        ctx: canvas as unknown as CanvasRenderingContext2D,
        scale: 10,
        pixelRatio: 2,
        bounds: { l: -10, r: 10, t: -100, b: 0, w: 20, h: 100 },
        ups: -10,
        state: createState(chart, 0),
        defaultGroupId: groupId,
        showStageName: true,
        showGroupName: true,
        recentlyActive: false,
        fontFamily: 'sans-serif',
        fontMiddle: 0.25,
        figureMiddle: 0.375,
    }
    return { canvas, context }
}

const mask = (beat: number): StageMaskEventJointEntity => ({
    type: 'stageMaskEventJoint',
    stageId,
    beat,
    maskLeft: -4,
    maskSize: 8,
    isMaskNotes: true,
    eventEase: 'inOutQuad',
})

const visibilities = {
    cameraEventConnection: true,
    stageMaskEventConnection: true,
    stagePivotEventConnection: true,
    stageStyleEventConnection: true,
    stageTransformEventConnection: true,
} as Record<EntityType, boolean>

test('event connections reuse geometry while scrolling but invalidate for BPM edits and zoom', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
    class TestPath {
        constructor(readonly d: string) {}
    }
    Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: TestPath })
    try {
        const { context, canvas } = makeContext()
        const entity = {
            type: 'stageMaskEventConnection' as const,
            beat: 2,
            min: mask(2),
            max: { ...mask(4), maskLeft: -2, maskSize: 4 },
        }
        drawEvent(context, entity, false, 0.25)
        assert.equal(canvas.strokes.length, 2)
        assert.deepEqual(
            canvas.strokes.map(({ path }) => path),
            [
                new TestPath('M -4 -10 Q -4 -12.5 -3 -15 Q -2 -17.5 -2 -20'),
                new TestPath('M 4 -10 Q 4 -12.5 3 -15 Q 2 -17.5 2 -20'),
            ],
        )
        assert.equal(canvas.strokes[0]?.alpha, 0.125)
        assert.equal(canvas.strokes[0]?.width, 0.2)
        assert.equal(canvas.globalAlpha, 1)

        context.bounds = { ...context.bounds, t: -120, b: -20 }
        drawEvent(context, entity, false)
        assert.equal(canvas.strokes[2]?.path, canvas.strokes[0]?.path)

        context.ups = -20
        drawEvent(context, entity, false)
        assert.notEqual(canvas.strokes[4]?.path, canvas.strokes[0]?.path)
        assert.equal((canvas.strokes[4]?.path as TestPath).d.includes('M -4 -20'), true)

        context.state = { ...context.state, bpms: calculateBpms([{ x: 0, y: 0, s: 1 }]) }
        drawEvent(context, entity, false)
        assert.notEqual(canvas.strokes[6]?.path, canvas.strokes[4]?.path)
        assert.equal((canvas.strokes[6]?.path as TestPath).d.includes('M -4 -40'), true)
    } finally {
        if (original) Object.defineProperty(globalThis, 'Path2D', original)
        else Reflect.deleteProperty(globalThis, 'Path2D')
    }
})

test('mask infinities preserve stage lifetime flags and hidden-stage behavior', () => {
    const { context, canvas } = makeContext()
    context.state.store.stageEventRanges.stageMaskEventJoint.set(stageId, {
        min: mask(2),
        max: mask(4),
    })
    drawEventInfinities(context, visibilities, fullScope, false)
    assert.deepEqual(
        canvas.strokes.map(({ path }) => path),
        [
            [
                ['M', -4, 0],
                ['L', -4, -10],
            ],
            [
                ['M', 4, 0],
                ['L', 4, -10],
            ],
        ],
    )

    canvas.strokes = []
    drawEventInfinities(
        context,
        visibilities,
        createScopeLookup({ stageId: 2 as StageId, showOtherStages: false }),
        false,
    )
    assert.equal(canvas.strokes.length, 0)
    drawEventInfinities(
        context,
        visibilities,
        createScopeLookup({ stageId: 2 as StageId, showOtherStages: true }),
        false,
    )
    assert.equal(canvas.strokes.length, 2)
    assert.equal(canvas.strokes[0]?.alpha, 0.125)

    context.state.stages.set(stageId, {
        name: 'Stage A',
        isFromStart: false,
        isUntilEnd: true,
        generateSimLines: 'global',
    })
    canvas.strokes = []
    drawEventInfinities(context, visibilities, createScopeLookup({ stageId }), false)
    assert.deepEqual(canvas.strokes[0]?.path, [
        ['M', -4, -20],
        ['L', -4, -100],
    ])
})

test('event visibility orders faint infinity layers before visible layers', () => {
    const { context, canvas } = makeContext()
    context.state.store.stageEventRanges.stageMaskEventJoint.set(stageId, {
        min: mask(2),
        max: mask(4),
    })
    context.state.store.stageEventRanges.stagePivotEventJoint.set(stageId, {
        min: {
            ...mask(2),
            type: 'stagePivotEventJoint',
            pivotLane: 0,
            divisionSize: 2,
            divisionParity: 'even',
            yOffset: 0,
            yOffsetBeat: 0,
        },
        max: {
            ...mask(4),
            type: 'stagePivotEventJoint',
            pivotLane: 1,
            divisionSize: 2,
            divisionParity: 'even',
            yOffset: 0,
            yOffsetBeat: 0,
        },
    })
    drawEventInfinities(
        context,
        { ...visibilities, stagePivotEventConnection: false },
        fullScope,
        true,
    )
    assert.deepEqual(
        canvas.strokes.map(({ color, alpha }) => [color, alpha]),
        [
            ['#00f', 0.125],
            ['#00f', 0.125],
            ['#0f0', 0.5],
            ['#0f0', 0.5],
        ],
    )
})

test('time-scale dashes stay in CSS pixels and stage labels respond to highlighting', () => {
    const { context, canvas } = makeContext()
    drawEvent(
        context,
        {
            type: 'timeScale',
            groupId,
            beat: 2,
            editorLane: -7,
            timeScale: 2,
            skip: 1,
            timeScaleEase: 'linear',
            timeScaleTransition: 'timeScale',
            hideNotes: true,
        },
        false,
    )
    assert.deepEqual(canvas.strokes[0]?.dash, [0.2, 0.2])
    // The dotted line stops at the hollow marker.
    assert.deepEqual(canvas.strokes[0]?.path, [
        ['M', -6.9, -10],
        ['L', 6, -10],
    ])
    assert.deepEqual(canvas.strokes[1]?.path, [['arc', -7, -10, 0.1]])
    assert.equal(canvas.strokes[1]?.color, '#ff0')
    assert.deepEqual(canvas.labels, [
        { text: '2x+1', x: -7.23 - 0.36, y: -9.8125, align: 'end', alpha: 1 },
    ])
    assert.deepEqual(canvas.dash, [])

    canvas.labels = []
    drawEvent(context, mask(2), false)
    assert.equal(canvas.labels.length, 0)
    drawEvent(context, mask(2), true)
    assert.deepEqual(canvas.labels, [{ text: 'Stage A', x: 0, y: -9.9, align: 'center', alpha: 1 }])
})

test('number labels centre on their figures and names on the x-height', () => {
    const { context, canvas } = makeContext()
    context.showStageName = false
    context.state.groups.set(2 as GroupId, { name: 'Group B' })
    drawEvent(context, { type: 'bpm', beat: 2, bpm: 180, meter: 4 }, false)
    drawEvent(
        context,
        {
            type: 'timeScale',
            groupId: 2 as GroupId,
            beat: 2,
            editorLane: 7,
            timeScale: 1.5,
            skip: 0,
            timeScaleEase: 'linear',
            timeScaleTransition: 'timeScale',
            hideNotes: false,
        },
        true,
    )
    // Baselines sit size × middle below the line at y = -10.
    assert.deepEqual(
        canvas.labels.map(({ text, y }) => [text, y]),
        [
            ['180', -10 + 0.5 * 0.375],
            ['1.5x', -10 + 0.5 * 0.375],
            ['Group B', -10 + 0.4 * 0.25],
        ],
    )
})

test('time-scale markers show the transition and whether notes are shown', () => {
    const { context, canvas } = makeContext()
    const draw = (timeScaleTransition: 'timeScale' | 'scroll', hideNotes: boolean) => {
        canvas.strokes = []
        drawEvent(
            context,
            {
                type: 'timeScale',
                groupId,
                beat: 2,
                editorLane: 0,
                timeScale: 1,
                skip: 0,
                timeScaleEase: 'inStep',
                timeScaleTransition,
                hideNotes,
            },
            false,
        )
        // Lines and marker; the ease glyph follows.
        return canvas.strokes.slice(0, -1).map(({ path, color }) => ({ path, color }))
    }

    assert.deepEqual(draw('timeScale', false).slice(-1), [
        { path: [['arc', 0, -10, 0.1]], color: '#fff' },
    ])
    const diamond = [
        ['M', 0, -10.135],
        ['L', 0.135, -10],
        ['L', 0, -9.865],
        ['L', -0.135, -10],
        ['Z'],
    ]
    assert.deepEqual(draw('scroll', false), [
        {
            path: [
                ['M', -6, -10],
                ['L', 0, -10],
            ],
            color: '#ff0',
        },
        {
            path: [
                ['M', 0, -10],
                ['L', 6, -10],
            ],
            color: '#ff0',
        },
        { path: diamond, color: '#fff' },
    ])
    assert.deepEqual(draw('scroll', true), [
        {
            path: [
                ['M', -6, -10],
                ['L', -0.135, -10],
            ],
            color: '#ff0',
        },
        {
            path: [
                ['M', 0.135, -10],
                ['L', 6, -10],
            ],
            color: '#ff0',
        },
        { path: diamond, color: '#ff0' },
    ])
})

test('time-scale eases show their curve toward the next change in the group', () => {
    const { context, canvas } = makeContext()
    const timeScale = (
        beat: number,
        value: number,
        timeScaleEase: TimeScaleEntity['timeScaleEase'],
        group = groupId,
    ): TimeScaleObject => ({
        groupId: group,
        beat,
        editorLane: 7,
        timeScale: value,
        skip: 0,
        timeScaleEase,
        timeScaleTransition: 'timeScale',
        hideNotes: false,
    })
    context.state = createState(
        {
            ...context.state,
            bpms: [{ beat: 0, bpm: 120 }],
            groups: new Map(),
            stages: new Map(),
            cameraEvents: [],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            slides: [],
            timeScales: [
                timeScale(1, 1, 'linear'),
                timeScale(2, 3, 'outStep'),
                timeScale(3, 9, 'linear', 2 as GroupId),
                timeScale(4, 0.5, 'inQuad'),
                timeScale(5, 0.5, 'inStep'),
            ],
        },
        0,
    )
    const entities = [...context.state.store.grid.timeScale.values()]
        .flatMap((set) => [...set])
        .sort((a, b) => a.beat - b.beat)
    const glyph = (index: number) => {
        canvas.strokes = []
        canvas.labels = []
        drawEvent(context, entities[index]!, false)
        return { glyph: canvas.strokes[2], label: canvas.labels[0] }
    }
    const rounded = (path: unknown) =>
        (path as [string, number, number][]).map(([command, x, y]) => [
            command,
            +x.toFixed(9),
            +y.toFixed(9),
        ])

    // Rising to the next change in the same group, past the other group's change.
    const rising = glyph(0)
    assert.equal(rising.glyph?.alpha, 1)
    assert.equal(rising.glyph?.width, 0.1)
    assert.deepEqual(rounded(rising.glyph?.path), [
        ['M', 7.23, -4.83],
        ['L', 7.53, -5.17],
    ])
    assert.equal(rising.label?.text, '1x')
    assert.ok(Math.abs(rising.label!.x - 7.59) < 1e-9)

    // Falling mirrors the curve.
    const falling = glyph(1)
    assert.deepEqual(rounded(falling.glyph?.path), [
        ['M', 7.53, -9.83],
        ['L', 7.23, -9.83],
        ['L', 7.23, -10.17],
    ])

    // Without a later change in its group, or toward the same value, the ease fades.
    assert.equal(glyph(2).glyph?.alpha, 0.4)
    assert.equal(glyph(3).glyph?.alpha, 0.4)

    // Previews outside the chart have no known next change.
    canvas.strokes = []
    drawEvent(context, { ...entities[3]!, beat: 10 }, false)
    assert.equal(canvas.strokes[2]?.alpha, 1)

    // A held step is the plain jump: its curve shows, faded, and the value keeps its column.
    const step = glyph(4)
    assert.equal(step.glyph?.alpha, 0.4)
    assert.deepEqual(rounded(step.glyph?.path), [
        ['M', 7.23, -24.83],
        ['L', 7.23, -25.17],
        ['L', 7.53, -25.17],
    ])
    assert.ok(Math.abs(step.label!.x - 7.59) < 1e-9)
    canvas.strokes = []
    drawEvent(context, { ...entities[4]!, beat: 10 }, false)
    assert.equal(canvas.strokes[2]?.alpha, 0.4)
})

test('event paths draw steps as held values and sample other curves', () => {
    assert.equal(getPathD(0, 2, 0, -4, 'inStep'), 'M 0 0 V -4')
    assert.equal(getPathD(0, 2, 0, -4, 'outStep'), 'M 2 0 V -4')
    assert.equal(getPathD(0, 2, 0, -4, 'inOutStep'), 'M 0 0 V -2 M 2 -2 V -4')
    assert.equal(getPathD(0, 2, 0, -4, 'outInStep'), 'M 1 0 V -4')
    const sampled = getPathD(0, 2, 0, -4, 'inBack').split(' ')
    assert.equal(sampled[0], 'M')
    const xs = sampled.filter((_, index) => index % 3 === 1).map(Number)
    assert.ok(Math.min(...xs) < -0.15)
    assert.ok(Math.abs(xs.at(-1)! - 2) < 1e-12)
})
