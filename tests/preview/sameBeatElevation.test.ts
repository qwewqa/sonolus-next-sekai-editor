import assert from 'node:assert/strict'
import test from 'node:test'
import { attachEasedFrac, attachFrac } from '../../src/preview/engine/chart'
import { ConnectorVisualState, drawConnector } from '../../src/preview/engine/connector'
import {
    blendElevationTransform,
    effectiveNoteElevation,
    noteElevationTransform,
    noteTransformAtElevation,
    previewGuideAlphaFraction,
    sameAuthoredBeat,
} from '../../src/preview/engine/elevation'
import {
    computeNoteHitbox,
    computeSlideInputBounds,
    createGeometryContext,
    inputGeometry,
} from '../../src/preview/engine/hitbox'
import {
    approach,
    blendStageTransform,
    computeStageTransform,
    createLayout,
    createViewport,
    currentLayoutTransform,
    defaultCameraInfo,
    perspectiveVec,
    stageTransformToAffine,
} from '../../src/preview/engine/layout'
import {
    EaseType,
    applyAffine,
    ease,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from '../../src/preview/engine/math'
import { ConnectorKind, NoteKind, type PreviewNote } from '../../src/preview/engine/model'
import { resolveSkin, type Sprite } from '../../src/preview/skin'

const note = (beat: number, elevation: number): PreviewNote => ({
    beat,
    elevation,
    style: 'default',
    kind: NoteKind.anchor,
    isCritical: false,
    isFake: false,
    targetTime: beat,
    lane: 0,
    size: 0.5,
    direction: 0,
    groupIndex: 0,
    stageIndex: -1,
    isAttached: false,
    connectorEase: EaseType.inQuad,
    targetScaledTime: beat,
})
const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('same-beat attachments use their stored elevation and retain time interpolation for every distinct beat', () => {
    for (const [headElevation, tailElevation, elevation, expected] of [
        [0, 4, 2, 0.5],
        [0, 4, 1, 0.25],
        [4, 0, 3, 0.25],
        [0, 4, -1, 0],
        [0, 4, 9, 1],
        [4, 0, -1, 1],
        [2, 2, 9, 0.5],
        [2, 2 + 1e-7, 9, 0.5],
    ] as const) {
        const head = note(2, headElevation)
        const tail = note(2, tailElevation)
        const attached = {
            ...note(2, elevation),
            isAttached: true,
            attachHead: head,
            attachTail: tail,
        }
        close(attachFrac(attached), expected)
        close(attachEasedFrac(attached), expected ** 2)
        tail.beat = 2 + 1e-10
        assert.equal(sameAuthoredBeat(head, tail), false)
        close(attachFrac(attached), 0.5)
        head.targetTime = 0
        tail.targetTime = 4
        attached.targetTime = 1
        close(attachFrac(attached), 0.25)
    }
    const head = note(2, 0)
    const tail = note(2, 4)
    delete head.beat
    delete tail.beat
    assert.equal(sameAuthoredBeat(head, tail), false)
})

test('Preview guide opacity resolves segment identity and clamped attachment coordinates', () => {
    const head = note(2, 0)
    const tail = note(2, 4)
    const attached = (height: number) => ({
        ...note(2, height),
        isAttached: true,
        attachHead: head,
        attachTail: tail,
    })
    const start = attached(-2)
    const end = attached(8)
    close(previewGuideAlphaFraction(start, start, end) ?? -1, 0)
    close(previewGuideAlphaFraction(end, start, end) ?? -1, 1)
    close(previewGuideAlphaFraction(attached(1), start, end) ?? -1, 0.25)
    close(previewGuideAlphaFraction(attached(1), end, start) ?? -1, 0.75)
    tail.elevation = 0
    close(previewGuideAlphaFraction(attached(0), head, tail) ?? -1, 0.5)
    close(previewGuideAlphaFraction(tail, head, tail) ?? -1, 1)
    tail.beat = 2 + 1e-12
    assert.equal(previewGuideAlphaFraction(head, head, tail), undefined)
    delete tail.beat
    assert.equal(previewGuideAlphaFraction(head, head, tail), undefined)
})

test('linear elevation recomputes rotated stage centers and clamps the interpolated height', () => {
    const layout = createLayout(
        createViewport(1600, 900),
        { ...defaultCameraInfo(), stageTilt: 0.8, rotate: 0.4 },
        true,
    )
    const camera = currentLayoutTransform(layout)
    const limit = -camera.hScale / camera.wScale / camera.stageTilt ** 2
    const head = {
        ...noteElevationTransform(undefined),
        rotate: 0.7,
        lane: 2,
        xLaneTranslate: 1,
        yLaneTranslate: -0.5,
        centerWeight: 0.3,
    }
    const tail = { ...head, elevation: 2 * limit }
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const actual = stageTransformToAffine(
            blendElevationTransform(layout, camera, head, tail, fraction ** 2, fraction),
        )
        const expected = stageTransformToAffine(
            computeStageTransform(
                layout,
                camera,
                head.rotate,
                head.xLaneTranslate,
                head.yLaneTranslate,
                head.lane,
                head.centerWeight,
                2 * limit * fraction,
            ),
        )
        for (const key of ['a00', 'a01', 'a02', 'a10', 'a11', 'a12', 'elevation'] as const)
            close(actual[key], expected[key])
    }
})

