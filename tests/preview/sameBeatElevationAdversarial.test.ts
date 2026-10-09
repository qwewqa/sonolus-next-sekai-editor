import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import type { Ease } from '../../src/ease'
import { guideElevationFraction } from '../../src/editor/utils/guideAlpha'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import { ConnectorVisualState, drawConnector } from '../../src/preview/engine/connector'
import { previewGuideAlphaFraction } from '../../src/preview/engine/elevation'
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
import type { VisualMask } from '../../src/preview/engine/mask'
import {
    applyAffine,
    ease,
    EaseType,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from '../../src/preview/engine/math'
import { ConnectorKind, type PreviewChart } from '../../src/preview/engine/model'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import { noteDistance, preemptTime } from '../../src/preview/engine/timescale'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin, type Sprite } from '../../src/preview/skin'
import { createState } from '../../src/state'

const groupId = 1 as GroupId
const stageId = 1 as StageId
const anchor = (lane: number, elevation: number, ease: Ease): NoteObject => ({
    groupId,
    stageId,
    beat: 1,
    elevation,
    noteType: 'anchor',
    isAttached: false,
    left: lane - 0.5,
    size: 1,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    noteStyle: 'default',
    connectorStyle: 'green',
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'guide',
    connectorEase: ease,
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
})

const chartFor = (notes: NoteObject[], rotated = false, masked = false): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 60 }],
    groups: new Map([[groupId, { name: 'Default' }]]),
    stages: new Map([
        [
            stageId,
            {
                name: 'Stage',
                isFromStart: true,
                isUntilEnd: true,
                generateSimLines: 'global',
            },
        ],
    ]),
    cameraEvents: rotated
        ? [
              {
                  beat: 0,
                  cameraLeft: -6,
                  cameraSize: 12,
                  cameraZoom: 1,
                  cameraZoomTargetLane: 0,
                  cameraZoomTargetY: 0,
                  cameraZoomVerticalAlign: 'default',
                  cameraRotation: 27,
                  cameraStageTilt: 0.7,
                  eventEase: 'linear',
              },
          ]
        : [],
    stageMaskEvents: masked
        ? [
              {
                  stageId,
                  beat: 0,
                  maskLeft: 0.5,
                  maskSize: 2,
                  isMaskNotes: true,
                  eventEase: 'linear',
              },
          ]
        : [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    stageTransformEvents: rotated
        ? [
              {
                  stageId,
                  beat: 0,
                  rotation: -18,
                  xTranslation: 0.3,
                  yTranslation: 0.1,
                  elevation: 0.2,
                  anchor: 'center',
                  eventEase: 'linear',
              },
          ]
        : [],
    timeScales: [],
    slides: [notes],
})

const compile = (chart: Chart) => buildPreviewChart(createState(chart, 0), 6)
const render = (chart: PreviewChart, now = 0.7, alphas?: number[]) => {
    const guide: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = resolveSkin((name) => (name === 'Sekai Guide Green' ? guide : undefined))
    const quads: Quad[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {},
        flush() {},
        dispose() {},
        isContextLost: () => false,
        draw(sprite, quad, _z, alpha) {
            if (sprite === guide && alpha > 0) {
                quads.push(quad)
                alphas?.push(alpha)
            }
        },
    }
    renderPreviewFrame(renderer, skin, chart, now, 1920, 1080, 1920, 1080, 6, false)
    assert.ok(
        quads.every((q) =>
            Object.values(q).every((p: Vec) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        ),
    )
    return quads
}

const withoutBeatMetadata = (chart: PreviewChart) => {
    for (const note of chart.notes) {
        delete note.source
        delete note.beat
    }
    return chart
}

const distance = (p: Vec, a: Vec, b: Vec) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    )
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}

const edgeError = (actual: Quad[], expected: Quad[]) => {
    // Compare each exterior side with that same side on the other mesh. Cross-sections
    // are not curve edges: including them could hide a curve that cuts across the ribbon.
    let error = 0
    for (const [bottom, top] of [
        ['bl', 'tl'],
        ['br', 'tr'],
    ] as const) {
        for (const quad of actual) {
            for (const p of [quad[bottom], quad[top]]) {
                error = Math.max(
                    error,
                    Math.min(...expected.map((q) => distance(p, q[bottom], q[top]))),
                )
            }
        }
    }
    return error
}

