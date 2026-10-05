import type { LevelData, LevelDataEntity } from '@sonolus/core'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chcyToUsc, isChcyLevelData } from '../../src/chcy/convert'

// Chart Cyanvas level data in the shape its servers serve (e.g.
// https://cc.milkbun.org/): named entities joined by refs.
const entity = (
    archetype: string,
    data: Record<string, number | { ref: string }>,
    name?: string,
): LevelDataEntity => ({
    ...(name === undefined ? {} : { name }),
    archetype,
    data: Object.entries(data).map(([key, value]) =>
        typeof value === 'number' ? { name: key, value } : { name: key, ref: value.ref },
    ),
})
const ref = (name: string) => ({ ref: name })
const note = (
    archetype: string,
    beat: number,
    lane: number,
    size: number,
    extra = {},
    name?: string,
) => entity(archetype, { '#BEAT': beat, lane, size, timeScaleGroup: ref('tsg:0'), ...extra }, name)

const level = (...entities: LevelDataEntity[]): LevelData => ({
    bgmOffset: 0.25,
    entities: [
        entity('Initialization', {}),
        entity('InputManager', {}),
        entity('Stage', {}),
        // Chart Cyanvas leaves `first` unresolved for a group without changes.
        entity('TimeScaleGroup', { first: ref('tsc:0:0'), length: 0, next: ref('tsg:1') }, 'tsg:0'),
        entity('TimeScaleGroup', { first: ref('tsc:1:0'), length: 2, next: -1 }, 'tsg:1'),
        entity('TimeScaleChange', { '#BEAT': 0, timeScale: 1, next: ref('tsc:1:1') }, 'tsc:1:0'),
        entity('TimeScaleChange', { '#BEAT': 4, timeScale: 0.5, next: -1 }, 'tsc:1:1'),
        entity('#BPM_CHANGE', { '#BEAT': 0, '#BPM': 160 }),
        ...entities,
    ],
})

test('only level data with Chart Cyanvas time scale groups is detected', () => {
    assert.equal(isChcyLevelData(level()), true)
    assert.equal(
        isChcyLevelData({ bgmOffset: 0, entities: [entity('#TIMESCALE_GROUP', {})] }),
        false,
    )
    assert.equal(isChcyLevelData({ usc: { objects: [] } }), false)
    assert.equal(isChcyLevelData(undefined), false)
})

test('time scale groups, BPMs and the offset carry over', () => {
    const usc = chcyToUsc(level())
    assert.equal(usc.offset, 0.25)
    assert.deepEqual(
        usc.objects.filter(({ type }) => type === 'timeScaleGroup' || type === 'bpm'),
        [
            { type: 'timeScaleGroup', changes: [] },
            {
                type: 'timeScaleGroup',
                changes: [
                    { beat: 0, timeScale: 1 },
                    { beat: 4, timeScale: 0.5 },
                ],
            },
            { type: 'bpm', beat: 0, bpm: 160 },
        ],
    )
})

test('single notes map as the Next SEKAI engine reads them', () => {
    const { objects } = chcyToUsc(
        level(
            note('NormalTapNote', 1, -2, 1.5),
            note('CriticalFlickNote', 2, 0, 1, { direction: -1 }),
            note('NormalFlickNote', 3, 0, 1, { direction: 1 }),
            note('CriticalTraceNote', 4, 2, 1),
            note('NormalTraceFlickNote', 5, 2, 1, { direction: 0 }),
            // Omnidirectional; the engine reads it as a normal trace flick up.
            note('NonDirectionalTraceFlickNote', 6, 2, 1),
            note('DamageNote', 7, 3, 2, { timeScaleGroup: ref('tsg:1') }),
        ),
    )
    assert.deepEqual(
        objects.filter(({ type }) => type === 'single' || type === 'damage'),
        [
            {
                type: 'single',
                beat: 1,
                timeScaleGroup: 0,
                lane: -2,
                size: 1.5,
                critical: false,
                trace: false,
            },
            {
                type: 'single',
                beat: 2,
                timeScaleGroup: 0,
                lane: 0,
                size: 1,
                critical: true,
                trace: false,
                direction: 'left',
            },
            {
                type: 'single',
                beat: 3,
                timeScaleGroup: 0,
                lane: 0,
                size: 1,
                critical: false,
                trace: false,
                direction: 'right',
            },
            {
                type: 'single',
                beat: 4,
                timeScaleGroup: 0,
                lane: 2,
                size: 1,
                critical: true,
                trace: true,
            },
            {
                type: 'single',
                beat: 5,
                timeScaleGroup: 0,
                lane: 2,
                size: 1,
                critical: false,
                trace: true,
                direction: 'up',
            },
            {
                type: 'single',
                beat: 6,
                timeScaleGroup: 0,
                lane: 2,
                size: 1,
                critical: false,
                trace: true,
                direction: 'up',
            },
            { type: 'damage', beat: 7, timeScaleGroup: 1, lane: 3, size: 2 },
        ],
    )
})

