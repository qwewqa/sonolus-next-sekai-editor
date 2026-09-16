import assert from 'node:assert/strict'
import test from 'node:test'
import type { GroupId } from '../../src/chart/groups'
import type { ConnectorLayer, ConnectorType } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { orderEntities, type EntityVisibility } from '../../src/editor/canvas/ordering'
import { createFrameScheduler, prepareSurface } from '../../src/editor/canvas/surface'
import type { Entity, EntityType } from '../../src/state/entities'
import type { ConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const group = 1 as GroupId
const otherGroup = 2 as GroupId
const stage = 1 as StageId
const otherStage = 2 as StageId
const entityTypes: EntityType[] = [
    'timeScale',
    'bpm',
    'cameraEventConnection',
    'cameraEventJoint',
    'stageMaskEventConnection',
    'stageMaskEventJoint',
    'stagePivotEventConnection',
    'stagePivotEventJoint',
    'stageStyleEventConnection',
    'stageStyleEventJoint',
    'stageTransformEventConnection',
    'stageTransformEventJoint',
    'connector',
    'note',
]

const visibility = (overrides: Partial<EntityVisibility> = {}): EntityVisibility => ({
    groupId: undefined,
    stageId: undefined,
    visibilities: Object.fromEntries(entityTypes.map((type) => [type, true])) as Record<
        EntityType,
        boolean
    >,
    showOtherGroups: true,
    showOtherStages: true,
    showOtherObjects: true,
    ...overrides,
})

// Ordering only reads identity, membership, beat and connector layer fields.
const note = (beat: number, overrides: Partial<NoteEntity> = {}): NoteEntity =>
    ({ type: 'note', beat, groupId: group, stageId: stage, ...overrides }) as NoteEntity

const connector = (
    layer: ConnectorLayer,
    type: ConnectorType,
    head = note(0),
    tail = note(10),
): ConnectorEntity => ({
    type: 'connector',
    beat: head.beat,
    head: { ...head, connectorLayer: layer, connectorType: type },
    tail,
    attachHead: head,
    attachTail: tail,
    segmentHead: head,
    segmentTail: tail,
})

test('canvas painter order preserves connector layers above and below notes', () => {
    const beforeNotes = (['under', 'bottom', 'top'] as const).flatMap((layer) =>
        (['active', 'damage', 'guide'] as const).map((type) => connector(layer, type)),
    )
    const afterNotes = (['active', 'damage', 'guide'] as const).map((type) =>
        connector('over', type),
    )
    const centerNote = note(5)
    const expected = [...beforeNotes, centerNote, ...afterNotes]
    const source = [...expected].reverse()
    const original = [...source]

    assert.deepEqual(
        orderEntities(source, new Set(), visibility()).map(({ entity }) => entity),
        expected,
    )
    assert.deepEqual(source, original, 'drawing must not reorder the source collection')
})

test('selection draws last, faded entities draw first, and equal-depth ties stay stable', () => {
    const selectedLowLayer = { type: 'bpm', beat: 0 } as Entity
    const fadedOver = connector(
        'over',
        'guide',
        note(0, { groupId: otherGroup }),
        note(2, {
            groupId: otherGroup,
        }),
    )
    const early = note(2)
    const later = note(8)
    const equalA = note(4)
    const equalB = note(4)
    const selectedFaded = note(20, { groupId: otherGroup })
    const result = orderEntities(
        [selectedLowLayer, early, equalA, selectedFaded, fadedOver, equalB, later],
        new Set([selectedFaded, selectedLowLayer]),
        visibility({ groupId: group }),
    )

    assert.deepEqual(
        result.map(({ entity }) => entity),
        [fadedOver, later, equalA, equalB, early, selectedFaded, selectedLowLayer],
    )
    assert.deepEqual(
        result.map(({ opacity }) => opacity),
        [0.25, 1, 1, 1, 1, 0.25, 1],
    )
    assert.deepEqual(
        result.map(({ highlighted }) => highlighted),
        [false, false, false, false, false, true, true],
    )
})

test('group, stage and type filters remain independent and never bypass filtering for selection', () => {
    const matching = note(1)
    const wrongGroup = note(2, { groupId: otherGroup })
    const wrongStage = note(3, { stageId: otherStage })
    const wrongBoth = note(4, { groupId: otherGroup, stageId: otherStage })
    const bpm = { type: 'bpm', beat: 0 } as Entity
    const timeScale = { type: 'timeScale', beat: 1, groupId: otherGroup } as Entity
    const entities = [matching, wrongGroup, wrongStage, wrongBoth, bpm, timeScale]
    const base = visibility({ groupId: group, stageId: stage })
    const ids = (options: EntityVisibility) =>
        new Set(orderEntities(entities, new Set(entities), options).map(({ entity }) => entity))

    assert.deepEqual(ids({ ...base, showOtherGroups: false }), new Set([matching, wrongStage, bpm]))
    assert.deepEqual(
        ids({ ...base, showOtherStages: false }),
        new Set([matching, wrongGroup, bpm, timeScale]),
    )
    assert.deepEqual(
        ids({ ...base, showOtherGroups: false, showOtherStages: false }),
        new Set([matching, bpm]),
    )
    assert.deepEqual(
        ids({
            ...base,
            visibilities: { ...base.visibilities, note: false },
            showOtherObjects: false,
        }),
        new Set([bpm, timeScale]),
    )

    const faded = orderEntities(entities, new Set(), {
        ...base,
        visibilities: { ...base.visibilities, note: false },
    })
    assert.equal(
        faded.find(({ entity }) => entity === wrongBoth)?.opacity,
        0.25,
        'multiple hidden classifications apply one group opacity, not multiplied fades',
    )
})

test('connector membership follows either attachment endpoint and stage events stay group-independent', () => {
    const matchingTail = connector(
        'top',
        'active',
        note(0, {
            groupId: otherGroup,
            stageId: otherStage,
        }),
        note(2),
    )
    const matchingHead = connector(
        'top',
        'active',
        note(0),
        note(2, {
            groupId: otherGroup,
            stageId: otherStage,
        }),
    )
    const neither = connector(
        'top',
        'active',
        note(0, {
            groupId: otherGroup,
            stageId: otherStage,
        }),
        note(2, { groupId: otherGroup, stageId: otherStage }),
    )
    const maskJoint = { type: 'stageMaskEventJoint', beat: 2, stageId: stage } as Entity
    const maskConnection = {
        type: 'stageMaskEventConnection',
        beat: 1,
        min: { stageId: stage },
    } as Entity
    const otherMaskConnection = {
        type: 'stageMaskEventConnection',
        beat: 1,
        min: { stageId: otherStage },
    } as Entity
    const camera = { type: 'cameraEventJoint', beat: 1 } as Entity
    const source = [
        matchingTail,
        matchingHead,
        neither,
        maskJoint,
        maskConnection,
        otherMaskConnection,
        camera,
    ]
    const result = orderEntities(
        source,
        new Set(),
        visibility({
            groupId: group,
            stageId: stage,
            showOtherGroups: false,
            showOtherStages: false,
        }),
    )
    assert.deepEqual(
        new Set(result.map(({ entity }) => entity)),
        new Set([matchingTail, matchingHead, maskJoint, maskConnection, camera]),
    )
})

const withAnimationFrames = (
    run: (frames: {
        pending: Map<number, FrameRequestCallback>
        requests: () => number
        tick: (timestamp?: number) => void
    }) => void,
) => {
    const request = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
    const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
    const pending = new Map<number, FrameRequestCallback>()
    let requests = 0
    globalThis.requestAnimationFrame = (callback) => {
        const id = ++requests
        pending.set(id, callback)
        return id
    }
    globalThis.cancelAnimationFrame = (id) => {
        pending.delete(id)
    }
    try {
        run({
            pending,
            requests: () => requests,
            tick: (timestamp = 0) => {
                const callbacks = [...pending.values()]
                pending.clear()
                callbacks.forEach((callback) => callback(timestamp))
            },
        })
    } finally {
        if (request) Object.defineProperty(globalThis, 'requestAnimationFrame', request)
        else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
        if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel)
        else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
    }
}

