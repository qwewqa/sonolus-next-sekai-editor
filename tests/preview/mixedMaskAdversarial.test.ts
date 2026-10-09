import assert from 'node:assert/strict'
import test from 'node:test'
import { ConnectorVisualState, drawConnector } from '../../src/preview/engine/connector'
import {
    approach,
    computeStageTransform,
    createLayout,
    createViewport,
    currentLayoutTransform,
    defaultCameraInfo,
    perspectiveVec,
    stageTransformToAffine,
} from '../../src/preview/engine/layout'
import type { VisualMask } from '../../src/preview/engine/mask'
import {
    applyAffine,
    ease,
    EaseType,
    lerp,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from '../../src/preview/engine/math'
import { ConnectorKind } from '../../src/preview/engine/model'
import { resolveSkin, type Sprite } from '../../src/preview/skin'

const layout = createLayout(
    createViewport(1920, 1080),
    { ...defaultCameraInfo(), stageTilt: 0 },
    true,
)
const camera = currentLayoutTransform(layout)
type End = { lane: number; size: number; mask: VisualMask }
const endpoint = (
    lane: number,
    size: number,
    left: number,
    right: number,
    stageIndex: number,
): End => ({
    lane,
    size,
    mask: { enabled: true, left, right, stageIndex },
})
const transform = (q: number, u: number) =>
    computeStageTransform(layout, camera, 0.4 * q, 2 * q, 0, 0, 0, 2 * u)
const draw = (head: End, tail: End, curve: EaseTypeValue = EaseType.linear, elevated = false) => {
    const quads: Quad[] = []
    const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    drawConnector(
        { now: 0, layout },
        (_sprite, quad) => quads.push(quad),
        { ...resolveSkin(() => undefined), guides: [sprite] },
        ConnectorKind.guideNeutral,
        ConnectorVisualState.waiting,
        curve,
        {
            ...head,
            visualProgress: 0.2,
            targetTime: 1,
            easeFrac: 0,
            transform: elevated ? transform(0, 0) : undefined,
        },
        {
            ...tail,
            visualProgress: 0.8,
            targetTime: 2,
            easeFrac: 1,
            transform: elevated ? transform(1, 1) : undefined,
        },
        1,
        head.lane,
        1,
        2,
        1,
        1,
        1,
        0,
        false,
        false,
        1,
        elevated ? transform : undefined,
    )
    assert.ok(
        quads.every((quad) =>
            Object.values(quad).every((p: Vec) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        ),
    )
    return quads
}
const distance = (p: Vec, a: Vec, b: Vec) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    )
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const checkVisibleCurve = (head: End, tail: End, curve: EaseTypeValue, elevated: boolean) => {
    const quads = draw(head, tail, curve, elevated)
    let visible = 0
    let worst = 0
    for (let index = 0; index <= 2000; index++) {
        const u = index / 2000
        const q = ease(curve, u)
        const lane = lerp(head.lane, tail.lane, q)
        const size = lerp(head.size, tail.size, q)
        const maskLeft = lerp(head.mask.left, tail.mask.left, q)
        const maskRight = lerp(head.mask.right, tail.mask.right, q)
        const left = Math.max(lane - size, maskLeft)
        const right = Math.min(lane + size, maskRight)
        if (right - left < 1e-5) continue
        visible++
        for (const [edge, a, b] of [
            [left, 'bl', 'tl'],
            [right, 'br', 'tr'],
        ] as const) {
            const base = perspectiveVec(layout, edge, 1, approach(layout, lerp(0.2, 0.8, u)))
            const point = elevated
                ? applyAffine(stageTransformToAffine(transform(q, u)), base)
                : base
            worst = Math.max(
                worst,
                Math.min(...quads.map((quad) => distance(point, quad[a], quad[b]))),
            )
        }
    }
    assert.ok(visible > 0, 'Fixture must have an actual visible interval')
    assert.ok(quads.length > 0, 'A visible interval cannot disappear between sampling endpoints')
    assert.ok(worst < 2.5 * layout.screenPixelSize, `${worst / layout.screenPixelSize} pixels`)
}

test('different-stage masks preserve narrow visible crossings in both lane directions', () => {
    const masks = [
        [-0.1, 0.1, -0.1, 0.1],
        [-1.2, -1, 1, 1.2],
        [-0.01, 0.01, -0.4, 0.4],
        [-0.4, 0.4, -0.01, 0.01],
    ] as const
    for (const [left, right, tailLeft, tailRight] of masks) {
        for (const widths of [
            [0.1, 0.1],
            [0.01, 0.5],
            [0.5, 0.01],
        ] as const) {
            const head = endpoint(-5.25, widths[0], left, right, 1)
            const tail = endpoint(4.75, widths[1], tailLeft, tailRight, 2)
            checkVisibleCurve(head, tail, EaseType.linear, false)
            checkVisibleCurve(tail, head, EaseType.linear, false)
        }
    }
})

test('a moving mask may collapse and reopen without bridging its crossed interval', () => {
    const head = endpoint(-0.2, 0.4, -0.5, 0.5, 1)
    const tail = endpoint(0.2, 0.4, 0.3, -0.3, 2)
    checkVisibleCurve(head, tail, EaseType.linear, false)
    checkVisibleCurve(tail, head, EaseType.linear, false)
    const firstY = perspectiveVec(layout, 0, 1, approach(layout, 0.2)).y
    const lastY = perspectiveVec(layout, 0, 1, approach(layout, 0.8)).y
    for (const [first, last] of [
        [head, tail],
        [tail, head],
    ] as const) {
        for (const quad of draw(first, last)) {
            for (const point of Object.values(quad) as Vec[]) {
                const u = (point.y - firstY) / (lastY - firstY)
                const maskWidth = lerp(
                    first.mask.right - first.mask.left,
                    last.mask.right - last.mask.left,
                    u,
                )
                assert.ok(
                    maskWidth >= -1e-10,
                    `Geometry crossed into a collapsed mask: ${maskWidth}`,
                )
            }
        }
    }
})

test('crossing splits preserve separate eased stage motion, elevation and progress coordinates', () => {
    const head = endpoint(-5.25, 0.1, -0.2, 0.2, 1)
    const tail = endpoint(4.75, 0.3, -0.1, 0.4, 2)
    checkVisibleCurve(head, tail, EaseType.inQuad, true)
    checkVisibleCurve(tail, head, EaseType.inQuad, true)
})

test('disabled masks remain byte-identical regardless of stage identity', () => {
    const head = endpoint(-5.25, 0.1, -0.1, 0.1, 1)
    const tail = endpoint(4.75, 0.1, -0.1, 0.1, 2)
    head.mask.enabled = tail.mask.enabled = false
    for (const curve of [EaseType.linear, EaseType.inQuad, EaseType.outElastic]) {
        assert.deepEqual(
            draw(head, tail, curve),
            draw(head, { ...tail, mask: { ...tail.mask, stageIndex: 1 } }, curve),
        )
    }
})

test('same-stage narrow masks continue to match their analytical clipped curve', () => {
    checkVisibleCurve(
        endpoint(-5.25, 0.1, -0.1, 0.1, 1),
        endpoint(4.75, 0.1, -0.1, 0.1, 1),
        EaseType.linear,
        false,
    )
})