test('a slide joins its connectors, ticks and attached ticks in beat order', () => {
    const connector = (archetype: string, head: string, tail: string, ease: number, name: string) =>
        entity(
            archetype,
            {
                start: ref('s'),
                end: ref('e'),
                head: ref(head),
                tail: ref(tail),
                ease,
                startType: 0,
            },
            name,
        )
    const { objects } = chcyToUsc(
        level(
            note('CriticalSlideEndFlickNote', 4, 1, 1, { direction: 1, slide: ref('c3') }, 'e'),
            note('NormalSlideStartNote', 0, -1, 1.5, {}, 's'),
            note('CriticalSlideTickNote', 1, 0, 1, {}, 't'),
            note('HiddenSlideTickNote', 2, 1, 1, {}, 'h'),
            entity('CriticalAttachedSlideTickNote', {
                '#BEAT': 1.5,
                attach: ref('c2'),
                timeScaleGroup: ref('tsg:1'),
            }),
            // Combo ticks every half beat; the editor schedules its own.
            entity('IgnoredSlideTickNote', { '#BEAT': 0.5, attach: ref('c1') }),
            connector('CriticalSlideConnector', 's', 't', -1, 'c1'),
            connector('CriticalSlideConnector', 't', 'h', 2, 'c2'),
            connector('CriticalSlideConnector', 'h', 'e', 0, 'c3'),
            entity('SimLine', { a: ref('s'), b: ref('t') }),
        ),
    )
    assert.deepEqual(
        objects.filter(({ type }) => type === 'slide'),
        [
            {
                type: 'slide',
                critical: true,
                connections: [
                    {
                        type: 'start',
                        beat: 0,
                        timeScaleGroup: 0,
                        lane: -1,
                        size: 1.5,
                        critical: false,
                        ease: 'out',
                        judgeType: 'normal',
                    },
                    {
                        type: 'tick',
                        beat: 1,
                        timeScaleGroup: 0,
                        lane: 0,
                        size: 1,
                        critical: true,
                        ease: 'inout',
                    },
                    { type: 'attach', beat: 1.5, critical: true, timeScaleGroup: 1 },
                    { type: 'tick', beat: 2, timeScaleGroup: 0, lane: 1, size: 1, ease: 'linear' },
                    {
                        type: 'end',
                        beat: 4,
                        timeScaleGroup: 0,
                        lane: 1,
                        size: 1,
                        critical: true,
                        direction: 'right',
                        judgeType: 'normal',
                    },
                ],
            },
        ],
    )
    assert.equal(objects.filter(({ type }) => type === 'single').length, 0)
})

test('hidden and trace slide ends keep their judgment', () => {
    const { objects } = chcyToUsc(
        level(
            note('HiddenSlideStartNote', 0, 0, 1, {}, 'a'),
            note('NormalTraceSlideEndNote', 1, 0, 1, { slide: ref('c') }, 'b'),
            entity(
                'NormalSlideConnector',
                { start: ref('a'), end: ref('b'), head: ref('a'), tail: ref('b'), ease: 1 },
                'c',
            ),
            note('CriticalTraceSlideStartNote', 2, 0, 1, {}, 'x'),
            note('HiddenSlideTickNote', 3, 0, 1, { slide: ref('z') }, 'y'),
            entity(
                'CriticalSlideConnector',
                { start: ref('x'), end: ref('y'), head: ref('x'), tail: ref('y'), ease: -2 },
                'z',
            ),
        ),
    )
    const slides = objects.filter(({ type }) => type === 'slide')
    assert.deepEqual(
        slides.map((slide) => slide.type === 'slide' && slide.connections),
        [
            [
                {
                    type: 'start',
                    beat: 0,
                    timeScaleGroup: 0,
                    lane: 0,
                    size: 1,
                    critical: false,
                    ease: 'in',
                    judgeType: 'none',
                },
                {
                    type: 'end',
                    beat: 1,
                    timeScaleGroup: 0,
                    lane: 0,
                    size: 1,
                    critical: false,
                    judgeType: 'trace',
                },
            ],
            [
                {
                    type: 'start',
                    beat: 2,
                    timeScaleGroup: 0,
                    lane: 0,
                    size: 1,
                    critical: true,
                    ease: 'outin',
                    judgeType: 'trace',
                },
                {
                    type: 'end',
                    beat: 3,
                    timeScaleGroup: 0,
                    lane: 0,
                    size: 1,
                    critical: true,
                    judgeType: 'none',
                },
            ],
        ],
    )
})

