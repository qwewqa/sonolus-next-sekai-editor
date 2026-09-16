import assert from 'node:assert/strict'
import test from 'node:test'
import {
    ConnectorVisualState,
    drawConnector,
    type ConnectorEndpoint,
} from '../../src/preview/engine/connector'
import {
    FlickDirection,
    approach,
    defaultCameraInfo,
    identityStageScreenTransform,
    identityStageTransform,
    initLayout,
    perspectiveVec,
    refreshLayout,
    type StageTransform,
} from '../../src/preview/engine/layout'
import { EaseType, type Quad } from '../../src/preview/engine/math'
import { ConnectorKind, NoteKind } from '../../src/preview/engine/model'
import { drawNote } from '../../src/preview/engine/note'
import { drawSimLine } from '../../src/preview/engine/simLine'
import type { ZKey } from '../../src/preview/gl'
import type { PreviewSkin, Sprite } from '../../src/preview/skin'

const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
const tick: Sprite = { ...sprite }
const skin = {
    normalNote: {
        body: { renderType: 'normalFallback', middle: sprite },
        arrow: { fallback: false, up: [], down: [], upLeft: [], downLeft: [] },
        tick,
    },
    guides: [sprite],
    simLine: sprite,
} as PreviewSkin

const init = () => {
    initLayout(1600, 900)
    refreshLayout({ ...defaultCameraInfo(), stageTilt: 0 }, true)
}

const capture = () => {
    const draws: { sprite: Sprite; quad: Quad; z: ZKey; alpha: number }[] = []
    return {
        draws,
        draw: (sprite: Sprite | undefined, quad: Quad, z: ZKey, alpha: number) => {
            if (sprite) draws.push({ sprite, quad, z, alpha })
        },
    }
}

