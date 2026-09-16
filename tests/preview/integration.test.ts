import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import type { TimeScaleEase } from '../../src/chart/timeScale'
import { buildPreviewChart } from '../../src/preview/engine/chart'
import type { Quad } from '../../src/preview/engine/math'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import type { PreviewRenderer } from '../../src/preview/gl'
import { resolveSkin, type Sprite } from '../../src/preview/skin'
import { createState } from '../../src/state'

const groupId = 1 as GroupId
const stageId = 1 as StageId
const noteSpeed = 1

const note = (overrides: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId,
    beat: 4,
    noteType: 'default',
    isAttached: false,
    left: -1,
    size: 2,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideColor: 'neutral',
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...overrides,
})

const chart = (overrides: Partial<Chart> = {}): Chart => ({
    initialLife: 1000,
    isDynamicStages: true,
    bpms: [{ beat: 0, bpm: 120 }],
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
    slides: [[note()]],
    ...overrides,
})

const preview = (source: Chart) => buildPreviewChart(createState(source, 0), noteSpeed)

const noteSprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
const skin = resolveSkin((name) => (name === 'Sekai Normal Note Middle' ? noteSprite : undefined))

const renderSprite = (
    source: Chart,
    now: number,
    renderedSkin = skin,
    renderedSprite = noteSprite,
    showEffects = false,
): Quad[] => {
    const quads: Quad[] = []
    let beginCount = 0
    let flushCount = 0
    const renderer: PreviewRenderer = {
        maxViewportSize: { width: 1920, height: 1080 },
        setTexture() {},
        begin() {
            beginCount++
        },
        draw(sprite, quad, _z, alpha) {
            if (sprite === renderedSprite && alpha > 0) quads.push(quad)
        },
        flush() {
            flushCount++
        },
        isContextLost: () => false,
        dispose() {},
    }

    renderPreviewFrame(
        renderer,
        renderedSkin,
        preview(source),
        now,
        1920,
        1080,
        1920,
        1080,
        noteSpeed,
        showEffects,
    )
    assert.equal(beginCount, 1)
    assert.equal(flushCount, 1)
    for (const quad of quads) {
        for (const point of Object.values(quad)) {
            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
        }
    }
    return quads
}

const renderNotes = (source: Chart, now = 0.75) => renderSprite(source, now)

test('chart compilation preserves all time scale eases and transition styles', () => {
    const eases: TimeScaleEase[] = ['none', 'linear', 'inQuad', 'outQuad', 'inOutQuad', 'outInQuad']
    const compiled = preview(
        chart({
            groups: new Map([[groupId, { name: 'Forced', forceNoteSpeed: 7 }]]),
            timeScales: eases.map((timeScaleEase, index) => ({
                groupId,
                beat: index * 2,
                editorLane: 0,
                timeScale: index + 1,
                skip: 0.5,
                timeScaleEase,
                timeScaleTransition: index % 2 ? 'scroll' : 'timeScale',
                hideNotes: index % 2 === 1,
            })),
        }),
    )
    assert.equal(compiled.groups.length, 1)
    assert.equal(compiled.groups[0]?.forceNoteSpeed, 7)
    assert.deepEqual(
        compiled.groups[0]?.changes,
        eases.map((_ease, index) => ({
            time: index,
            timescale: index + 1,
            skipSeconds: 0.25,
            ease: index,
            transitionStyle: index % 2,
            hideNotes: index % 2 === 1,
        })),
    )
    assert.ok(compiled.notes.every((item) => Number.isFinite(item.targetScaledTime)))
})

test('chart compilation carries note masks and stage elevation through editor state', () => {
    const compiled = preview(
        chart({
            stageMaskEvents: [
                {
                    stageId,
                    beat: 2,
                    maskLeft: -3,
                    maskSize: 4,
                    isMaskNotes: true,
                    eventEase: 'out',
                },
            ],
            stageTransformEvents: [
                {
                    stageId,
                    beat: 2,
                    rotation: 90,
                    xTranslation: 2,
                    yTranslation: -3,
                    elevation: 1.5,
                    anchor: 'center',
                    eventEase: 'inOut',
                },
            ],
        }),
    )
    assert.deepEqual(compiled.stages[0]?.masks, [
        { time: 1, lane: -1, size: 2, maskNotes: true, ease: 3 },
    ])
    assert.deepEqual(compiled.stages[0]?.transforms, [
        {
            time: 1,
            rotate: Math.PI / 2,
            xLaneTranslate: 2,
            yLaneTranslate: -3,
            elevation: 1.5,
            centerWeight: 1,
            ease: 4,
        },
    ])
    assert.equal(compiled.hasStageTransforms, true)
    assert.equal(compiled.notes[0]?.stageIndex, 0)
})

test('attached note width follows elapsed time across a BPM change', () => {
    const compiled = preview(
        chart({
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 2, bpm: 60 },
            ],
            slides: [
                [
                    note({ beat: 0, size: 2 }),
                    note({ beat: 2, isAttached: true }),
                    note({ beat: 4, size: 6 }),
                ],
            ],
        }),
    )
    const attached = compiled.notes[1]!
    assert.equal(attached.isAttached, true)
    assert.equal(attached.attachHead?.targetTime, 0)
    assert.equal(attached.targetTime, 1)
    assert.equal(attached.attachTail?.targetTime, 3)
    // The note is one third of the way through the slide in seconds,
    // even though the editor places it halfway through the beats.
    assert.ok(Math.abs(attached.size - 5 / 3) < 1e-12)
})