test('full preview uses elevation easing only for exactly equal authored beats', () => {
    for (const rotated of [false, true]) {
        const same = compile(chartFor([anchor(0, 0, 'inQuad'), anchor(4, 4, 'linear')], rotated))
        const actual = render(same)
        assert.ok(actual.length > 1)
        assert.notDeepEqual(actual, render(withoutBeatMetadata(same)))
        for (const delta of [Number.EPSILON, 1e-12, 1e-8, 1]) {
            const chart = compile(
                chartFor(
                    [anchor(0, 0, 'inQuad'), { ...anchor(4, 4, 'linear'), beat: 1 + delta }],
                    rotated,
                ),
            )
            // Equal scrolling progress/time must not broaden the authored-beat guard.
            chart.notes[1]!.targetTime = chart.notes[0]!.targetTime
            chart.notes[1]!.targetScaledTime = chart.notes[0]!.targetScaledTime
            const current = render(chart)
            assert.ok(current.length > 0, `${rotated}/${delta}`)
            assert.deepEqual(current, render(withoutBeatMetadata(chart)), `${rotated}/${delta}`)
        }
    }
})

test('negative authored beats and source-free compiled notes keep the exact guard', () => {
    for (const beat of [-1, -Number.EPSILON, 0]) {
        for (const delta of [0, Number.EPSILON, 1e-12]) {
            const chart = compile(chartFor([anchor(0, 0, 'inQuad'), anchor(4, 4, 'linear')], true))
            // Hold physical timing constant while exercising authored metadata, including
            // the compact chart representation which has no editor entity references.
            for (const note of chart.notes) {
                note.targetTime = 1
                note.targetScaledTime = 1
                delete note.source
            }
            chart.notes[0]!.beat = beat
            chart.notes[1]!.beat = beat + delta
            const current = render(chart)
            assert.ok(current.length > 0)
            const legacy = render(withoutBeatMetadata(chart))
            if (delta === 0) assert.notDeepEqual(current, legacy, `${beat}/${delta}`)
            else assert.deepEqual(current, legacy, `${beat}/${delta}`)
        }
    }
})

test('attached separators preserve the parent curve with rotation, masks and reverse elevation', () => {
    for (const ease of [
        'inQuad',
        'outCirc',
        'inOutBack',
        'outElastic',
        'inOutStep',
        'outInStep',
    ] as const) {
        for (const reverse of [false, true]) {
            for (const masked of [false, true]) {
                const head = anchor(0, reverse ? 4 : 0, ease)
                const tail = anchor(4, reverse ? 0 : 4, 'linear')
                const separator = {
                    ...anchor(19, reverse ? 3 : 1, ease),
                    isAttached: true,
                    isConnectorSeparator: true,
                }
                const whole = render(compile(chartFor([head, tail], true, masked)))
                const sliced = render(compile(chartFor([head, separator, tail], true, masked)))
                if (!whole.length || !sliced.length) {
                    assert.equal(whole.length, sliced.length, `${ease}/${reverse}/${masked}`)
                    continue
                }
                const error = Math.max(edgeError(whole, sliced), edgeError(sliced, whole))
                assert.ok(
                    error < (3 * 2) / 1080,
                    `${ease}/${reverse}/${masked}: ${(error * 1080) / 2} pixels`,
                )
            }
        }
    }
})

test('equal elevation keeps the existing degenerate connector behavior', () => {
    for (const ease of ['inQuad', 'inOutBack', 'outElastic', 'inOutStep'] as const) {
        const chart = compile(chartFor([anchor(0, 2, ease), anchor(4, 2, 'linear')], true))
        assert.deepEqual(render(chart), render(withoutBeatMetadata(chart)), ease)
    }
})

test('a same-beat mask outside the full easing range removes all guide geometry', () => {
    const chart = chartFor([anchor(0, 0, 'inQuad'), anchor(4, 4, 'linear')], true, true)
    chart.stageMaskEvents[0]!.maskLeft = 10
    assert.deepEqual(render(compile(chart)), [])
})

const samplingLayout = createLayout(
    createViewport(1920, 1080),
    { ...defaultCameraInfo(), rotate: 0.3, stageTilt: 0.8 },
    true,
)
type StageParameters = [rotation: number, x: number, y: number, pivot: number]
const stageMotion = (first: StageParameters, last: StageParameters) => (q: number, u: number) => {
    const camera = currentLayoutTransform(samplingLayout)
    return blendStageTransform(
        computeStageTransform(samplingLayout, camera, ...first, 0, 4 * u),
        computeStageTransform(samplingLayout, camera, ...last, 0, 4 * u),
        q,
    )
}

