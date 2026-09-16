import assert from 'node:assert/strict'
import test from 'node:test'
import {
    ConnectorVisualState,
    drawConnector,
    type ConnectorEndpoint,
} from '../../src/preview/engine/connector'
import {
    DynamicLayout,
    Layout,
    cameraZoomAnchor,
    cameraZoomTargetAt,
    computeStageTransform,
    currentLayoutTransform,
    defaultCameraInfo,
    initLayout,
    layoutParticleLane,
    layoutRegularNoteBodyFallback,
    layoutSlotGlowEffect,
    layoutStageLaneByEdges,
    refreshLayout,
    stageTransformToAffine,
} from '../../src/preview/engine/layout'
import { EaseType, applyAffine, type Quad } from '../../src/preview/engine/math'
import { ConnectorKind } from '../../src/preview/engine/model'
import type { PreviewSkin, Sprite } from '../../src/preview/skin'

const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)

// The engine's locked field stays 16:9, centered inside the device viewport.
// Its test-aspect overlay uses these three ratios (sekai/lib/stage.py).
const presets = [
    { width: 1600, height: 900, fieldW: 32 / 9, fieldH: 2, fieldScale: 1 },
    { width: 2100, height: 900, fieldW: 32 / 9, fieldH: 2, fieldScale: 1 },
    { width: 1200, height: 900, fieldW: 8 / 3, fieldH: 1.5, fieldScale: 0.75 },
]

test('aspect presets fit the engine field while retaining the full device viewport', () => {
    for (const preset of presets) {
        initLayout(preset.width, preset.height)
        close(Layout.fieldW, preset.fieldW)
        close(Layout.fieldH, preset.fieldH)
        close(Layout.screenW, (2 * preset.width) / preset.height)
        close(Layout.screenH, 2)
        close(DynamicLayout.screenPixelSize, 2 / preset.height)

        // Extra space belongs to the viewport, not a stretched or cropped field.
        close(Layout.fieldW / Layout.fieldH, 16 / 9)
        assert.ok(Layout.fieldW <= Layout.screenW)
        assert.ok(Layout.fieldH <= Layout.screenH)
    }
})

const transformedGeometry = (width: number, height: number, tilt: number): Quad[] => {
    initLayout(width, height)
    const camera = {
        ...defaultCameraInfo(),
        lane: 1.5,
        size: 4,
        stageTilt: tilt,
        zoom: 1.3,
        rotate: 0.4,
        zoomTarget: cameraZoomTargetAt(1.5, 4, -0.75, 0.35, tilt),
        zoomAnchor: cameraZoomAnchor(0),
    }
    refreshLayout(camera, true)
    const stage = stageTransformToAffine(
        computeStageTransform(currentLayoutTransform(), -0.25, 2, -0.5, 1, 0.2, 0.75),
    )
    return [
        layoutRegularNoteBodyFallback(2, 1, 0.65),
        layoutStageLaneByEdges(-4, 4, 0.1),
        layoutParticleLane(2, 1, 0.1),
        layoutSlotGlowEffect(2, 1, 0.6, 0.1),
    ].map((quad) => ({
        bl: applyAffine(stage, quad.bl),
        tl: applyAffine(stage, quad.tl),
        tr: applyAffine(stage, quad.tr),
        br: applyAffine(stage, quad.br),
    }))
}

test('aspect changes preserve camera, stage, note and effect geometry without distortion', () => {
    for (const tilt of [0, 0.5, 1]) {
        const reference = transformedGeometry(1600, 900, tilt)
        for (const preset of presets) {
            const result = transformedGeometry(preset.width, preset.height, tilt)
            for (const [index, expected] of reference.entries()) {
                for (const corner of ['bl', 'tl', 'tr', 'br'] as const) {
                    close(result[index]![corner].x, expected[corner].x * preset.fieldScale)
                    close(result[index]![corner].y, expected[corner].y * preset.fieldScale)
                }
            }
        }
    }
})

test('full-screen connectors cover the viewport beyond the fitted 16:9 field', () => {
    const sprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = { guides: [sprite] } as PreviewSkin
    const endpoint: ConnectorEndpoint = {
        lane: 0,
        size: 1,
        targetTime: 0,
        visualProgress: 1,
        easeFrac: 0,
    }
    for (const preset of presets) {
        initLayout(preset.width, preset.height)
        refreshLayout(defaultCameraInfo(), true)
        const quads: Quad[] = []
        drawConnector(
            (_, quad) => quads.push(quad),
            skin,
            1,
            ConnectorKind.guideNeutral,
            ConnectorVisualState.waiting,
            EaseType.linear,
            endpoint,
            { ...endpoint, targetTime: 2 },
            0,
            0,
            1,
            2,
            1,
            1,
            1,
            0,
            true,
        )
        const halfWidth = preset.width / preset.height
        assert.deepEqual(quads, [
            {
                bl: { x: -halfWidth, y: -1 },
                tl: { x: -halfWidth, y: 1 },
                tr: { x: halfWidth, y: 1 },
                br: { x: halfWidth, y: -1 },
            },
        ])
    }
})