test('slide notes without connectors are kept as the notes they judge as', () => {
    const { objects } = chcyToUsc(
        level(
            note('CriticalSlideStartNote', 1, 0, 1),
            note('NormalSlideEndFlickNote', 2, 0, 1, { direction: -1 }),
            note('HiddenSlideTickNote', 3, 0, 1),
        ),
    )
    assert.deepEqual(
        objects.filter(({ type }) => type === 'single'),
        [
            {
                type: 'single',
                beat: 1,
                timeScaleGroup: 0,
                lane: 0,
                size: 1,
                critical: true,
                trace: false,
            },
            {
                type: 'single',
                beat: 2,
                timeScaleGroup: 0,
                lane: 0,
                size: 1,
                critical: false,
                trace: false,
                direction: 'left',
            },
        ],
    )
})

test('guide pieces sharing a start and end chain into one guide', () => {
    const piece = (
        head: [number, number],
        tail: [number, number],
        ease: number,
        fade = 0,
        color = 2,
    ) =>
        entity('Guide', {
            color,
            fade,
            ease,
            startBeat: 0,
            startLane: 0,
            startSize: 1,
            startTimeScaleGroup: ref('tsg:0'),
            headBeat: head[0],
            headLane: head[1],
            headSize: 1,
            headTimeScaleGroup: ref('tsg:0'),
            tailBeat: tail[0],
            tailLane: tail[1],
            tailSize: 1,
            tailTimeScaleGroup: ref('tsg:0'),
            endBeat: 2,
            endLane: 4,
            endSize: 1,
            endTimeScaleGroup: ref('tsg:0'),
        })
    const { objects } = chcyToUsc(
        level(
            piece([1, 2], [2, 4], 1),
            piece([0, 0], [1, 2], -1),
            // Same points but its own fade: a separate guide.
            piece([0, 0], [2, 4], 0, 2, 5),
        ),
    )
    assert.deepEqual(
        objects.filter(({ type }) => type === 'guide'),
        [
            {
                type: 'guide',
                color: 'green',
                fade: 'out',
                midpoints: [
                    { beat: 0, timeScaleGroup: 0, lane: 0, size: 1, ease: 'out' },
                    { beat: 1, timeScaleGroup: 0, lane: 2, size: 1, ease: 'in' },
                    { beat: 2, timeScaleGroup: 0, lane: 4, size: 1, ease: 'linear' },
                ],
            },
            {
                type: 'guide',
                color: 'purple',
                fade: 'in',
                midpoints: [
                    { beat: 0, timeScaleGroup: 0, lane: 0, size: 1, ease: 'linear' },
                    { beat: 2, timeScaleGroup: 0, lane: 4, size: 1, ease: 'linear' },
                ],
            },
        ],
    )
})

test('time scale chains that loop or point elsewhere end', () => {
    const { objects } = chcyToUsc({
        bgmOffset: 0,
        entities: [
            entity('TimeScaleGroup', { first: ref('a'), length: 2 }, 'g'),
            entity('TimeScaleChange', { '#BEAT': 0, timeScale: 2, next: ref('b') }, 'a'),
            entity('TimeScaleChange', { '#BEAT': 1, timeScale: 3, next: ref('a') }, 'b'),
        ],
    })
    assert.deepEqual(objects, [
        {
            type: 'timeScaleGroup',
            changes: [
                { beat: 0, timeScale: 2 },
                { beat: 1, timeScale: 3 },
            ],
        },
    ])
})
