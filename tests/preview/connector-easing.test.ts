import assert from 'node:assert/strict'
import test from 'node:test'
import { easeFromValue } from '../../src/ease'
import {
    ConnectorVisualState,
    drawConnector,
    type ConnectorEndpoint,
} from '../../src/preview/engine/connector'
import type { PreviewFrameContext } from '../../src/preview/engine/context'
import {
    approach,
    createLayout,
    createViewport,
    defaultCameraInfo,
    perspectiveVec,
} from '../../src/preview/engine/layout'
import {
    EaseType,
    connectorInterpFrac,
    ease,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from '../../src/preview/engine/math'
import { ConnectorKind } from '../../src/preview/engine/model'
import { resolveSkin, type PreviewSkin, type Sprite } from '../../src/preview/skin'

const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
const skin: PreviewSkin = { ...resolveSkin(() => undefined), guides: [sprite] }

const context: PreviewFrameContext = {
    now: 0,
    layout: createLayout(createViewport(1600, 900), { ...defaultCameraInfo(), stageTilt: 0 }, true),
}

const SIZE = 0.5
const head: ConnectorEndpoint = {
    lane: -3,
    size: SIZE,
    visualProgress: 0.1,
    targetTime: 2,
    easeFrac: 0,
}
const tail: ConnectorEndpoint = {
    ...head,
    lane: 3,
    visualProgress: 0.9,
    targetTime: 4,
    easeFrac: 1,
}

const draw = (easeType: EaseTypeValue, from = head, to = tail) => {
    const quads: Quad[] = []
    drawConnector(
        context,
        (_sprite, quad, _z, alpha) => {
            if (alpha > 0) quads.push(quad)
        },
        skin,
        ConnectorKind.guideNeutral,
        ConnectorVisualState.waiting,
        easeType,
        from,
        to,
        2,
        from.lane,
        1,
        4,
        1,
        1,
        1,
        0,
        false,
    )
    return quads
}

// Quads list the nearer edge first; the left edges trace the connector's left side.
const leftEdges = (quads: Quad[]) => quads.map(({ bl, tl }) => [bl, tl] as const)

const leftAt = (lane: number, progress: number) =>
    perspectiveVec(context.layout, lane - SIZE, 1, approach(context.layout, progress))

const cross = (a: Vec, b: Vec, p: Vec) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)

const onLane = (p: Vec, lane: number) => {
    const a = leftAt(lane, head.visualProgress)
    const b = leftAt(lane, tail.visualProgress)
    return Math.abs(cross(a, b, p)) / Math.hypot(b.x - a.x, b.y - a.y) < 1e-9
}

const segmentDistance = (p: Vec, a: Vec, b: Vec) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0), 1)
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}

test('connectors follow every curved ease, including overshoot and oscillation', () => {
    for (let easeType = 2; easeType <= 37; easeType++) {
        const type = easeType as EaseTypeValue
        const edges = leftEdges(draw(type))
        assert.ok(edges.length > 0, easeFromValue(type))
        let worst = 0
        for (let i = 0; i <= 2000; i++) {
            const s = i / 2000
            const p = leftAt(
                head.lane + (tail.lane - head.lane) * ease(type, s),
                head.visualProgress + (tail.visualProgress - head.visualProgress) * s,
            )
            worst = Math.max(worst, Math.min(...edges.map(([a, b]) => segmentDistance(p, a, b))))
        }
        assert.ok(worst < 3 * context.layout.screenPixelSize, `${easeFromValue(type)}: ${worst}`)
    }
})

test('steps hold their interior lane and never draw a slanted jump', () => {
    const lanes: [EaseTypeValue, number[]][] = [
        [EaseType.inStep, [head.lane]],
        [EaseType.none, [head.lane]],
        [EaseType.outStep, [tail.lane]],
        [EaseType.outInStep, [0]],
        [EaseType.inOutStep, [head.lane, tail.lane]],
    ]
    for (const [type, expected] of lanes) {
        const edges = leftEdges(draw(type))
        assert.ok(edges.length > 0)
        const used = new Set<number>()
        for (const [a, b] of edges) {
            const lane = expected.find((lane) => onLane(a, lane) && onLane(b, lane))
            assert.notEqual(lane, undefined, `${easeFromValue(type)}: slanted or misplaced`)
            used.add(lane!)
        }
        assert.equal(used.size, expected.length, easeFromValue(type))
    }
})

test('in-out steps between attached notes split only when they span the jump', () => {
    // Attached notes sit on the step's value at their own fraction.
    const late = leftEdges(draw(EaseType.inOutStep, { ...head, lane: tail.lane, easeFrac: 0.6 }))
    assert.ok(late.every(([a, b]) => onLane(a, tail.lane) && onLane(b, tail.lane)))
    const early = leftEdges(draw(EaseType.inOutStep, { ...head, easeFrac: 0.2 }))
    assert.ok(early.some(([a, b]) => onLane(a, head.lane) && onLane(b, head.lane)))
    assert.ok(early.some(([a, b]) => onLane(a, tail.lane) && onLane(b, tail.lane)))
    assert.ok(
        early.every(
            ([a, b]) =>
                (onLane(a, head.lane) && onLane(b, head.lane)) ||
                (onLane(a, tail.lane) && onLane(b, tail.lane)),
        ),
    )
    assert.equal(connectorInterpFrac(EaseType.inOutStep, 0.2, 0.8, 0.3, 0.5), 0)
    assert.equal(connectorInterpFrac(EaseType.inOutStep, 0.2, 0.8, 0.7, 0.5), 1)
    assert.equal(connectorInterpFrac(EaseType.outStep, 0, 1, 0, 0), 1)
    assert.equal(connectorInterpFrac(EaseType.outInStep, 0, 1, 1, 1), 0.5)
    assert.equal(connectorInterpFrac(EaseType.inStep, 0, 1, 0.5, 0.5), 0)
    assert.ok(connectorInterpFrac(EaseType.outBack, 0, 1, 0.5, 0.5) > 1)
    assert.ok(connectorInterpFrac(EaseType.inElastic, 0, 1, 0.9, 0.9) < 0)
})