test('simultaneous lines require positive width at both ends even without masks', () => {
    const simSprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
    const simSkin = { ...skin, simLine: simSprite }
    const source = chart({ slides: [[note({ left: -3 })], [note({ left: 2 })]] })
    assert.equal(preview(source).simLines.length, 1)
    assert.equal(renderSprite(source, 0.75, simSkin, simSprite).length, 1)

    source.slides[0]![0]!.size = 0
    assert.equal(renderSprite(source, 0.75, simSkin, simSprite).length, 0)
    source.slides[0]![0]!.size = 2
    source.slides[1]![0]!.size = 0
    assert.equal(renderSprite(source, 0.75, simSkin, simSprite).length, 0)
})

test('rendering clips an overlapping note and hides a note outside the enabled mask', () => {
    const source = chart({
        stageMaskEvents: [
            { stageId, beat: 0, maskLeft: -1, maskSize: 2, isMaskNotes: true, eventEase: 'none' },
        ],
        slides: [[note({ left: -2, size: 4 })]],
    })
    const clipped = renderNotes(source)
    const narrow = renderNotes(chart())
    assert.equal(clipped.length, 1)
    assert.deepEqual(clipped, narrow)
    assert.notDeepEqual(clipped, renderNotes(chart({ slides: [[note({ left: -2, size: 4 })]] })))

    source.slides = [[note({ left: 2, size: 2 })]]
    assert.equal(renderNotes(source).length, 0)
    source.stageMaskEvents[0]!.isMaskNotes = false
    assert.equal(renderNotes(source).length, 1)
})

test('rendered elevation changes note geometry and has no effect with a flat stage', () => {
    const source = chart({
        stageTransformEvents: [
            {
                stageId,
                beat: 0,
                rotation: 0,
                xTranslation: 0,
                yTranslation: 0,
                elevation: 1,
                anchor: 'default',
                eventEase: 'none',
            },
        ],
    })
    const raised = renderNotes(source)
    const ground = renderNotes(chart())
    assert.equal(raised.length, 1)
    assert.equal(ground.length, 1)
    assert.notDeepEqual(raised, ground)

    source.cameraEvents = [
        {
            beat: 0,
            cameraLeft: -6,
            cameraSize: 12,
            cameraZoom: 1,
            cameraZoomTargetLane: 0,
            cameraZoomTargetY: 0,
            cameraZoomVerticalAlign: 'default',
            cameraRotation: 0,
            cameraStageTilt: 0,
            eventEase: 'none',
        },
    ]
    assert.deepEqual(renderNotes(source), renderNotes({ ...source, stageTransformEvents: [] }))
})

test('rendering uses scroll transition distance across the next time scale change', () => {
    const source = chart({
        slides: [[note({ beat: 5 })]],
        timeScales: [
            {
                groupId,
                beat: 0,
                editorLane: 0,
                timeScale: 1,
                skip: 0,
                timeScaleEase: 'linear',
                timeScaleTransition: 'scroll',
                hideNotes: false,
            },
            {
                groupId,
                beat: 4,
                editorLane: 0,
                timeScale: 3,
                skip: 0,
                timeScaleEase: 'none',
                timeScaleTransition: 'timeScale',
                hideNotes: false,
            },
        ],
    })
    const scrolling = renderNotes(source, 1)
    const constant = renderNotes(
        {
            ...source,
            timeScales: [{ ...source.timeScales[0]!, timeScale: 2, timeScaleEase: 'none' }],
        },
        1,
    )
    // At t=1 the scroll scale is 2. The distance to t=2.5 is
    // 2 * (2 - 1) + (2 / 3) * 3 * (2.5 - 2) = 3.
    assert.equal(scrolling.length, 1)
    assert.deepEqual(scrolling, constant)

    source.timeScales[0]!.timeScaleTransition = 'timeScale'
    assert.notDeepEqual(renderNotes(source, 1), scrolling)
})

for (const fixture of [
    {
        name: 'note slot glow',
        spriteName: 'Sekai Slot Glow Normal',
        slides: [[note()]],
        now: 2.1,
    },
    {
        name: 'active connector slot glow',
        spriteName: 'Sekai Normal Slide Slot Glow',
        slides: [[note({ beat: 0 }), note({ beat: 8 })]],
        now: 1,
    },
]) {
    test(`elevation moves ${fixture.name} without flattening its height`, () => {
        const glowSprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
        const glowSkin = resolveSkin((name) =>
            name === fixture.spriteName ? glowSprite : undefined,
        )
        const source = chart({
            slides: fixture.slides,
            stageTransformEvents: [
                {
                    stageId,
                    beat: 0,
                    rotation: 30,
                    xTranslation: 0,
                    yTranslation: 0,
                    elevation: 1,
                    anchor: 'default',
                    eventEase: 'none',
                },
            ],
        })
        const raised = renderSprite(source, fixture.now, glowSkin, glowSprite, true)
        source.stageTransformEvents[0]!.elevation = 0
        const ground = renderSprite(source, fixture.now, glowSkin, glowSprite, true)
        assert.equal(raised.length, 1)
        assert.equal(ground.length, 1)
        assert.notDeepEqual(raised, ground, 'glow follows its elevated stage')

        const edgeLength = (quad: Quad, from: keyof Quad, to: keyof Quad) =>
            Math.hypot(quad[to].x - quad[from].x, quad[to].y - quad[from].y)
        for (const [from, to] of [
            ['bl', 'tl'],
            ['br', 'tr'],
            ['bl', 'br'],
        ] as const) {
            const actual = edgeLength(raised[0]!, from, to)
            const expected = edgeLength(ground[0]!, from, to)
            assert.ok(expected > 0)
            assert.ok(Math.abs(actual - expected) < 1e-12, `${from}-${to} retains its length`)
        }
    })
}
