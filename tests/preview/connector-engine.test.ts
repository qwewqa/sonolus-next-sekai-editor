import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import type { Ease } from '../../src/ease'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import type { Quad } from '../../src/preview/engine/math'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin, type Sprite } from '../../src/preview/skin'
import { createState } from '../../src/state'

const groupId = 1 as GroupId
const stageId = 1 as StageId

const anchor = (beat: number, lane: number, connectorEase: Ease): NoteObject => ({
    groupId,
    stageId,
    beat,
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
    connectorEase,
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
})

const guideQuads = (ease: Ease, now = 0.7) => {
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: false,
        bpms: [{ beat: 0, bpm: 60 }],
        groups: new Map([[groupId, { name: 'Default' }]]),
        stages: new Map([
            [
                stageId,
                { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ],
        ]),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [[anchor(1, -3, ease), anchor(2, 3, 'linear')]],
    }
    const guide: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = resolveSkin((name) => (name === 'Sekai Guide Green' ? guide : undefined))
    const quads: Quad[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {},
        draw(sprite, quad, _z, alpha) {
            if (sprite === guide && alpha > 0) quads.push(quad)
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    const preview = buildPreviewChart(createState(chart, 0), 6)
    renderPreviewFrame(renderer, skin, preview, now, 1920, 1080, 1920, 1080, 6, false)
    return quads
}

const coordinateSum = (quads: Quad[]) =>
    quads.reduce(
        (sum, { bl, tl, tr, br }) => sum + bl.x + bl.y + tl.x + tl.y + tr.x + tr.y + br.x + br.y,
        0,
    )

test('connectors split into the same segments as the engine', () => {
    // Watch mode draws at note speed 6, from the packaged engine callbacks.
    for (const [ease, count, sum] of [
        ['inQuad', 11, 14.114541189],
        ['outCirc', 27, 3.447804943],
        ['inOutBack', 32, 47.795279385],
        ['outElastic', 35, 77.015405547],
        ['inOutStep', 2, 2.834125739],
        ['outInStep', 1, 1.50055448],
    ] as const) {
        const quads = guideQuads(ease)
        assert.equal(quads.length, count, ease)
        assert.ok(Math.abs(coordinateSum(quads) - sum) < 1e-6, `${ease}: ${coordinateSum(quads)}`)
    }
})

test("step connectors hold their value at the head's own time", () => {
    const [quad, ...rest] = guideQuads('outInStep', 1)
    assert.equal(rest.length, 0)
    const expected = [-0.1166, -0.5824, -0.0314, 0.6412, 0.0314, 0.6412, 0.1166, -0.5824]
    const actual = [quad!.bl, quad!.tl, quad!.tr, quad!.br].flatMap(({ x, y }) => [x, y])
    for (const [i, value] of actual.entries()) assert.ok(Math.abs(value - expected[i]!) < 1e-4)
})

test('attached notes take no negative size where the ease overshoots', () => {
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: false,
        bpms: [{ beat: 0, bpm: 60 }],
        groups: new Map([[groupId, { name: 'Default' }]]),
        stages: new Map([
            [
                stageId,
                { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ],
        ]),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [
            [
                { ...anchor(1, 0, 'inBack'), size: 0.2 },
                { ...anchor(1.8, 0, 'inBack'), isAttached: true },
                { ...anchor(3, 0, 'linear'), size: 4 },
            ],
        ],
    }
    const attached = buildPreviewChart(createState(chart, 0), 6).notes.find(
        (note) => note.isAttached,
    )
    assert.equal(attached?.size, 0)
})

test('slide heads interpolate between the sizes of the connector around them', () => {
    const slideNote = (
        beat: number,
        left: number,
        size: number,
        extra: Partial<NoteObject> = {},
    ) => ({
        ...anchor(beat, 0, 'inOutBack'),
        noteType: 'default' as const,
        connectorType: 'active' as const,
        connectorStyle: 'default' as const,
        isFake: true,
        connectorIsFake: true,
        left,
        size,
        ...extra,
    })
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: false,
        bpms: [{ beat: 0, bpm: 60 }],
        groups: new Map([[groupId, { name: 'Default' }]]),
        stages: new Map([
            [
                stageId,
                { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ],
        ]),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [
            [
                slideNote(7, -3.1, 0.2),
                slideNote(7.2, 0, 0, { isAttached: true }),
                slideNote(7.4, 0, 0, { isAttached: true, isConnectorSeparator: true }),
                slideNote(8, 0, 0, { isAttached: true }),
                slideNote(9, 1, 4),
            ],
        ],
    }
    const middle: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = resolveSkin((name) =>
        name === 'Sekai Slide Note Middle'
            ? middle
            : name.startsWith('Sekai')
              ? { ...middle }
              : undefined,
    )
    const quads: Quad[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {},
        draw(sprite, quad, _z, alpha) {
            // Only the moving head is at the judge line.
            if (sprite === middle && alpha > 0 && Math.abs(quad.bl.y + 0.6563) < 1e-3)
                quads.push(quad)
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    const preview = buildPreviewChart(createState(chart, 0), 6)
    renderPreviewFrame(renderer, skin, preview, 7.3, 1920, 1080, 1920, 1080, 6, false)
    // From Watch mode; the global ease alone would give this BACK slide no width here.
    const expected = [-0.8301, -0.6563, -0.76, -0.5085, -0.76, -0.5085, -0.8301, -0.6563]
    assert.equal(quads.length, 1)
    const actual = [quads[0]!.bl, quads[0]!.tl, quads[0]!.tr, quads[0]!.br].flatMap(({ x, y }) => [
        x,
        y,
    ])
    for (const [i, value] of actual.entries()) assert.ok(Math.abs(value - expected[i]!) < 1e-4)
})

test("a passed head's crossed masks reach each segment uncollapsed, as the engine draws them", () => {
    const narrowId = 2 as StageId
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: true,
        bpms: [{ beat: 0, bpm: 60 }],
        groups: new Map([[groupId, { name: 'Default' }]]),
        stages: new Map(
            [stageId, narrowId].map((id) => [
                id,
                { name: 'Stage', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
            ]),
        ),
        cameraEvents: [],
        // A wide stage and a narrow one, both masking notes.
        stageMaskEvents: [
            {
                stageId,
                beat: 0,
                maskLeft: -6,
                maskSize: 12,
                isMaskNotes: true,
                eventEase: 'linear',
            },
            {
                stageId: narrowId,
                beat: 0,
                maskLeft: 4.475,
                maskSize: 0.05,
                isMaskNotes: true,
                eventEase: 'linear',
            },
        ],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [[anchor(1, -3, 'outBack'), { ...anchor(3, 4.5, 'linear'), stageId: narrowId }]],
    }
    const guide: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = resolveSkin((name) => (name === 'Sekai Guide Green' ? guide : undefined))
    const quads: Quad[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {},
        draw(sprite, quad, _z, alpha) {
            if (sprite === guide && alpha > 0) quads.push(quad)
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    const preview = buildPreviewChart(createState(chart, 0), 6)
    renderPreviewFrame(renderer, skin, preview, 2, 1920, 1080, 1920, 1080, 6, false)
    // Collapsing the head's limits first drew 14 here.
    assert.equal(quads.length, 3)
})