test('time-based attached endpoints preserve both inherited projections when changing elevation', () => {
    const layout = createLayout(
        createViewport(1600, 900),
        { ...defaultCameraInfo(), rotate: 0.3, stageTilt: 0.8 },
        true,
    )
    const camera = currentLayoutTransform(layout)
    for (const firstHeight of [0, 4, 20]) {
        for (const lastHeight of [0, 4, 20]) {
            for (const fraction of [0.25, 0.75]) {
                const head = { ...note(1, firstHeight), connectorEase: EaseType.inQuad }
                const tail = note(3, lastHeight)
                const attached = {
                    ...note(1 + 2 * fraction, 17),
                    isAttached: true,
                    attachHead: head,
                    attachTail: tail,
                }
                const q = fraction ** 2
                const baseline = effectiveNoteElevation(attached, () => undefined)
                for (const shift of [-2, 0, 3]) {
                    const actual = stageTransformToAffine(
                        noteTransformAtElevation(
                            layout,
                            camera,
                            attached,
                            () => undefined,
                            baseline + shift,
                        ),
                    )
                    const expected = stageTransformToAffine(
                        blendStageTransform(
                            computeStageTransform(
                                layout,
                                camera,
                                0,
                                0,
                                0,
                                0,
                                0,
                                firstHeight + shift,
                            ),
                            computeStageTransform(
                                layout,
                                camera,
                                0,
                                0,
                                0,
                                0,
                                0,
                                lastHeight + shift,
                            ),
                            q,
                        ),
                    )
                    for (const key of [
                        'a00',
                        'a01',
                        'a02',
                        'a10',
                        'a11',
                        'a12',
                        'elevation',
                    ] as const)
                        close(actual[key], expected[key])
                }
            }
        }
    }
})

test('same-beat input bounds and attached notes follow the connector elevation axis', () => {
    const head = { ...note(2, 0), lane: 0, size: 0.5 }
    const tail = { ...note(2, 4), lane: 4, size: 1.5 }
    const context = createGeometryContext(
        {
            isDynamicStages: false,
            notes: [head, tail],
            connectors: [],
            slides: [],
            simLines: [],
            chains: [],
            cameras: [],
            groups: [],
            stages: [],
            hasStageTransforms: false,
        },
        createViewport(1600, 900),
        2,
    )
    const midpoint = { ...note(2, 2), lane: 1, size: 0.75 }
    const expected = computeNoteHitbox(context, {
        note: midpoint,
        drawStart: 0,
        target: 2,
        leniency: 1,
    }).bounds
    const actual = computeSlideInputBounds(context, EaseType.inQuad, head, tail, 1)
    for (const corner of ['bl', 'br', 'tl', 'tr'] as const) {
        close(actual[corner].x, expected[corner].x)
        close(actual[corner].y, expected[corner].y)
    }
    const attached = { ...midpoint, isAttached: true, attachHead: head, attachTail: tail }
    const geometry = inputGeometry(context, attached)
    close(geometry.lane, 1)
    close(geometry.transform.projection.elevation, 2)
    tail.beat = 2 + 1e-10
    const legacy = inputGeometry(context, attached)
    close(legacy.lane, 1)
    close(legacy.transform.projection.elevation, 1)
})

const middle = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

