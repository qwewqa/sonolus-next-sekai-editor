import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { StageId } from '../../src/chart/stages'
import { drawEvent, drawEventInfinities } from '../../src/editor/canvas/events'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { createState } from '../../src/state'
import type { EntityType } from '../../src/state/entities'
import type { StageMaskEventJointEntity } from '../../src/state/entities/events/joints/stage/mask'

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
    transform = [1, 1, 0, 0]
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
    eventEase: 'inOut',
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

        context.state = { ...context.state, bpms: [{ x: 0, y: 0, s: 1 }] }
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
    drawEventInfinities(context, visibilities, undefined, false)
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
    drawEventInfinities(context, visibilities, 2 as StageId, false)
    assert.equal(canvas.strokes.length, 0)
    drawEventInfinities(context, visibilities, 2 as StageId, true)
    assert.equal(canvas.strokes.length, 2)
    assert.equal(canvas.strokes[0]?.alpha, 0.125)

    context.state.stages.set(stageId, {
        name: 'Stage A',
        isFromStart: false,
        isUntilEnd: true,
        generateSimLines: 'global',
    })
    canvas.strokes = []
    drawEventInfinities(context, visibilities, stageId, false)
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
        undefined,
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
    assert.deepEqual(canvas.strokes[0]?.path, [
        ['M', -7, -10],
        ['L', 6, -10],
    ])
    assert.deepEqual(canvas.labels, [{ text: '2x+1^', x: -7.2, y: -9.875, align: 'end', alpha: 1 }])
    assert.deepEqual(canvas.dash, [])

    canvas.labels = []
    drawEvent(context, mask(2), false)
    assert.equal(canvas.labels.length, 0)
    drawEvent(context, mask(2), true)
    assert.deepEqual(canvas.labels, [{ text: 'Stage A', x: 0, y: -9.9, align: 'center', alpha: 1 }])
})