test('frame scheduling coalesces rapid edits into the latest pending draw without starvation', () => {
    withAnimationFrames(({ pending, requests, tick }) => {
        const scheduler = createFrameScheduler()
        const draws: number[] = []
        for (let value = 0; value < 100; value++) scheduler.schedule(() => draws.push(value))
        assert.equal(requests(), 1)
        assert.equal(pending.size, 1)
        assert.deepEqual(draws, [])
        tick()
        assert.deepEqual(draws, [99])
        assert.equal(pending.size, 0)
        scheduler.schedule(() => draws.push(100))
        tick()
        assert.deepEqual(draws, [99, 100])
    })
})

test('cancelling a pending frame discards its draw and permits scheduling after remount', () => {
    withAnimationFrames(({ pending, tick }) => {
        const scheduler = createFrameScheduler()
        const draws: string[] = []
        scheduler.schedule(() => draws.push('cancelled'))
        scheduler.cancel()
        assert.equal(pending.size, 0)
        tick()
        assert.deepEqual(draws, [])
        scheduler.schedule(() => draws.push('new'))
        tick()
        assert.deepEqual(draws, ['new'])
    })
})

test('independently scheduled canvas layers share the browser frame timestamp', () => {
    withAnimationFrames(({ tick }) => {
        const chart = createFrameScheduler()
        const overlay = createFrameScheduler()
        const draws: number[] = []
        chart.schedule((timestamp) => draws.push(timestamp))
        overlay.schedule((timestamp) => draws.push(timestamp))
        tick(42)
        assert.deepEqual(draws, [42, 42])
        overlay.schedule((timestamp) => draws.push(timestamp))
        tick(58)
        assert.deepEqual(draws, [42, 42, 58])
    })
})

test('invalidation during drawing survives into the following animation frame', () => {
    withAnimationFrames(({ pending, tick }) => {
        const scheduler = createFrameScheduler()
        const draws: string[] = []
        scheduler.schedule(() => {
            draws.push('first')
            scheduler.schedule(() => draws.push('second'))
        })
        tick()
        assert.deepEqual(draws, ['first'])
        assert.equal(pending.size, 1)
        tick()
        assert.deepEqual(draws, ['first', 'second'])
    })
})