test('descending elevation fractions split In Out Step into both constant bands', () => {
    const layout = createLayout(createViewport(1600, 900), defaultCameraInfo(), true)
    const camera = currentLayoutTransform(layout)
    const transform = (_q: number, u: number) =>
        computeStageTransform(layout, camera, 0, 0, 0, 0, 0, 3 - 2 * u)
    const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const quads: Quad[] = []
    drawConnector(
        { now: 0, layout },
        (_sprite, quad) => quads.push(quad),
        { ...resolveSkin(() => undefined), guides: [sprite] },
        ConnectorKind.guideNeutral,
        ConnectorVisualState.waiting,
        EaseType.inOutStep,
        {
            lane: 4,
            size: 0.5,
            visualProgress: 0.7,
            targetTime: 2,
            easeFrac: 0.75,
            transform: transform(0, 0),
        },
        {
            lane: 0,
            size: 0.5,
            visualProgress: 0.7,
            targetTime: 2,
            easeFrac: 0.25,
            transform: transform(1, 1),
        },
        2,
        0,
        1,
        2,
        1,
        1,
        1,
        0,
        false,
        false,
        2,
        transform,
    )
    assert.ok(quads.length >= 2)
    const centers = quads.flatMap((quad) => [middle(quad.bl, quad.br), middle(quad.tl, quad.tr)])
    for (const [lane, u] of [
        [4, 0],
        [4, 0.5],
        [0, 0.5],
        [0, 1],
    ] as const) {
        const expected = applyAffine(
            stageTransformToAffine(transform(0, u)),
            perspectiveVec(layout, lane, 1, approach(layout, 0.7)),
        )
        assert.ok(
            centers.some((point) => Math.hypot(point.x - expected.x, point.y - expected.y) < 1e-9),
            `${lane}/${u}`,
        )
    }
})

for (const reverse of [false, true]) {
    for (const easeType of [
        EaseType.inQuad,
        EaseType.inOutStep,
        EaseType.inStep,
        EaseType.outStep,
        EaseType.outInStep,
    ] as EaseTypeValue[]) {
        test(`connector ease ${easeType} uses a linear elevation axis, reverse ${reverse}`, () => {
            const layout = createLayout(
                createViewport(1600, 900),
                { ...defaultCameraInfo(), stageTilt: 1, rotate: 0.2 },
                true,
            )
            const camera = currentLayoutTransform(layout)
            const head = {
                ...noteElevationTransform(undefined, reverse ? 4 : 0),
                rotate: 0.35,
                lane: 1,
            }
            const tail = { ...head, elevation: reverse ? 0 : 4 }
            const transform = (q: number, u: number) =>
                blendElevationTransform(layout, camera, head, tail, q, u)
            const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
            const skin = { ...resolveSkin(() => undefined), guides: [sprite] }
            const quads: Quad[] = []
            const from = {
                lane: 0,
                size: 0.5,
                visualProgress: 0.7,
                targetTime: 2,
                easeFrac: 0,
                transform: transform(0, 0),
            }
            const to = { ...from, lane: 4, size: 1.5, easeFrac: 1, transform: transform(1, 1) }
            drawConnector(
                { now: 0, layout },
                (_sprite, quad) => quads.push(quad),
                skin,
                ConnectorKind.guideNeutral,
                ConnectorVisualState.waiting,
                easeType,
                from,
                to,
                2,
                0,
                1,
                2,
                1,
                1,
                1,
                0,
                false,
                false,
                2,
                transform,
            )
            assert.ok(quads.length > 0)
            const edges = quads.flatMap(
                (quad) =>
                    [
                        [quad.bl, quad.br],
                        [quad.tl, quad.tr],
                    ] as const,
            )
            for (const fraction of [0.25, 0.75]) {
                const q = ease(easeType, fraction)
                const affine = stageTransformToAffine(transform(q, fraction))
                const travel = approach(layout, 0.7)
                const size = 0.5 + q
                const expectedLeft = applyAffine(
                    affine,
                    perspectiveVec(layout, 4 * q - size, 1, travel),
                )
                const expectedRight = applyAffine(
                    affine,
                    perspectiveVec(layout, 4 * q + size, 1, travel),
                )
                const distance = (point: Vec, start: Vec, end: Vec) => {
                    const dx = end.x - start.x
                    const dy = end.y - start.y
                    const length = dx * dx + dy * dy
                    const f = length
                        ? Math.max(
                              0,
                              Math.min(
                                  1,
                                  ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
                              ),
                          )
                        : 0
                    return Math.hypot(point.x - start.x - f * dx, point.y - start.y - f * dy)
                }
                assert.ok(
                    quads.some(
                        (quad) =>
                            distance(expectedLeft, quad.bl, quad.tl) < 2.5 / 1080 &&
                            distance(expectedRight, quad.br, quad.tr) < 2.5 / 1080,
                    ),
                    `Curve edges miss the expected point at ${fraction}`,
                )
            }
            if (easeType === EaseType.inQuad) {
                const expected = applyAffine(
                    stageTransformToAffine(transform(0.25, 0.5)),
                    perspectiveVec(layout, 1, 1, approach(layout, 0.7)),
                )
                assert.ok(
                    edges.some(([left, right]) => {
                        const actual = middle(left, right)
                        return Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9
                    }),
                    'At the middle elevation, In Quad reaches lane 1 instead of lane 2',
                )
            }
        })
    }
}
