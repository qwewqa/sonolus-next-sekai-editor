import assert from 'node:assert/strict'
import test from 'node:test'
import { getFrameIndex, latestVisibleTarget } from '../../src/preview/engine/frameIndex'
import { FlickDirection } from '../../src/preview/engine/layout'
import {
    ConnectorKind,
    NoteKind,
    type PreviewChart,
    type PreviewNote,
} from '../../src/preview/engine/model'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import { createTimeIndex, queryTimeIndex } from '../../src/preview/engine/timeIndex'
import { createTimescaleGroup, type TimescaleChange } from '../../src/preview/engine/timescale'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin } from '../../src/preview/skin'

const note = (targetTime: number, overrides: Partial<PreviewNote> = {}): PreviewNote => ({
    kind: NoteKind.tap,
    isCritical: false,
    isFake: false,
    targetTime,
    lane: 0,
    size: 1,
    direction: FlickDirection.upOmni,
    groupIndex: 0,
    stageIndex: -1,
    isAttached: false,
    connectorEase: 1,
    targetScaledTime: targetTime,
    ...overrides,
})

const chart = (overrides: Partial<PreviewChart> = {}): PreviewChart => ({
    isDynamicStages: false,
    notes: [],
    connectors: [],
    slides: [],
    simLines: [],
    cameras: [],
    groups: [createTimescaleGroup([], 0)],
    stages: [],
    hasStageTransforms: false,
    ...overrides,
})

test('time index matches interval scans after arbitrary seeks and preserves source indices', () => {
    const items = Array.from({ length: 300 }, (_, i) => {
        const start = ((i * 41) % 101) - 20
        return { start, end: start + (i % 31) + 1 }
    })
    items.push({ start: -100, end: 1000 })
    const index = createTimeIndex(
        items,
        (item) => item.start,
        (item) => item.end,
    )
    for (const now of [0, 80, -50, 25, 1000, 2, -100]) {
        for (const lookahead of [0, 4, Infinity]) {
            const expected = items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.start <= now + lookahead && item.end > now)
            assert.deepEqual(
                queryTimeIndex(index, now, now + lookahead).map(({ item, index }) => ({
                    item,
                    index,
                })),
                expected,
            )
        }
    }
    assert.deepEqual(
        queryTimeIndex(
            createTimeIndex(
                [],
                () => 0,
                () => 0,
            ),
            0,
            0,
        ),
        [],
    )
})

test('a long hold does not make time-index queries scan the full chart', () => {
    const items = Array.from({ length: 100_000 }, (_, i) => ({ start: i, end: i + 1 }))
    items[0]!.end = 100_000
    const index = createTimeIndex(
        items,
        (item) => item.start,
        (item) => item.end,
    )
    let reads = 0
    index.entries = new Proxy(index.entries, {
        get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) reads++
            return Reflect.get(target, property, receiver)
        },
    })
    assert.deepEqual(
        queryTimeIndex(index, 50_000, 50_004).map(({ index }) => index),
        [0, 50_000, 50_001, 50_002, 50_003, 50_004],
    )
    assert.ok(reads < 100, `Expected a bounded query, read ${reads} entries`)
})

test('visibility candidates include attachment endpoints, long connectors and through-line tails', () => {
    const head = note(1)
    const tail = note(100)
    const attached = note(50, { isAttached: true, attachHead: head, attachTail: tail })
    const source = chart({
        notes: [head, attached, tail],
        connectors: [
            {
                kind: ConnectorKind.guideNeutral,
                ease: 1,
                head,
                tail,
                segmentHead: head,
                segmentTail: tail,
                segmentHeadAlpha: 1,
                segmentTailAlpha: 1,
                layer: 0,
                throughJudgeLine: true,
                fullScreen: true,
            },
        ],
        simLines: [{ left: attached, right: note(50) }],
        slides: [
            {
                activeHead: head,
                activeTail: tail,
                kind: ConnectorKind.activeNormal,
                connectors: [],
            },
        ],
    })
    const index = getFrameIndex(source)
    assert.equal(getFrameIndex(source), index)
    assert.deepEqual(
        queryTimeIndex(index.notes, 2, 6).map(({ item }) => item),
        [attached],
    )
    assert.equal(queryTimeIndex(index.connectors, 2, 6).length, 1)
    assert.equal(queryTimeIndex(index.connectors, 104.99, 109).length, 1)
    assert.equal(queryTimeIndex(index.connectors, 105, 109).length, 0)
    assert.equal(queryTimeIndex(index.simLines, 2, 6).length, 1)
    assert.equal(queryTimeIndex(index.slides, 100.5, 100.5).length, 1)
    assert.equal(queryTimeIndex(index.slides, 100.6, 100.6).length, 0)
    assert.deepEqual(
        queryTimeIndex(index.effects, 50, 50).map(({ index }) => index),
        [1],
    )
    assert.equal(queryTimeIndex(index.effects, 51, 51).length, 0)
})