const sampledConnector = (
    type: EaseTypeValue,
    transform: ReturnType<typeof stageMotion>,
    from = { lane: 0, size: 0.5, mask: undefined as VisualMask | undefined },
    to = from,
) => {
    const quads: Quad[] = []
    const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    drawConnector(
        { now: 0, layout: samplingLayout },
        (_sprite, quad) => quads.push(quad),
        { ...resolveSkin(() => undefined), guides: [sprite] },
        ConnectorKind.guideNeutral,
        ConnectorVisualState.waiting,
        type,
        { ...from, targetTime: 1, visualProgress: 0.7, easeFrac: 0, transform: transform(0, 0) },
        { ...to, targetTime: 1, visualProgress: 0.7, easeFrac: 1, transform: transform(1, 1) },
        1,
        from.lane,
        1,
        1,
        1,
        1,
        1,
        0,
        false,
        false,
        1,
        transform,
    )
    return quads
}

const projectedEdge = (
    transform: ReturnType<typeof stageMotion>,
    q: number,
    u: number,
    lane: number,
) =>
    applyAffine(
        stageTransformToAffine(transform(q, u)),
        perspectiveVec(samplingLayout, lane, 1, approach(samplingLayout, 0.7)),
    )

test('stage-only motion follows all smooth easings without a raw lane or width change', () => {
    const transform = stageMotion([-0.8, -2, 0.3, -3], [0.8, 2, -0.3, 3])
    for (let type = 2; type <= 37; type++) {
        const curve = type as EaseTypeValue
        const quads = sampledConnector(curve, transform)
        assert.ok(quads.length > 1)
        let worst = 0
        for (let i = 0; i <= 800; i++) {
            const u = i / 800
            const q = ease(curve, u)
            for (const [side, bottom, top] of [
                [-1, 'bl', 'tl'],
                [1, 'br', 'tr'],
            ] as const) {
                const p = projectedEdge(transform, q, u, side * 0.5)
                worst = Math.max(
                    worst,
                    Math.min(...quads.map((quad) => distance(p, quad[bottom], quad[top]))),
                )
            }
        }
        assert.ok(
            worst < 2.5 * samplingLayout.screenPixelSize,
            `ease ${type}: ${worst / samplingLayout.screenPixelSize}px`,
        )
    }
})

test('moving masks determine sampling even when raw note and stage geometry do not move sideways', () => {
    const transform = stageMotion([0, 0, 0, 0], [0, 0, 0, 0])
    const from = { lane: 0, size: 3, mask: { enabled: true, left: -2, right: 4, stageIndex: 1 } }
    const to = { ...from, mask: { ...from.mask, left: 0, stageIndex: 2 } }
    const quads = sampledConnector(EaseType.inQuad, transform, from, to)
    assert.ok(quads.length > 1)
    let worst = 0
    for (let i = 0; i <= 800; i++) {
        const u = i / 800
        const q = u * u
        const p = projectedEdge(transform, q, u, -2 + 2 * q)
        worst = Math.max(worst, Math.min(...quads.map((quad) => distance(p, quad.bl, quad.tl))))
    }
    assert.ok(
        worst < 2.5 * samplingLayout.screenPixelSize,
        `${worst / samplingLayout.screenPixelSize}px`,
    )
})

test('raw Out Back edges discover the visible island missed by every coarse clipped sample', () => {
    const transform = stageMotion([0, 0, 0, 0], [0, 0, 0, 0])
    const mask = { enabled: true, left: 4.39, right: 5, stageIndex: 1 }
    for (const u of [0, 0.25, 0.5, 0.75, 1])
        assert.ok(4 * ease(EaseType.outBack, u) + 0.01 < mask.left)
    const quads = sampledConnector(
        EaseType.outBack,
        transform,
        { lane: 0, size: 0.01, mask },
        { lane: 4, size: 0.01, mask },
    )
    assert.ok(quads.length > 0, 'A narrow overshoot enters the mask between coarse samples')
    assert.ok(
        quads.every((quad) =>
            Object.values(quad).every(
                (point: Vec) => Number.isFinite(point.x) && Number.isFinite(point.y),
            ),
        ),
    )
})

