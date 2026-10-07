import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    STAGE_WIDTH_MID,
    blendStageTransform,
    computeStageTransform,
    createLayout,
    createViewport,
    defaultCameraInfo,
    elevationProjection,
    getCameraInfo,
    identityStageScreenTransform,
    identityStageTransform,
    stageTransformIsIdentity,
    stageTransformToAffine,
    transformBillboard,
    type LayoutTransform,
} from '../../src/preview/engine/layout'
import {
    EaseType,
    applyAffine,
    eventProgress,
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
import { resolveSkin, type PreviewSkin, type Sprite } from '../../src/preview/skin'
import { beatToTime, calculateBpms, toBpmIntegral } from '../../src/state/integrals/bpms'

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
    assert.equal(getStageProps(value, 3).maskNotes, true)
    assert.equal(getStageProps(value, 3, { rightLimit: true }).maskNotes, false)
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

    const before = getStageProps(value, 2)
    assert.deepEqual([before.lane, before.width, before.maskNotes], [3, 4, false])
    const after = getStageProps(value, 2, { rightLimit: true })
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
    assert.equal(getStageProps(value, 2).elevation, 6)
    assert.equal(getStageProps(value, 2, { rightLimit: true }).elevation, 10)
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
    const viewport = createViewport(1600, 900)
    const transform = computeStageTransform(
        viewport,
        camera(0.5, 0.6),
        -0.4,
        1.25,
        -0.5,
        2,
        0.35,
        4,
    )
    const screen = stageTransformToAffine(transform)

    // Reference: engine 9e93ba0, sekai.lib.layout.compute_stage_transform with these inputs.
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
    const context = {
        now: 0,
        layout: createLayout(createViewport(1600, 900), defaultCameraInfo(), true),
    }
    const border: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    for (const custom of [false, true]) {
        // Only stage sprites are used; note and connector sprite sets are irrelevant here.
        const skin: PreviewSkin = {
            ...resolveSkin(() => undefined),
            judgments: [],
            stageBorder: border,
            stageLeftBorder: border,
            laneBackground: custom ? { ...border } : undefined,
        }
        const props = {
            ...getStageProps(stage(), 0),
            width: 6,
            laneAlpha: 1,
            rightBorderStyle: { start: 2, end: 2, progress: 0 },
        }
        const drawBorder = (start: number, end: number, progress: number) => {
            const draws: { quad: Quad; alpha: number }[] = []
            drawDynamicStage(
                context,
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

test('overshooting eases keep camera, mask and style values within their ranges, but not style blends', () => {
    const viewport = createViewport(1600, 900)
    const camera = (time: number, size: number, zoom: number) => ({
        time,
        lane: 0,
        size,
        zoom,
        zoomTargetLane: 0,
        zoomTargetY: 0,
        zoomVerticalAlign: 0 as const,
        rotate: 0,
        stageTilt: 1,
        ease: EaseType.inElastic,
    })
    const info = getCameraInfo(viewport, [camera(0, 1, 1), camera(1, 12, 12)], 0.9)
    assert.equal(info.size, 0.01)
    assert.equal(info.zoom, 0.01)

    const props = getStageProps(
        stage({
            masks: [
                { time: 0, lane: 0, size: 1, maskNotes: false, ease: EaseType.inElastic },
                { time: 1, lane: 0, size: 6, maskNotes: false, ease: EaseType.linear },
            ],
        }),
        0.9,
    )
    assert.equal(props.width, 0)

    const style = (time: number, alpha: number, judgeLineColor: number, fullWidth: number) => ({
        time,
        judgeLineColor,
        judgeLineStyle: 0 as const,
        leftBorderStyle: 0,
        rightBorderStyle: 0,
        noteAlpha: alpha,
        laneAlpha: alpha,
        judgeLineAlpha: alpha,
        fullWidth,
        divisionLineAlpha: alpha,
        ease: EaseType.outBack,
    })
    const styled = getStageProps(stage({ styles: [style(0, 0, 0, 0), style(1, 1, 1, 1)] }), 0.6)
    for (const value of [
        styled.noteAlpha,
        styled.laneAlpha,
        styled.judgeLineAlpha,
        styled.divisionLineAlpha,
        styled.fullWidth,
    ])
        assert.equal(value, 1)
    // As in the engine, blends overshoot and their weights are bounded where they are drawn.
    assert.ok(styled.judgeLineColor.progress > 1)
    assert.ok(styled.leftBorderStyle.progress > 1)
})

test('overshooting style blends draw with alphas in range and collapse borders instead of flipping them', () => {
    const context = {
        now: 0,
        layout: createLayout(createViewport(1600, 900), defaultCameraInfo(), true),
    }
    const sprite = (): Sprite => ({ u0: 0, v0: 0, u1: 1, v1: 1 })
    const border = sprite()
    const judgment = {
        background: sprite(),
        center: sprite(),
        edge: sprite(),
        edgeLeft: sprite(),
        gradient: sprite(),
        singleLine: sprite(),
    }
    const skin: PreviewSkin = {
        ...resolveSkin(() => undefined),
        judgments: [judgment, { ...judgment, background: sprite() }],
        stageBorder: border,
        laneDivider: sprite(),
        laneBackground: sprite(),
    }
    const draws: { sprite?: Sprite; quad: Quad; alpha: number }[] = []
    drawDynamicStage(
        context,
        (sprite, quad, _z, alpha) => draws.push({ sprite, quad, alpha }),
        skin,
        {
            ...getStageProps(stage(), 0),
            width: 6,
            laneAlpha: 1,
            judgeLineAlpha: 1,
            divisionLineAlpha: 1,
            judgeLineColor: { start: 0, end: 1, progress: 1.3 },
            division: { start: { size: 1, parity: 0 }, end: { size: 2, parity: 1 }, progress: 1.3 },
            leftBorderStyle: { start: 0, end: 2, progress: 1.2 },
            rightBorderStyle: { start: 0, end: 0, progress: 0 },
        },
    )
    assert.ok(draws.length > 0)
    for (const { alpha } of draws) assert.ok(alpha >= 0 && alpha <= 1, `${alpha}`)
    // The left border would have negative width; only the right one is drawn.
    assert.equal(draws.filter(({ sprite }) => sprite === border).length, 1)
})

test('extrapolated transform blends stop elevation projections at zero height', () => {
    const elevated = {
        ...identityStageTransform,
        projection: { ...identityStageScreenTransform, a00: 0.6, a11: 0.6, elevation: 4 },
    }
    const blended = blendStageTransform(identityStageTransform, elevated, 2)
    assert.equal(blended.projection.a00 + blended.projection.a11, 1)
    assert.equal(blended.projection.elevation, 5)
    // Inside the interval and away from a flip, the blend is unchanged.
    assert.equal(blendStageTransform(identityStageTransform, elevated, 0.5).projection.a00, 0.8)
    assert.equal(blendStageTransform(identityStageTransform, elevated, -1).projection.a00, 1.4)
})

test('camera sizes have the engine minimum at events, not only between them', () => {
    const viewport = createViewport(1600, 900)
    const camera = (time: number, size: number) => ({
        time,
        lane: 0,
        size,
        zoom: 1,
        zoomTargetLane: 1,
        zoomTargetY: 0,
        zoomVerticalAlign: 0 as const,
        rotate: 0,
        stageTilt: 1,
        ease: EaseType.linear,
    })
    const at = getCameraInfo(viewport, [camera(0, 0.005)], 0)
    const floor = getCameraInfo(viewport, [camera(0, 0.01)], 0)
    assert.equal(at.size, 0.01)
    assert.deepEqual(at.zoomTarget, floor.zoomTarget)
    const before = getCameraInfo(viewport, [camera(1, 0.005), camera(2, 6)], 0)
    assert.equal(before.size, 0.01)
})

test('In-Out Step midpoints hold the value before the jump at the left limit only', () => {
    const inOut = EaseType.inOutStep
    const value = stage({
        masks: [
            { time: 0, lane: 0, size: 1, maskNotes: true, ease: inOut },
            { time: 4, lane: 3, size: 2, maskNotes: true, ease: EaseType.linear },
        ],
        pivots: [
            { time: 0, lane: 0, divisionSize: 1, divisionParity: 0, yOffset: 0, ease: inOut },
            { time: 4, lane: 5, divisionSize: 3, divisionParity: 1, yOffset: 0.5, ease: 0 },
        ],
        styles: [
            {
                time: 0,
                judgeLineColor: 0,
                judgeLineStyle: 0,
                leftBorderStyle: 0,
                rightBorderStyle: 0,
                fullWidth: 0,
                noteAlpha: 1,
                laneAlpha: 1,
                judgeLineAlpha: 1,
                divisionLineAlpha: 1,
                ease: inOut,
            },
            {
                time: 4,
                judgeLineColor: 1,
                judgeLineStyle: 1,
                leftBorderStyle: 1,
                rightBorderStyle: 1,
                fullWidth: 1,
                noteAlpha: 0.5,
                laneAlpha: 0.5,
                judgeLineAlpha: 0.5,
                divisionLineAlpha: 0.5,
                ease: EaseType.linear,
            },
        ],
        transforms: [
            transformEvent({ time: 0, ease: inOut }),
            transformEvent({ time: 4, rotate: 1, elevation: 2 }),
        ],
    })
    const summary = (t: number, rightLimit = false) => {
        const props = getStageProps(value, t, { rightLimit })
        return [
            props.lane,
            props.pivotLane,
            props.yOffset,
            props.division.progress,
            props.judgeLineStyle.progress,
            props.noteAlpha,
            props.rotate,
            props.elevation,
        ]
    }
    const before = [0, 0, 0, 0, 0, 1, 0, 0]
    const after = [3, 5, 0.5, 1, 1, 0.5, 1, 2]
    assert.deepEqual(summary(2), before)
    assert.deepEqual(summary(2, true), after)
    assert.deepEqual(summary(1.9, true), before)
    assert.deepEqual(summary(1.9), before)
    assert.deepEqual(summary(2.1), after)

    const viewport = createViewport(1600, 900)
    const camera = (time: number, rotate: number) => ({
        time,
        lane: 0,
        size: 12,
        zoom: 1,
        zoomTargetLane: 0,
        zoomTargetY: 0,
        zoomVerticalAlign: 0 as const,
        rotate,
        stageTilt: 1,
        ease: inOut,
    })
    const cameras = [camera(0, 0), camera(4, 1)]
    assert.equal(getCameraInfo(viewport, cameras, 1.9).rotate, 0)
    assert.equal(getCameraInfo(viewport, cameras, 2).rotate, 0)
    assert.equal(getCameraInfo(viewport, cameras, 2, { rightLimit: true }).rotate, 1)
    assert.equal(getCameraInfo(viewport, cameras, 2.1).rotate, 1)
    assert.equal(getCameraInfo(viewport, cameras, 4).rotate, 1)
})

// sekai/lib/ease.py in_out_step_progress: times within rounding error of the jump count as on it.
test('In-Out Step times within rounding error of the midpoint count as on it', () => {
    const inOut = EaseType.inOutStep
    const bpms = calculateBpms([toBpmIntegral({ beat: 0, bpm: 150 })])
    const times = (...beats: number[]) => beats.map((beat) => beatToTime(bpms, beat))

    // At 150 BPM, beat 3 lands an ulp after the midpoint of beats 1 and 5.
    const [tA, tB, tNote] = times(1, 5, 3) as [number, number, number]
    assert.ok(tNote > (tA + tB) / 2)
    const value = stage({
        pivots: [
            { time: tA, lane: 0, divisionSize: 1, divisionParity: 0, yOffset: 0, ease: inOut },
            { time: tB, lane: 5, divisionSize: 1, divisionParity: 0, yOffset: 0, ease: 0 },
        ],
    })
    assert.equal(getStageProps(value, tNote).pivotLane, 0)
    assert.equal(getStageProps(value, tNote, { rightLimit: true }).pivotLane, 5)

    // Beat 4.5 lands an ulp before the midpoint of beats 2 and 7; the right limit still jumps.
    const [tC, tD, tEarly] = times(2, 7, 4.5) as [number, number, number]
    assert.ok(tEarly < (tC + tD) / 2)
    assert.equal(eventProgress(inOut, tEarly, tC, tD), 0)
    assert.equal(eventProgress(inOut, tEarly, tC, tD, true), 1)

    // The tolerance is the jump time, at least 1, times 2^-21.
    const tolerance = 1000 * 2 ** -21
    for (const rightLimit of [false, true]) {
        const within = rightLimit ? 1 : 0
        assert.equal(eventProgress(inOut, 1000 - tolerance / 2, 0, 2000, rightLimit), within)
        assert.equal(eventProgress(inOut, 1000 + tolerance / 2, 0, 2000, rightLimit), within)
        assert.equal(eventProgress(inOut, 1000 - tolerance * 2, 0, 2000, rightLimit), 0)
        assert.equal(eventProgress(inOut, 1000 + tolerance * 2, 0, 2000, rightLimit), 1)
    }

    // An eighth of a 2^-19 span caps it at 2^-22.
    const span = 2 ** -19
    assert.equal(eventProgress(inOut, span / 2 + 2 ** -23, 0, span), 0)
    assert.equal(eventProgress(inOut, span / 2 - 2 ** -23, 0, span, true), 1)
    assert.equal(eventProgress(inOut, span / 2 + 3 * 2 ** -23, 0, span), 1)
    assert.equal(eventProgress(inOut, span / 2 - 3 * 2 ** -23, 0, span, true), 0)
})
