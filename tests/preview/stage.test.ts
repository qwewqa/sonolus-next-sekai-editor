import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    STAGE_WIDTH_MID,
    blendStageTransform,
    computeStageTransform,
    defaultCameraInfo,
    elevationProjection,
    identityStageScreenTransform,
    identityStageTransform,
    initLayout,
    refreshLayout,
    stageTransformIsIdentity,
    stageTransformToAffine,
    transformBillboard,
    type LayoutTransform,
} from '../../src/preview/engine/layout'
import {
    EaseType,
    applyAffine,
    rotateVec,
    vec,
    type Quad,
    type Vec,
} from '../../src/preview/engine/math'
import type { PreviewStage, StageTransformEvent } from '../../src/preview/engine/model'
import {
    drawDynamicStage,
    getStageProps,
    stagePropsHasTransform,
} from '../../src/preview/engine/stage'
import type { PreviewSkin, Sprite } from '../../src/preview/skin'

const stage = (overrides: Partial<PreviewStage> = {}): PreviewStage => ({
    order: 0,
    drawStartTime: 0,
    drawEndTime: 10,
    masks: [],
    pivots: [],
    styles: [],
    transforms: [],
    hasTransforms: false,
    ...overrides,
})

const transformEvent = (overrides: Partial<StageTransformEvent>): StageTransformEvent => ({
    time: 0,
    rotate: 0,
    xLaneTranslate: 0,
    yLaneTranslate: 0,
    centerWeight: 0,
    elevation: 0,
    ease: EaseType.linear,
    ...overrides,
})

const camera = (stageTilt = 1, rotate = 0): LayoutTransform => ({
    t: 0.8,
    wScale: 0.1,
    hScale: -1.5,
    xTranslate: 0.2,
    rotate,
    stageTilt,
    sizeZoom: 1,
})

const close = (actual: number, expected: number, tolerance = 1e-12) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

const closeVec = (actual: Vec, expected: Vec, tolerance = 1e-12) => {
    close(actual.x, expected.x, tolerance)
    close(actual.y, expected.y, tolerance)
}

test('stage masks default off and switch at keyframes without interpolation', () => {
    assert.equal(getStageProps(stage(), 0).maskNotes, false)
    const value = stage({
        masks: [
            { time: 1, lane: -2, size: 2, maskNotes: true, ease: EaseType.linear },
            { time: 3, lane: 2, size: 6, maskNotes: false, ease: EaseType.linear },
        ],
    })

    assert.equal(getStageProps(value, 0).maskNotes, true)
    const halfway = getStageProps(value, 2)
    assert.equal(halfway.lane, 0)
    assert.equal(halfway.width, 4)
    assert.equal(halfway.maskNotes, true)
    assert.equal(getStageProps(value, 3, true).maskNotes, true)
    assert.equal(getStageProps(value, 3).maskNotes, false)
    assert.equal(getStageProps(value, 4).maskNotes, false)
})

test('left limits use the first same-time keyframe for geometry and the previous mask flag', () => {
    const value = stage({
        masks: [
            { time: 0, lane: 0, size: 1, maskNotes: false, ease: EaseType.linear },
            { time: 2, lane: 3, size: 4, maskNotes: false, ease: EaseType.linear },
            { time: 2, lane: 7, size: 2, maskNotes: true, ease: EaseType.linear },
        ],
    })

    const before = getStageProps(value, 2, true)
    assert.deepEqual([before.lane, before.width, before.maskNotes], [3, 4, false])
    const after = getStageProps(value, 2)
    assert.deepEqual([after.lane, after.width, after.maskNotes], [7, 2, true])
})

test('stage elevation follows outgoing easing and respects same-time left limits', () => {
    const empty = getStageProps(stage(), 0)
    assert.equal(empty.elevation, 0)
    assert.equal(stagePropsHasTransform(empty), false)
    const value = stage({
        transforms: [
            transformEvent({ time: 0, elevation: 2, ease: EaseType.inQuad }),
            transformEvent({ time: 2, elevation: 6 }),
            transformEvent({ time: 2, elevation: 10 }),
        ],
    })

    assert.equal(getStageProps(value, -1).elevation, 2)
    assert.equal(getStageProps(value, 1).elevation, 3)
    assert.equal(getStageProps(value, 2, true).elevation, 6)
    assert.equal(getStageProps(value, 2).elevation, 10)
    assert.equal(stagePropsHasTransform(getStageProps(value, 1)), true)
})

test('full-tilt elevation raises the judgment line by lane widths with perspective falloff', () => {
    const c = camera()
    for (const elevation of [-3, 0, 1, 5]) {
        const projection = elevationProjection(c, elevation)
        for (const depth of [0, 0.25, 0.5, 1, 2]) {
            const point = vec(0.4, c.t + c.hScale * depth)
            closeVec(
                applyAffine(projection, point),
                vec(point.x, point.y + elevation * c.wScale * depth),
            )
        }
    }
})

test('zero and near-zero tilt keep elevation finite and approach the original geometry', () => {
    const point = vec(0.4, -0.7)
    for (const elevation of [-5, 0, 5]) {
        const flat = elevationProjection(camera(0), elevation)
        closeVec(applyAffine(flat, point), point)
        assert.equal(flat.elevation, 0)
        for (const tilt of [1e-12, 1e-9, 1e-6]) {
            closeVec(applyAffine(elevationProjection(camera(tilt), elevation), point), point, 1e-6)
        }
    }
})

