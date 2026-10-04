import assert from 'node:assert/strict'
import test from 'node:test'
import { type PreviewFrameContext } from '../../src/preview/engine/context'
import {
    approach,
    createLayout,
    createViewport,
    defaultCameraInfo,
    FlickDirection,
    identityStageScreenTransform,
    transformedVecAt,
} from '../../src/preview/engine/layout'
import { applyAffine, type Vec } from '../../src/preview/engine/math'
import { NoteKind, type PreviewChart, type PreviewNote } from '../../src/preview/engine/model'
import { getNoteSelectionLine } from '../../src/preview/engine/note'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import { createTimescaleGroup } from '../../src/preview/engine/timescale'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin } from '../../src/preview/skin'

const context: PreviewFrameContext = {
    now: 0,
    layout: createLayout(createViewport(1600, 900), defaultCameraInfo(), false),
}

test('anchor selection lines follow note perspective, masks and stage transforms', () => {
    const transform = {
        ...identityStageScreenTransform,
        a00: 0.8,
        a01: 0.2,
        a02: 0.15,
        a10: -0.2,
        a11: 1.1,
        a12: 0.3,
        elevation: 2,
    }
    const progress = 0.8
    const line = getNoteSelectionLine(context, 1, 2, progress, transform, 0.4, {
        enabled: true,
        left: 0,
        right: 2,
    })
    const travel = approach(context.layout, progress)
    assert.deepEqual(line, {
        a: applyAffine(transform, transformedVecAt(context.layout, 0, travel)),
        b: applyAffine(transform, transformedVecAt(context.layout, 2, travel)),
    })
    for (const hiddenProgress of [
        context.layout.progressStart - 0.01,
        context.layout.progressCutoff + 0.01,
    ]) {
        assert.equal(getNoteSelectionLine(context, 0, 1, hiddenProgress, transform, 1), undefined)
    }
    assert.equal(getNoteSelectionLine(context, 0, 1, progress, transform, 0), undefined)
    assert.equal(
        getNoteSelectionLine(context, 0, 1, progress, transform, 1, {
            enabled: true,
            left: 3,
            right: 4,
        }),
        undefined,
    )
})

test('invisible anchors highlight only when selected and approaching or exactly at the hit time', () => {
    const source = {} as NonNullable<PreviewNote['source']>
    const note: PreviewNote = {
        source,
        kind: NoteKind.anchor,
        style: 'default',
        isCritical: false,
        isFake: false,
        targetTime: 3,
        lane: 0,
        size: 1,
        elevation: 2,
        direction: FlickDirection.upOmni,
        groupIndex: 0,
        stageIndex: -1,
        isAttached: false,
        connectorEase: 1,
        targetScaledTime: 3,
    }
    const chart: PreviewChart = {
        isDynamicStages: false,
        notes: [note],
        connectors: [],
        slides: [],
        simLines: [],
        cameras: [],
        groups: [createTimescaleGroup([], 0)],
        stages: [],
        hasStageTransforms: false,
    }
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1600, height: 900 },
        setTexture() {},
        begin() {},
        draw() {},
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    const skin = resolveSkin(() => undefined)
    const capture = (now: number, paused: boolean, selected = true) => {
        const lines: { a: Vec; b: Vec }[] = []
        renderPreviewFrame(
            renderer,
            skin,
            chart,
            now,
            1600,
            900,
            1600,
            900,
            8,
            false,
            undefined,
            {
                objects: new Set(selected ? [source] : []),
                outline() {
                    assert.fail('Anchor should produce a line, not a sprite outline')
                },
                line: (a, b) => lines.push({ a, b }),
            },
            paused,
        )
        return lines
    }
    assert.equal(capture(2.9, true).length, 1)
    assert.deepEqual(capture(2.9, true), capture(2.9, false))
    assert.equal(capture(3, true).length, 1)
    assert.deepEqual(capture(3, true), capture(3, false))
    assert.equal(capture(2.9, true, false).length, 0)
    assert.equal(capture(3.001, true).length, 0)
    assert.equal(capture(3.001, false).length, 0)
    note.kind = NoteKind.hideTick
    assert.equal(capture(3, true).length, 1)
})