test('canvas surfaces reuse backing storage while applying DPR, scrolling and non-scaling strokes', () => {
    let width = 0
    let height = 0
    const dimensions: number[][] = []
    const transforms: number[][] = []
    const clears: number[][] = []
    let transform = [1, 0, 0, 1, 0, 0]
    const initialPaint = {
        globalAlpha: 0.375,
        globalCompositeOperation: 'multiply',
        fillStyle: '#abcdef',
    }
    const stack: (typeof initialPaint)[] = []
    const ctx = {
        ...initialPaint,
        setTransform: (...args: number[]) => {
            transform = args
            transforms.push(args)
        },
        save: () =>
            stack.push({
                globalAlpha: ctx.globalAlpha,
                globalCompositeOperation: ctx.globalCompositeOperation,
                fillStyle: ctx.fillStyle,
            }),
        restore: () => {
            const saved = stack.pop()
            assert.ok(saved, 'surface clearing must balance save and restore')
            Object.assign(ctx, saved)
        },
        fillRect: (...args: number[]) => {
            assert.deepEqual(
                transform,
                [1, 0, 0, 1, 0, 0],
                'clearing uses backing-pixel coordinates',
            )
            assert.equal(ctx.globalAlpha, 1)
            assert.equal(ctx.globalCompositeOperation, 'copy')
            assert.equal(ctx.fillStyle, 'rgba(0, 0, 0, 0)')
            clears.push(args)
        },
        lineWidth: 0,
    }
    const assertPaintRestored = () => {
        assert.equal(ctx.globalAlpha, initialPaint.globalAlpha)
        assert.equal(ctx.globalCompositeOperation, initialPaint.globalCompositeOperation)
        assert.equal(ctx.fillStyle, initialPaint.fillStyle)
        assert.equal(stack.length, 0)
    }
    const canvas = {
        get width() {
            return width
        },
        set width(value: number) {
            width = value
            dimensions.push([width, height])
        },
        get height() {
            return height
        },
        set height(value: number) {
            height = value
            dimensions.push([width, height])
        },
        getContext: (kind: string) => {
            assert.equal(kind, '2d')
            return ctx
        },
    } as unknown as HTMLCanvasElement
    const bounds = { l: -6, r: 6, t: -20, b: -14, w: 12, h: 6 }
    assert.equal(prepareSurface(canvas, 600, 300, 2, bounds), ctx)
    assert.deepEqual([width, height], [1200, 600])
    assert.deepEqual(transforms, [
        [1, 0, 0, 1, 0, 0],
        [100, 0, 0, 100, 600, 2000],
    ])
    assert.equal(ctx.lineWidth, 0.04)
    assert.deepEqual(clears, [[0, 0, 1200, 600]])
    assertPaintRestored()

    prepareSurface(canvas, 600, 300, 2, { ...bounds, t: -21, b: -15 })
    assert.equal(dimensions.length, 2, 'scrolling must not resize either backing dimension')
    assert.deepEqual(transforms.at(-1), [100, 0, 0, 100, 600, 2100])
    assert.equal(clears.length, 2, 'each new frame clears its previous pixels')
    assertPaintRestored()

    prepareSurface(canvas, 600, 300, 1.25, bounds)
    assert.deepEqual([width, height], [750, 375])
    assert.deepEqual(transforms.at(-1), [62.5, 0, 0, 62.5, 375, 1250])
    assert.equal(ctx.lineWidth, 0.04, 'DPR does not change the stroke width in CSS pixels')
    assert.deepEqual(clears.at(-1), [0, 0, 750, 375])
    assertPaintRestored()

    for (const [cssWidth, cssHeight, pixelRatio] of [
        [601, 301, 1.25],
        [601.375, 301.625, 1],
        [601.375, 301.625, 1.5],
        [601.375, 301.625, 2],
    ]) {
        const sceneHeight = (cssHeight / cssWidth) * bounds.w
        const fractionalBounds = { ...bounds, b: bounds.t + sceneHeight, h: sceneHeight }
        prepareSurface(canvas, cssWidth, cssHeight, pixelRatio, fractionalBounds)
        const [sx, , , sy, tx, ty] = transforms.at(-1)!
        // Browser compositing maps rounded backing dimensions back to the CSS
        // box. Every scene position must still match the editor's input map.
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const x = fractionalBounds.l + fractionalBounds.w * fraction
            const y = fractionalBounds.t + fractionalBounds.h * fraction
            const renderedX = ((x * sx + tx) / width) * cssWidth
            const renderedY = ((y * sy + ty) / height) * cssHeight
            assert.ok(Math.abs(renderedX - cssWidth * fraction) < 1e-10)
            assert.ok(Math.abs(renderedY - cssHeight * fraction) < 1e-10)
        }
        assert.equal(ctx.lineWidth, (2 * bounds.w) / cssWidth)
        assertPaintRestored()
    }
})