test('lookahead includes slow speeds and stage offsets and falls back for nonmonotonic distances', () => {
    const change: TimescaleChange = {
        time: 0,
        timescale: 0.25,
        skipSeconds: 0,
        ease: 1,
        transitionStyle: 0,
        hideNotes: false,
    }
    const index = getFrameIndex(chart({ groups: [createTimescaleGroup([change], 1)] }))
    assert.equal(index.minimumTimescale, 0.25)
    assert.ok(latestVisibleTarget(10, index.minimumTimescale, 4, 0, -2) >= 58)
    for (const overrides of [
        { timescale: 0 },
        { timescale: -1 },
        { skipSeconds: -1 },
        { transitionStyle: 1 as const },
    ]) {
        const special = getFrameIndex(
            chart({ groups: [createTimescaleGroup([{ ...change, ...overrides }], 0)] }),
        )
        assert.equal(latestVisibleTarget(10, special.minimumTimescale, 4, 0, 0), Infinity)
    }
    assert.equal(latestVisibleTarget(0, 1, 1e21, 0, 0), Infinity)
})

test('culled frames match full future traversal with eased speeds, offsets, attachments and effects', () => {
    const notes = Array.from({ length: 200 }, (_, i) =>
        note(i / 2, {
            lane: (i % 10) - 5,
            groupIndex: i % 2,
            stageIndex: i % 2,
        }),
    )
    for (let i = 5; i + 15 < notes.length; i += 20) {
        Object.assign(notes[i]!, {
            isAttached: true,
            attachHead: notes[i - 5],
            attachTail: notes[i + 15],
        })
    }
    const source = chart({
        isDynamicStages: true,
        notes,
        groups: [
            createTimescaleGroup([], 0),
            createTimescaleGroup(
                [
                    {
                        time: 0,
                        timescale: 0.25,
                        skipSeconds: 0,
                        ease: 4,
                        transitionStyle: 0,
                        hideNotes: false,
                    },
                    {
                        time: 80,
                        timescale: 2,
                        skipSeconds: 1,
                        ease: 0,
                        transitionStyle: 0,
                        hideNotes: false,
                    },
                ],
                3,
            ),
        ],
        stages: [-2, 0.5].map((yOffset, order) => ({
            order,
            drawStartTime: -Infinity,
            drawEndTime: Infinity,
            masks: [],
            pivots: [{ time: 0, lane: 0, divisionSize: 1, divisionParity: 0, yOffset, ease: 0 }],
            styles: [],
            transforms: [],
            hasTransforms: false,
        })),
        connectors: Array.from({ length: 9 }, (_, i) => ({
            kind: ConnectorKind.guideNeutral,
            ease: 1,
            head: notes[i * 20]!,
            tail: notes[i * 20 + 19]!,
            segmentHead: notes[i * 20]!,
            segmentTail: notes[i * 20 + 19]!,
            segmentHeadAlpha: 1,
            segmentTailAlpha: 1,
            layer: 0,
            throughJudgeLine: i % 2 === 0,
            fullScreen: i % 3 === 0,
        })),
        simLines: Array.from({ length: 100 }, (_, i) => ({
            left: notes[i * 2]!,
            right: notes[i * 2 + 1]!,
        })),
    })
    const sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const skin = resolveSkin(() => sprite)
    let draws: unknown[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {},
        draw(sprite, quad, z, alpha) {
            if (sprite && alpha > 0) draws.push({ quad, z, alpha })
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    const index = getFrameIndex(source)
    const minimumTimescale = index.minimumTimescale
    for (const now of [-2, 0, 0.5, 20, 70, 100, 4]) {
        for (const speed of [1, 7, 11]) {
            draws = []
            index.minimumTimescale = minimumTimescale
            renderPreviewFrame(renderer, skin, source, now, 1920, 1080, 1920, 1080, speed, true)
            const culled = draws
            draws = []
            index.minimumTimescale = 0
            renderPreviewFrame(renderer, skin, source, now, 1920, 1080, 1920, 1080, speed, true)
            assert.deepEqual(culled, draws, `Frame at ${now}, speed ${speed}`)
        }
    }
})