test('elevation follows camera rotation and preserves the partial-tilt vanishing line', () => {
    for (const tilt of [0.01, 0.2, 0.5, 1]) {
        for (const rotation of [-1, 0, 0.8]) {
            const c = camera(tilt, rotation)
            const projection = elevationProjection(c, 3)
            const vanishDepth = (-(1 - tilt) * STAGE_WIDTH_MID) / tilt
            const vanish = rotateVec(vec(0.4, c.t + c.hScale * vanishDepth), -rotation)
            closeVec(applyAffine(projection, vanish), vanish)

            for (const depth of [0, 0.25, 1, 2]) {
                const point = vec(0.4, c.t + c.hScale * depth)
                const width = tilt * depth + (1 - tilt) * STAGE_WIDTH_MID
                const raised = vec(point.x, point.y + 3 * c.wScale * tilt * width)
                closeVec(
                    applyAffine(projection, rotateVec(point, -rotation)),
                    rotateVec(raised, -rotation),
                )
            }
        }
    }
})

test('elevation caps at a line instead of flipping stage geometry', () => {
    for (const tilt of [0.01, 0.2, 0.5, 1]) {
        const c = camera(tilt)
        const maximum = -c.hScale / (c.wScale * tilt ** 2)
        const vanishY = c.t - (c.hScale * (1 - tilt) * STAGE_WIDTH_MID) / tilt
        for (const elevation of [maximum, maximum * 2]) {
            const projection = elevationProjection(c, elevation)
            close(projection.elevation, maximum, 1e-8)
            for (const y of [-2, -0.7, 0.8, 3]) {
                closeVec(applyAffine(projection, vec(0.4, y)), vec(0.4, vanishY))
            }
        }
    }
})

test('combined camera and stage transforms match the engine reference geometry', () => {
    initLayout(1600, 900)
    const transform = computeStageTransform(camera(0.5, 0.6), -0.4, 1.25, -0.5, 2, 0.35, 4)
    const screen = stageTransformToAffine(transform)

    // Reference values from sekai.lib.layout.compute_stage_transform with these inputs.
    close(transform.px, 0.25181455987483137)
    close(transform.py, 0.013869882246752063)
    closeVec(applyAffine(screen, vec(-0.25, 0.45)), vec(-0.46396571156346417, 0.4008507457570851))
    assert.equal(screen.elevation, 4)
})

test('connector transform blending retains elevation projection and drawing order', () => {
    const head = { ...identityStageTransform, projection: elevationProjection(camera(), 0) }
    const tail = { ...identityStageTransform, projection: elevationProjection(camera(), 5) }
    const blended = blendStageTransform(head, tail, 0.25)
    const screen = stageTransformToAffine(blended)

    closeVec(applyAffine(screen, vec(0.4, -0.7)), vec(0.4, -0.575))
    assert.equal(screen.elevation, 1.25)
    assert.equal(stageTransformIsIdentity(head), true)
    assert.equal(stageTransformIsIdentity(tail), false)
    assert.equal(stageTransformIsIdentity(blended), false)
})

test('billboard decorations keep their size and stage rotation when elevation collapses the stage', () => {
    const anchor = vec(0.3, -0.7)
    const quad: Quad = {
        bl: vec(0.2, -0.9),
        br: vec(0.4, -0.9),
        tl: vec(0.2, -0.5),
        tr: vec(0.4, -0.5),
    }
    for (const elevation of [0, 5, 15, 30]) {
        const screen = stageTransformToAffine({
            ...identityStageTransform,
            sr: 0.7,
            projection: elevationProjection(camera(), elevation),
        })
        const result = transformBillboard(screen, quad, anchor)
        const origin = applyAffine(screen, anchor)
        for (const corner of ['bl', 'br', 'tl', 'tr'] as const) {
            const offset = rotateVec(
                vec(quad[corner].x - anchor.x, quad[corner].y - anchor.y),
                -0.7,
            )
            closeVec(result[corner], vec(origin.x + offset.x, origin.y + offset.y))
        }
    }
    assert.deepEqual(transformBillboard(identityStageScreenTransform, quad, anchor), quad)
})

test('custom and fallback stage borders interpolate width without fading or duplicate draws', () => {
    initLayout(1600, 900)
    refreshLayout(defaultCameraInfo(), true)
    const border: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    for (const custom of [false, true]) {
        // Only stage sprites are used; note and connector sprite sets are irrelevant here.
        const skin = {
            judgments: [],
            stageBorder: border,
            stageLeftBorder: border,
            laneBackground: custom ? { ...border } : undefined,
        } as PreviewSkin
        const props = {
            ...getStageProps(stage(), 0),
            width: 6,
            laneAlpha: 1,
            rightBorderStyle: { start: 2, end: 2, progress: 0 },
        }
        const drawBorder = (start: number, end: number, progress: number) => {
            const draws: { quad: Quad; alpha: number }[] = []
            drawDynamicStage(
                (sprite, quad, _z, alpha) => {
                    if (sprite === border) draws.push({ quad, alpha })
                },
                skin,
                { ...props, leftBorderStyle: { start, end, progress } },
            )
            return draws
        }
        const full = drawBorder(0, 0, 0)
        assert.equal(full.length, 1)
        const fullWidth = Math.abs(full[0]!.quad.br.x - full[0]!.quad.bl.x)
        assert.ok(fullWidth > 0)
        for (const [start, end, expectedRatio] of [
            [0, 3, 0.75],
            [0, 2, 0.5],
            [2, 0, 0.5],
        ]) {
            const draws = drawBorder(start!, end!, 0.5)
            assert.equal(draws.length, 1)
            assert.equal(draws[0]!.alpha, 1)
            const width = Math.abs(draws[0]!.quad.br.x - draws[0]!.quad.bl.x)
            close(width / fullWidth, expectedRatio!)
        }
        assert.equal(drawBorder(0, 2, 1).length, 0)
    }
})