test('same-beat attached progress blends different groups before the hit and holds at the judge line after it', () => {
    const secondGroup = 2 as GroupId
    for (const sameBeat of [true, false]) {
        const head = { ...anchor(0, 0, 'inQuad'), connectorIsPassThrough: true }
        const separator = {
            ...anchor(99, 1, 'inQuad'),
            beat: sameBeat ? 1 : 1.25,
            isAttached: true,
            isConnectorSeparator: true,
            connectorIsPassThrough: true,
        }
        const tail = { ...anchor(4, 4, 'linear'), beat: sameBeat ? 1 : 2, groupId: secondGroup }
        const chart = chartFor([head, separator, tail])
        chart.groups.set(secondGroup, { name: 'Faster' })
        chart.timeScales = [1, 2].map((speed, i) => ({
            groupId: i === 0 ? groupId : secondGroup,
            beat: 0,
            editorLane: 0,
            timeScale: speed,
            skip: 0,
            timeScaleEase: 'linear',
            timeScaleTransition: 'timeScale',
            hideNotes: false,
        }))
        const preview = compile(chart)
        const first = preview.notes[0]!
        const last = preview.notes[2]!
        const layout = createLayout(createViewport(1920, 1080), defaultCameraInfo(), true)
        for (const now of [0.7, 1, 1.1]) {
            const progress = (note: typeof first) => {
                const group = preview.groups[note.groupIndex]!
                return (
                    1 -
                    noteDistance(group, now, note.targetTime) / preemptTime(6, group.forceNoteSpeed)
                )
            }
            const fraction = 0.25
            let expectedProgress: number
            if (sameBeat)
                expectedProgress = now < 1 ? progress(first) * 0.75 + progress(last) * 0.25 : 1
            else {
                const headFraction = now < 1 ? 0 : now - 1
                const remaining = Math.max(
                    0,
                    Math.min(1, (fraction - headFraction) / (1 - headFraction)),
                )
                const headProgress = now < 1 ? progress(first) : 1
                expectedProgress = headProgress + (progress(last) - headProgress) * remaining
            }
            const transform = computeStageTransform(
                layout,
                currentLayoutTransform(layout),
                0,
                0,
                0,
                0,
                0,
                sameBeat ? 1 : 0.25,
            )
            const expected = applyAffine(
                stageTransformToAffine(transform),
                perspectiveVec(layout, -0.25, 1, approach(layout, expectedProgress)),
            )
            const vertices = render(preview, now).flatMap((quad) => Object.values(quad) as Vec[])
            assert.ok(vertices.length > 0)
            const error = Math.min(
                ...vertices.map((p) => Math.hypot(p.x - expected.x, p.y - expected.y)),
            )
            assert.ok(error < 1e-9, `${sameBeat}/${now}: attached endpoint error ${error}`)
        }
    }
})

test('identical endpoint transforms cannot cull a callback with a visible interior excursion', () => {
    for (const offscreenEndpoints of [false, true]) {
        const transform = (_q: number, u: number) => {
            const bulge = 4 * u * (1 - u)
            return computeStageTransform(
                samplingLayout,
                currentLayoutTransform(samplingLayout),
                0,
                4 * bulge,
                offscreenEndpoints ? 30 * (1 - bulge) : 0,
                0,
                0,
                2 * bulge,
            )
        }
        assert.deepEqual(transform(0, 0), transform(1, 1))
        const quads = sampledConnector(EaseType.linear, transform)
        assert.ok(quads.length > 1)
        const expected = projectedEdge(transform, 0.5, 0.5, -0.5)
        const error = Math.min(...quads.map((quad) => distance(expected, quad.bl, quad.tl)))
        assert.ok(error < 2.5 * samplingLayout.screenPixelSize)
    }
})

test('same-beat attached alpha follows linear elevation independently of geometric easing', () => {
    for (const curve of ['inQuad', 'outElastic'] as const) {
        for (const reverse of [false, true]) {
            const preview = compile(
                chartFor([
                    anchor(0, reverse ? 4 : 0, curve),
                    {
                        ...anchor(0, reverse ? 3 : 1, curve),
                        isAttached: true,
                        isConnectorSeparator: true,
                    },
                    {
                        ...anchor(0, reverse ? 1 : 3, curve),
                        isAttached: true,
                        isConnectorSeparator: true,
                    },
                    anchor(4, reverse ? 0 : 4, 'linear'),
                ]),
            )
            const style = {
                time: 0,
                judgeLineColor: 0,
                judgeLineStyle: 0 as const,
                leftBorderStyle: 0,
                rightBorderStyle: 0,
                fullWidth: 0,
                noteAlpha: 0,
                laneAlpha: 1,
                judgeLineAlpha: 1,
                divisionLineAlpha: 1,
                ease: EaseType.linear,
            }
            preview.stages[0]!.styles = [style]
            preview.stages.push({
                ...preview.stages[0]!,
                order: 1,
                styles: [{ ...style, noteAlpha: 1 }],
            })
            preview.notes[3]!.stageIndex = 1
            preview.connectors = preview.connectors.filter(
                ({ head, tail }) => head.isAttached && tail.isAttached,
            )
            assert.equal(preview.connectors.length, 1)
            const alphas: number[] = []
            const quads = render(preview, 0.7, alphas)
            assert.ok(alphas.length > 0)
            const layout = createLayout(createViewport(1920, 1080), defaultCameraInfo(), true)
            const progress = 1 - 0.3 / preemptTime(6, 0)
            const yAt = (z: number) =>
                applyAffine(
                    stageTransformToAffine(
                        computeStageTransform(
                            layout,
                            currentLayoutTransform(layout),
                            0,
                            0,
                            0,
                            0,
                            0,
                            z,
                        ),
                    ),
                    perspectiveVec(layout, 0, 1, approach(layout, progress)),
                ).y
            const firstY = yAt(reverse ? 4 : 0)
            const lastY = yAt(reverse ? 0 : 4)
            for (const [index, quad] of quads.entries()) {
                const fraction = ((quad.bl.y + quad.tl.y) / 2 - firstY) / (lastY - firstY)
                assert.ok(
                    Math.abs(alphas[index]! - 0.6 * fraction) < 1e-10,
                    `${curve}/${reverse}/${index}: actual ${alphas[index]}, expected ${0.6 * fraction}`,
                )
            }
        }
    }
})