const close = (a: number, b: number, tolerance = 1e-10) =>
    assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`)

const endpoint = (overrides: Partial<ConnectorEndpoint> = {}): ConnectorEndpoint => ({
    lane: 0,
    size: 0.5,
    visualProgress: 0.9,
    targetTime: 2,
    easeFrac: 0,
    ...overrides,
})

const connector = (
    head: ConnectorEndpoint,
    tail: ConnectorEndpoint,
    headAlpha = 1,
    tailAlpha = 1,
) => {
    const result = capture()
    drawConnector(
        result.draw,
        skin,
        0,
        ConnectorKind.guideNeutral,
        ConnectorVisualState.waiting,
        EaseType.linear,
        head,
        tail,
        2,
        head.lane,
        headAlpha,
        4,
        tailAlpha,
        1,
        1,
        0,
        false,
    )
    return result.draws
}

test('notes outside a mask disappear, including their markers', () => {
    init()
    const result = capture()
    drawNote(
        result.draw,
        skin,
        0,
        NoteKind.tap,
        false,
        3,
        0.5,
        0.5,
        FlickDirection.upOmni,
        2,
        identityStageScreenTransform,
        1,
        { enabled: true, left: -1, right: 1 },
    )
    assert.equal(result.draws.length, 0)
})

test('elevation flattens note bodies while preserving marker dimensions and layer order', () => {
    init()
    const baseline = capture()
    const elevated = capture()
    for (const [result, transform] of [
        [baseline, identityStageScreenTransform],
        [elevated, { ...identityStageScreenTransform, a11: 0.25, a12: 0.2, elevation: 2 }],
    ] as const) {
        drawNote(
            result.draw,
            skin,
            0,
            NoteKind.tap,
            false,
            0,
            1,
            0.5,
            FlickDirection.upOmni,
            2,
            transform,
            1,
        )
    }
    const height = (quad: Quad) => Math.abs(quad.tl.y - quad.bl.y)
    assert.equal(baseline.draws.length, 2)
    assert.equal(elevated.draws.length, 2)
    close(height(elevated.draws[0]!.quad), height(baseline.draws[0]!.quad) / 4)
    close(height(elevated.draws[1]!.quad), height(baseline.draws[1]!.quad))
    for (let i = 0; i < 2; i++) close(elevated.draws[i]!.z[1]! - baseline.draws[i]!.z[1]!, 2)
})

test('connector masks clip the original path at border crossings', () => {
    init()
    const mask = { enabled: true, left: -1, right: 1, stageIndex: 1 }
    const head = endpoint({ lane: -4, mask })
    const tail = endpoint({ lane: 4, visualProgress: 0.1, targetTime: 4, easeFrac: 1, mask })
    const draws = connector(head, tail)
    assert.ok(draws.length > 0)
    const headPosition = perspectiveVec(0, 1, approach(head.visualProgress))
    const tailPosition = perspectiveVec(0, 1, approach(tail.visualProgress))
    const laneScale = perspectiveVec(1, 1, approach(0.5)).x
    for (const { quad } of draws) {
        for (const point of Object.values(quad)) {
            assert.ok(point.x / laneScale >= -1 - 1e-10)
            assert.ok(point.x / laneScale <= 1 + 1e-10)
            const frac = (point.y - headPosition.y) / (tailPosition.y - headPosition.y)
            // Original edges enter the mask at 5/16 and leave at 11/16.
            assert.ok(frac >= 5 / 16 - 1e-10)
            assert.ok(frac <= 11 / 16 + 1e-10)
        }
    }
    assert.equal(
        connector(
            endpoint({ lane: 4, mask }),
            endpoint({ lane: 5, visualProgress: 0.1, targetTime: 4, easeFrac: 1, mask }),
        ).length,
        0,
    )
})

test('a collapsed connector mask and two zero-width endpoints emit no geometry', () => {
    init()
    const mask = { enabled: true, left: 0, right: 0 }
    assert.equal(
        connector(
            endpoint({ mask }),
            endpoint({ mask, visualProgress: 0.1, targetTime: 4, easeFrac: 1 }),
        ).length,
        0,
    )
    assert.equal(
        connector(
            endpoint({ size: 0 }),
            endpoint({ size: 0, visualProgress: 0.1, targetTime: 4, easeFrac: 1 }),
        ).length,
        0,
    )
})

test('connector alpha fades remain visible on a geometrically straight connector', () => {
    init()
    const draws = connector(
        endpoint(),
        endpoint({ visualProgress: 0.1, targetTime: 4, easeFrac: 1 }),
        0,
        1,
    )
    assert.ok(draws.length > 10)
    assert.ok(draws[0]!.alpha < 0.05)
    assert.ok(draws.at(-1)!.alpha > 0.55)
})

test('coincident easing fractions still connect both endpoint lanes', () => {
    init()
    for (const delta of [0, 1e-8]) {
        const draws = connector(
            endpoint({ lane: -2, easeFrac: 0.3 }),
            endpoint({ lane: 2, easeFrac: 0.3 + delta, visualProgress: 0.1, targetTime: 4 }),
        )
        assert.ok(draws.length > 0)
        const last = draws.at(-1)!.quad
        close((last.tl.x + last.tr.x) / 2, perspectiveVec(2, 1, approach(0.1)).x)
    }
})

test('connectors between elevations draw their segments at changing depths', () => {
    init()
    const draws = connector(
        endpoint({ transform: identityStageTransform }),
        endpoint({
            visualProgress: 0.1,
            targetTime: 4,
            easeFrac: 1,
            transform: {
                ...identityStageTransform,
                projection: { ...identityStageScreenTransform, elevation: 1 },
            },
        }),
    )
    assert.ok(draws.length >= 32)
    assert.ok(draws.at(-1)!.z[1]! - draws[0]!.z[1]! > 0.9)
})

test('sim lines connect equal lanes on different stages and scale thickness by projection', () => {
    init()
    const left: StageTransform = { ...identityStageTransform, tx: -0.5 }
    const right: StageTransform = { ...identityStageTransform, tx: 0.5 }
    const baseline = capture()
    drawSimLine(baseline.draw, skin, 0, 0.5, 2, 0, 0.5, 2, left, right)
    assert.equal(baseline.draws.length, 1)
    const projected = capture()
    const projection = { ...identityStageScreenTransform, a11: 0.25, elevation: 1 }
    drawSimLine(
        projected.draw,
        skin,
        0,
        0.5,
        2,
        0,
        0.5,
        2,
        { ...left, projection },
        { ...right, projection },
    )
    assert.equal(projected.draws.length, 1)
    const height = (quad: Quad) => Math.abs(quad.tl.y - quad.bl.y)
    close(height(projected.draws[0]!.quad), height(baseline.draws[0]!.quad) / 4)
    close(projected.draws[0]!.z[1]! - baseline.draws[0]!.z[1]!, 1)
})
