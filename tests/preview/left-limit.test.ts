import assert from 'node:assert/strict'
import test from 'node:test'
import { FlickDirection } from '../../src/preview/engine/layout'
import {
    ConnectorKind,
    NoteKind,
    type PreviewChart,
    type PreviewConnector,
    type PreviewNote,
    type PreviewSlide,
    type PreviewStage,
} from '../../src/preview/engine/model'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import { findSlideConnector } from '../../src/preview/engine/slide'
import { createTimeIndex, queryTimeIndex } from '../../src/preview/engine/timeIndex'
import { createTimescaleGroup, hideNotesAt, noteDistance } from '../../src/preview/engine/timescale'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin, type PreviewSkin, type Sprite } from '../../src/preview/skin'

const body: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
const connectorSprite: Sprite = { ...body }
const skin: PreviewSkin = {
    ...resolveSkin(() => undefined),
    normalNote: {
        body: { renderType: 'normalFallback', middle: body },
        arrow: { fallback: false, up: [], down: [], upLeft: [], downLeft: [] },
    },
    activeSlideConnector: { normal: connectorSprite },
}
const note = (targetTime: number, elevation = 0): PreviewNote => ({
    kind: NoteKind.tap,
    style: 'default',
    isCritical: false,
    isFake: false,
    targetTime,
    lane: 0,
    size: 1,
    elevation,
    direction: FlickDirection.upOmni,
    groupIndex: 0,
    stageIndex: -1,
    isAttached: false,
    connectorEase: 1,
    targetScaledTime: targetTime,
})
const chart = (
    notes: PreviewNote[],
    connectors: PreviewConnector[] = [],
    slides: PreviewSlide[] = [],
): PreviewChart => ({
    isDynamicStages: false,
    notes,
    connectors,
    slides,
    simLines: [],
    chains: [],
    cameras: [],
    groups: [createTimescaleGroup([], 0)],
    stages: [],
    hasStageTransforms: false,
})
const capture = (source: PreviewChart, now: number, leftLimit: boolean, currentSkin = skin) => {
    const draws: Parameters<PreviewRenderer['draw']>[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1920 },
        setTexture() {},
        begin() {},
        draw: (...args) => {
            draws.push(args)
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    renderPreviewFrame(
        renderer,
        currentSkin,
        source,
        now,
        1600,
        900,
        1600,
        900,
        8,
        true,
        undefined,
        undefined,
        leftLimit,
    )
    return draws
}
const connect = (head: PreviewNote, tail: PreviewNote): PreviewConnector => ({
    kind: ConnectorKind.activeNormal,
    style: 'default',
    ease: 1,
    head,
    tail,
    segmentHead: head,
    segmentTail: tail,
    segmentHeadAlpha: 1,
    segmentTailAlpha: 1,
    layer: 0,
    throughJudgeLine: false,
    fullScreen: false,
})

test('paused left limits retain unhit notes at zero, fractional and very large exact times', () => {
    const expectedQuad = capture(chart([note(0)]), 0, true).find(([sprite]) => sprite === body)?.[1]
    assert.ok(expectedQuad)
    for (const time of [0, 1 / 3, 1e20]) {
        const source = chart([note(time)])
        assert.equal(capture(source, time, false).filter(([sprite]) => sprite === body).length, 0)
        assert.ok(
            capture(source, time, true).some(([sprite]) => sprite === body),
            `${time}`,
        )
        assert.deepEqual(
            capture(source, time, true).find(([sprite]) => sprite === body)?.[1],
            expectedQuad,
        )
        const index = createTimeIndex(
            [time],
            (item) => item,
            (item) => item,
        )
        assert.equal(queryTimeIndex(index, time, time).length, 0)
        assert.equal(queryTimeIndex(index, time, time, true).length, 1)
    }
})

test('frames at a tied stage transform sample the first, paused or playing', () => {
    const upcoming = { ...note(2), stageIndex: 0 }
    const initialTransform = {
        time: 0,
        rotate: 0,
        xLaneTranslate: 0,
        yLaneTranslate: 0,
        elevation: 0,
        centerWeight: 0,
        ease: 1 as const,
    }
    const stage: PreviewStage = {
        order: 0,
        drawStartTime: 0,
        drawEndTime: 3,
        masks: [],
        pivots: [],
        styles: [],
        hasTransforms: true,
        transforms: [
            initialTransform,
            {
                time: 1,
                rotate: 0,
                xLaneTranslate: 0,
                yLaneTranslate: 0,
                elevation: 1,
                centerWeight: 0,
                ease: 1,
            },
            {
                time: 1,
                rotate: 0,
                xLaneTranslate: 0,
                yLaneTranslate: 0,
                elevation: 4,
                centerWeight: 0,
                ease: 1,
            },
        ],
    }
    const source: PreviewChart = {
        ...chart([upcoming]),
        isDynamicStages: true,
        hasStageTransforms: true,
        stages: [stage],
    }
    const reference: PreviewChart = {
        ...source,
        stages: [{ ...stage, transforms: [{ ...initialTransform, elevation: 1 }] }],
    }
    const bodyQuad = (current: PreviewChart, leftLimit: boolean) =>
        capture(current, 1, leftLimit).find(([sprite]) => sprite === body)?.[1]
    assert.ok(bodyQuad(source, true))
    assert.deepEqual(bodyQuad(source, true), bodyQuad(reference, false))
    assert.deepEqual(bodyQuad(source, false), bodyQuad(reference, false))
})

test('same-beat elevation transitions remain separate visible connectors before the hit', () => {
    const time = 1 / 3
    const a = note(time, 0)
    const b = note(time, 1)
    const c = note(time, 3)
    const notes = [a, b, c]
    const first = connect(a, b)
    const second = connect(b, c)
    const source = chart(notes, [first, second])
    const draws = capture(source, time, true).filter(([sprite]) => sprite === connectorSprite)
    assert.ok(draws.length >= 2)
    assert.ok(draws.every(([, quad]) => Math.abs(quad.tl.y - quad.bl.y) > 0))
    for (const now of [time - 0.25, time - 0.1, time - 1e-6]) {
        const paused = capture(source, now, true).filter(([sprite]) => sprite === connectorSprite)
        const playing = capture(source, now, false).filter(([sprite]) => sprite === connectorSprite)
        assert.ok(playing.length >= 2)
        assert.deepEqual(playing, paused)
    }
    assert.equal(
        capture(source, time, false).filter(([sprite]) => sprite === connectorSprite).length,
        0,
    )
})

test('slide heads keep the incoming connector at tied endpoints in the left limit', () => {
    const head = note(0)
    const first = note(1, 1)
    const second = note(1, 3)
    const tail = note(2, 4)
    const connectors = [connect(head, first), connect(first, second), connect(second, tail)]
    const slide: PreviewSlide = {
        activeHead: head,
        activeTail: tail,
        notes: [head, first, second, tail],
        kind: ConnectorKind.activeNormal,
        connectors,
    }
    assert.equal(findSlideConnector(slide, 1, true), connectors[0])
    assert.equal(findSlideConnector(slide, 1), connectors[2])
})

test('left-limit group visibility and skip distance use the preceding event side', () => {
    const group = createTimescaleGroup(
        [
            {
                time: 0,
                timescale: 1,
                skipSeconds: 0,
                ease: 0,
                transitionStyle: 0,
                hideNotes: false,
            },
            { time: 1, timescale: 1, skipSeconds: 2, ease: 0, transitionStyle: 0, hideNotes: true },
        ],
        0,
    )
    assert.equal(hideNotesAt(group, 1), true)
    assert.equal(hideNotesAt(group, 1, true), false)
    assert.equal(noteDistance(group, 1, 2), 1)
    assert.equal(noteDistance(group, 1, 2, true), 3)
})

test('finite stages remain absent before their start and visible through their inclusive end', () => {
    const stage: PreviewStage = {
        order: 0,
        drawStartTime: 1,
        drawEndTime: 2,
        masks: [{ time: 1, lane: 0, size: 6, maskNotes: false, ease: 1 }],
        pivots: [],
        styles: [
            {
                time: 1,
                judgeLineColor: 0,
                judgeLineStyle: 0,
                leftBorderStyle: 0,
                rightBorderStyle: 0,
                fullWidth: 0,
                noteAlpha: 1,
                laneAlpha: 1,
                judgeLineAlpha: 1,
                divisionLineAlpha: 1,
                ease: 1,
            },
        ],
        transforms: [],
        hasTransforms: false,
    }
    const source: PreviewChart = { ...chart([]), isDynamicStages: true, stages: [stage] }
    const stageSkin = resolveSkin(() => body)
    assert.ok(capture(source, 1, false, stageSkin).length > 0)
    assert.equal(capture(source, 1, true, stageSkin).length, 0)
    assert.ok(capture(source, 1.5, true, stageSkin).length > 0)
    assert.ok(capture(source, 2, true, stageSkin).length > 0)
    assert.ok(capture(source, 2, false, stageSkin).length > 0)
    assert.equal(capture(source, 2.5, true, stageSkin).length, 0)
})

test('fullscreen connector left limits exclude activation and retain interior and tail frames', () => {
    const head = note(1)
    const tail = note(2)
    const source = chart([head, tail], [{ ...connect(head, tail), fullScreen: true }])
    const connectorCount = (now: number, leftLimit: boolean) =>
        capture(source, now, leftLimit).filter(([sprite]) => sprite === connectorSprite).length
    assert.equal(connectorCount(1, true), 0)
    assert.ok(connectorCount(1, false) > 0)
    assert.ok(connectorCount(1.5, true) > 0)
    assert.ok(connectorCount(1.5, false) > 0)
    assert.ok(connectorCount(2, true) > 0)
    assert.equal(connectorCount(2, false), 0)
})