test('full guide fades use clamped authored height across multiple attachment families', () => {
    for (const reverse of [false, true]) {
        const preview = compile(
            chartFor([
                { ...anchor(0, reverse ? 4 : 0, 'outElastic'), connectorGuideAlpha: 0 },
                {
                    ...anchor(99, reverse ? -12 : 12, 'outElastic'),
                    isAttached: true,
                    isConnectorSeparator: true,
                    connectorGuideAlpha: 0.25,
                },
                { ...anchor(2, 2, 'inQuad'), connectorGuideAlpha: 0.99 },
                { ...anchor(4, reverse ? 0 : 4, 'linear'), connectorGuideAlpha: 1 },
            ]),
        )
        assert.ok(preview.connectors.length >= 3)
        const alphas: number[] = []
        const quads = render(preview, 0.7, alphas)
        assert.ok(quads.length > 1)
        const layout = createLayout(createViewport(1920, 1080), defaultCameraInfo(), true)
        const progress = 1 - 0.3 / preemptTime(6, 0)
        const yAt = (height: number) =>
            applyAffine(
                stageTransformToAffine(
                    computeStageTransform(
                        layout,
                        currentLayoutTransform(layout),
                        0,
                        0,
                        0,
                        0,
                        0,
                        height,
                    ),
                ),
                perspectiveVec(layout, 0, 1, approach(layout, progress)),
            ).y
        const firstY = yAt(reverse ? 4 : 0)
        const lastY = yAt(reverse ? 0 : 4)
        for (const [index, quad] of quads.entries()) {
            const fraction = ((quad.bl.y + quad.tl.y) / 2 - firstY) / (lastY - firstY)
            const expectedAlpha =
                0.6 * (fraction <= 0.5 ? fraction * 0.5 : 0.25 + (fraction - 0.5) * 1.5)
            assert.ok(
                Math.abs(alphas[index]! - expectedAlpha) < 1e-10,
                `${reverse}/${index}: actual ${alphas[index]}, expected ${expectedAlpha}`,
            )
        }
    }
})

test('same-beat guide markers inside time-based parents share one authored opacity domain in both editor adapters', () => {
    const chart = chartFor([
        { ...anchor(0, 0, 'inQuad'), beat: 0 },
        { ...anchor(0, 0, 'inQuad'), isAttached: true, isConnectorSeparator: true },
        { ...anchor(0, 1, 'inQuad'), isAttached: true },
        { ...anchor(0, 4, 'inQuad'), isAttached: true, isConnectorSeparator: true },
        { ...anchor(4, 8, 'linear'), beat: 2 },
    ])
    const state = createState(chart, 0)
    const preview = buildPreviewChart(state, 6)
    const first = preview.notes[1]!
    const marker = preview.notes[2]!
    const last = preview.notes[3]!
    assert.equal(first.attachHead?.beat, 0)
    assert.equal(first.attachTail?.beat, 2)
    assert.equal(previewGuideAlphaFraction(marker, first, last), 0.25)
    assert.equal(
        guideElevationFraction(
            marker.source!,
            first.source!,
            last.source!,
            state.store.slides.info.get(marker.source!.slideId),
        ),
        0.25,
    )
    assert.equal(previewGuideAlphaFraction(first, first, last), 0)
    assert.equal(previewGuideAlphaFraction(last, first, last), 1)
})
