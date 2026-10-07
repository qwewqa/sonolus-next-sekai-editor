import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chart } from '../../src/chart'
import type { CameraEventObject } from '../../src/chart/events/camera'
import type { StageMaskEventObject } from '../../src/chart/events/stage/mask'
import type { StagePivotEventObject } from '../../src/chart/events/stage/pivot'
import type { StageStyleEventObject } from '../../src/chart/events/stage/style'
import type { StageTransformEventObject } from '../../src/chart/events/stage/transform'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import { buildPreviewChart, createPreviewChartBuilder } from '../../src/preview/engine/chart'
import { getFrameIndex } from '../../src/preview/engine/frameIndex'
import {
    computeHitbox,
    computeNoteHitbox,
    computeSlideInputBounds,
    createGeometryContext,
    damageTickInputStartBeat,
    getHiddenTickHitboxes,
    getInputWindow,
    peekHitboxIndex,
    type HitboxNote,
} from '../../src/preview/engine/hitbox'
import {
    FIELD_B_FACTOR,
    FIELD_W_FACTOR,
    blendStageTransform,
    computeStageTransform,
    createViewport,
    identityStageTransform,
    stageTransformToAffine,
} from '../../src/preview/engine/layout'
import { EaseType, type Quad, type Vec } from '../../src/preview/engine/math'
import { NoteKind, type PreviewChart, type PreviewNote } from '../../src/preview/engine/model'
import { renderPreviewFrame } from '../../src/preview/engine/render'
import type { PreviewRenderer, ZKey } from '../../src/preview/gl'
import { resolveParticle, type PreviewParticle } from '../../src/preview/particle'
import { resolveSkin, type Sprite } from '../../src/preview/skin'
import { createState, type State } from '../../src/state'

const stageId = 1 as StageId
const otherStageId = 2 as StageId
const groupId = 1 as GroupId
const noteSpeed = 10
const width = 1920
const height = 1080
const viewport = createViewport(width, height)
// With the default camera, one lane spans this many screen units at the judge line.
const laneW = viewport.fieldW * FIELD_W_FACTOR
const judgeY = viewport.fieldH * FIELD_B_FACTOR

const note = (beat: number, overrides: Partial<NoteObject> = {}): NoteObject => ({
    groupId,
    stageId,
    beat,
    noteType: 'default',
    isAttached: false,
    left: -1,
    size: 2,
    isCritical: false,
    flickDirection: 'none',
    isFake: false,
    noteStyle: 'default',
    connectorStyle: 'default',
    sfx: 'default',
    isConnectorSeparator: false,
    connectorType: 'active',
    connectorEase: 'linear',
    connectorIsFake: false,
    connectorActiveIsCritical: false,
    connectorGuideAlpha: 1,
    connectorLayer: 'top',
    connectorIsPassThrough: false,
    connectorPresentation: 'default',
    ...overrides,
})

// One beat is one second.
const chart = (slides: NoteObject[][], overrides: Partial<Chart> = {}): Chart => ({
    initialLife: 1000,
    isDynamicStages: false,
    bpms: [{ beat: 0, bpm: 60 }],
    groups: new Map([[groupId, { name: 'Default' }]]),
    stages: new Map([
        [stageId, { name: 'A', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' }],
        [
            otherStageId,
            { name: 'B', isFromStart: true, isUntilEnd: true, generateSimLines: 'global' },
        ],
    ]),
    cameraEvents: [],
    stageMaskEvents: [],
    stagePivotEvents: [],
    stageStyleEvents: [],
    stageTransformEvents: [],
    timeScales: [],
    slides,
    ...overrides,
})

const preview = (source: Chart) => buildPreviewChart(createState(source, 0), noteSpeed)

const sprites = new Map<string, Sprite>()
const skin = resolveSkin((name) => {
    let sprite = sprites.get(name)
    if (!sprite) {
        sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
        sprites.set(name, sprite)
    }
    return sprite
})
const guideNames = ['neutral', 'red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'black']
const spriteName = (sprite: Sprite | undefined) => {
    const guide = skin.guides.indexOf(sprite)
    if (guide >= 0) return guideNames[guide]
    return [...sprites].find(([, value]) => value === sprite)?.[0]
}

type Draw = { sprite?: string; quad: Quad; z: ZKey; a: number }

const render = (
    source: PreviewChart,
    now: number,
    {
        leftLimit = true,
        showHitboxes = true,
        showEffects = false,
        particle,
    }: {
        leftLimit?: boolean
        showHitboxes?: boolean
        showEffects?: boolean
        particle?: PreviewParticle
    } = {},
): Draw[] => {
    const draws: Draw[] = []
    const renderer: PreviewRenderer = {
        maxViewportSize: { width, height },
        setTexture() {},
        begin() {},
        draw(sprite, quad, z, a) {
            if (sprite && a > 0) draws.push({ sprite: spriteName(sprite), quad, z, a })
        },
        flush() {},
        isContextLost: () => false,
        dispose() {},
    }
    renderPreviewFrame(
        renderer,
        skin,
        source,
        now,
        width,
        height,
        width,
        height,
        noteSpeed,
        showEffects,
        particle,
        undefined,
        leftLimit,
        showHitboxes,
    )
    return draws
}

const overlay = (draws: Draw[]) => draws.filter(({ z }) => z[0] === 24)
const bounds = (draws: Draw[], sprite = 'blue') =>
    overlay(draws).filter((draw) => draw.z[2] === 0 && draw.sprite === sprite)

const close = (actual: number, expected: number, message?: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} != ${expected}`)
const closeVec = (actual: Vec, expected: Vec, message?: string) => {
    close(actual.x, expected.x, message)
    close(actual.y, expected.y, message)
}
const closeQuad = (actual: Quad, expected: Quad) => {
    for (const key of ['bl', 'br', 'tl', 'tr'] as const) closeVec(actual[key], expected[key], key)
}

const scoredHitbox = (source: PreviewChart, predicate: (note: PreviewNote) => boolean) => {
    const found = source.notes.find(predicate)
    assert.ok(found)
    const drawStart =
        found.kind === NoteKind.damage
            ? found.targetTime - 0.05
            : found.targetTime + getInputWindow(found.kind)[0]
    const hitbox: HitboxNote = {
        note: found,
        drawStart,
        target: found.targetTime,
        leniency: found.kind === NoteKind.damage ? 0 : 1,
    }
    return computeNoteHitbox(createGeometryContext(source, viewport, found.targetTime), hitbox)
}

// Corners from sekai/lib/layout.py compute_hitbox for an unrotated, untilted judge line.
const expectedBounds = (l: number, r: number, leniency: number, halfLanes: number): Quad => ({
    bl: { x: (l - leniency) * laneW, y: judgeY - halfLanes * laneW },
    br: { x: (r + leniency) * laneW, y: judgeY - halfLanes * laneW },
    tl: { x: (l - leniency) * laneW, y: judgeY + halfLanes * laneW },
    tr: { x: (r + leniency) * laneW, y: judgeY + halfLanes * laneW },
})

test('note bounds use the engine leniency and static or dynamic stage height', () => {
    // A lane-0, half-width-1 note: one lane of leniency on each side, ten lanes
    // tall on a static stage and five on dynamic stages.
    const tap = preview(chart([[note(2)]]))
    const hitbox = scoredHitbox(tap, () => true)
    closeQuad(hitbox.bounds, expectedBounds(-1, 1, 1, 5))
    closeVec(hitbox.target.l, { x: -laneW, y: judgeY })
    closeVec(hitbox.target.r, { x: laneW, y: judgeY })

    const dynamic = preview(chart([[note(2)]], { isDynamicStages: true }))
    closeQuad(scoredHitbox(dynamic, () => true).bounds, expectedBounds(-1, 1, 1, 2.5))

    // Damage notes have no leniency.
    const damage = preview(chart([[note(2, { noteType: 'damage' })]]))
    closeQuad(scoredHitbox(damage, () => true).bounds, expectedBounds(-1, 1, 0, 5))

    // Sanity check the formula against the generic implementation.
    const direct = computeHitbox(
        false,
        createGeometryContext(tap, viewport, 2).layout,
        0,
        1,
        1,
        0,
        stageTransformToAffine(identityStageTransform),
    )
    closeQuad(direct.bounds, hitbox.bounds)
})

test('the overlay draws outlines, diagonals, targets and markers above everything', () => {
    const draws = render(preview(chart([[note(2)]])), 2)
    const hitbox = overlay(draws)
    // Six lines of bounds, the target triangle, apex, three marker parts and two dots.
    assert.deepEqual(
        hitbox.map(({ sprite, z }) => [sprite, z[2]]),
        [
            ...Array.from({ length: 6 }, () => ['blue', 0]),
            ['red', 1],
            ['red', 1],
            ['red', 2],
            ['red', 3],
            ['red', 3],
            ['red', 3],
            ['black', 4],
            ['black', 4],
        ],
    )
    const top = Math.max(...draws.filter(({ z }) => z[0] !== 24).map(({ z }) => z[0] ?? 0))
    assert.ok(top < 24)
    assert.ok(hitbox.every(({ z, a }) => z[1] === 0 && z[3] === 0 && a === 1))

    // Traces and ticks have no target marker.
    const trace = overlay(render(preview(chart([[note(2, { noteType: 'trace' })]])), 2))
    assert.deepEqual(new Set(trace.map(({ sprite }) => sprite)), new Set(['blue']))
})

test('note input windows appear with the engine bad windows and vanish when autoplay hits', () => {
    assert.deepEqual(getInputWindow(NoteKind.tap), [-7.5 / 60, 7.5 / 60])
    assert.deepEqual(getInputWindow(NoteKind.flick), [-7.5 / 60, 8.5 / 60])
    assert.deepEqual(getInputWindow(NoteKind.trace), [-5 / 60, 5 / 60])
    assert.deepEqual(getInputWindow(NoteKind.traceFlick), [-6.5 / 60, 7.5 / 60])
    assert.deepEqual(getInputWindow(NoteKind.tailRelease), [-7.5 / 60, 8.5 / 60])
    assert.deepEqual(getInputWindow(NoteKind.tailTrace), [-6.5 / 60, 8 / 60])
    assert.deepEqual(getInputWindow(NoteKind.tick), [-5 / 60, 5 / 60])

    const tap = preview(chart([[note(2)]]))
    const start = 2 - 7.5 / 60
    const at = (now: number, leftLimit: boolean) => bounds(render(tap, now, { leftLimit }))
    assert.equal(at(start - 1e-3, false).length, 0)
    // The alpha follows hitbox_draw_alpha.
    close(at(start + 7.5 / 120, false)[0]?.a ?? 0, 0.5)
    // Autoplay hits the note at its target time while playing...
    assert.equal(at(2, false).length, 0)
    // ...and a paused frame at the target shows the instant before, fully opaque.
    assert.deepEqual(
        at(2, true).map(({ a }) => a),
        Array(6).fill(1),
    )
    assert.equal(at(2 + 1e-3, true).length, 0)

    // Damage notes show neutral bounds until the last frame before their check.
    const damage = preview(chart([[note(2, { noteType: 'damage' })]]))
    assert.equal(bounds(render(damage, 2 - 0.051, { leftLimit: false }), 'neutral').length, 0)
    assert.equal(bounds(render(damage, 2 - 0.03, { leftLimit: false }), 'neutral').length, 6)
    assert.equal(bounds(render(damage, 2 - 0.01, { leftLimit: false }), 'green').length, 6)
    assert.equal(bounds(render(damage, 2, { leftLimit: false }), 'green').length, 0)
    assert.equal(bounds(render(damage, 2, { leftLimit: true }), 'green').length, 6)
})

test('fake notes, anchors and inactive connectors have no hitbox, but hidden notes do', () => {
    const inert = preview(
        chart([
            [note(2, { isFake: true })],
            [note(2, { noteType: 'anchor' })],
            [note(1, { connectorType: 'guide', noteType: 'anchor' }), note(3)],
            [note(1, { connectorIsFake: true, isFake: true }), note(3, { isFake: true })],
        ]),
    )
    assert.equal(overlay(render(inert, 2)).length, 0)

    // Note opacity and hidden groups only affect the visuals; input remains.
    for (const hiding of [
        { stageStyleEvents: [style(0, { noteAlpha: 0 })] },
        {
            timeScales: [
                {
                    groupId,
                    beat: 0,
                    editorLane: 0,
                    timeScale: 1,
                    skip: 0,
                    timeScaleEase: 'inStep' as const,
                    timeScaleTransition: 'timeScale' as const,
                    hideNotes: true,
                },
            ],
        },
    ]) {
        const draws = render(preview(chart([[note(2)]], { isDynamicStages: true, ...hiding })), 2)
        const empty = render(preview(chart([], { isDynamicStages: true, ...hiding })), 2)
        assert.deepEqual(
            draws.filter(({ z }) => z[0] !== 24),
            empty,
        )
        assert.equal(bounds(draws).length, 6)
    }
})

test('active connectors show live input bounds and hidden ticks every half beat', () => {
    const source = preview(chart([[note(0), note(2, { left: 0 })]]))
    // At 1.05 the slide is at lane 0.525; the hidden tick at 1 has been hit.
    const draws = render(source, 1.05, { leftLimit: false })
    const connector = bounds(draws).filter(({ a }) => a === 0.6)
    assert.equal(connector.length, 6)
    const live = computeSlideInputBounds(
        createGeometryContext(source, viewport, 1.05),
        EaseType.linear,
        source.notes[0]!,
        source.notes[1]!,
        1,
    )
    toLine(connector, live)
    closeQuad(live, expectedBounds(-1 + 1.05 / 2, 1 + 1.05 / 2, 1, 5))
    // No hidden tick at the head, which is an active head, nor at the tail.
    const ticks = getHiddenTickHitboxes(source.chains[0]!)
    assert.deepEqual(
        ticks.map(({ target, drawStart }) => [target, drawStart]),
        [0.5, 1, 1.5].map((time) => [time, time - 5 / 60]),
    )
    // Ticks attach to the slide; the tick at 1.5 is at lane 0.75.
    const tick = ticks[2]!
    closeQuad(
        computeNoteHitbox(createGeometryContext(source, viewport, 1.5), tick).bounds,
        expectedBounds(-0.25, 1.75, 1, 5),
    )
    assert.equal(bounds(render(source, 1.5 - 4 / 60, { leftLimit: false })).length, 12)
    // The connector covers [head, tail); a paused frame covers (head, tail].
    assert.equal(bounds(render(source, 0, { leftLimit: false })).length, 6)
    assert.equal(
        bounds(render(source, 0, { leftLimit: true })).filter(({ a }) => a === 0.6).length,
        0,
    )
    assert.equal(
        bounds(render(source, 2, { leftLimit: true })).filter(({ a }) => a === 0.6).length,
        6,
    )
    assert.equal(
        bounds(render(source, 2, { leftLimit: false })).filter(({ a }) => a === 0.6).length,
        0,
    )
})

test('damage connectors are checked through hidden damage ticks only', () => {
    const source = preview(
        chart([
            [
                note(1, { connectorType: 'damage', noteType: 'damage' }),
                note(1.75, {
                    isConnectorSeparator: true,
                    connectorType: 'damage',
                    noteType: 'anchor',
                    left: 1,
                }),
                note(2.25, { noteType: 'damage', left: 1 }),
            ],
        ]),
    )
    const ticks = getHiddenTickHitboxes(source.chains[0]!)
    // Each window starts at the previous half beat, but not before the damage head.
    assert.equal(damageTickInputStartBeat(15), 14.5)
    assert.equal(damageTickInputStartBeat(14.1), 14)
    assert.deepEqual(
        ticks.map(({ target, drawStart, leniency, damageTick }) => [
            target,
            drawStart,
            leniency,
            !!damageTick,
        ]),
        [
            [1.5, 1, 0, true],
            [2, 1.5, 0, true],
            [2.25, 2, 0, true],
        ],
    )
    // No connector hitbox: only the ticks, green and fully opaque, until their target.
    const draws = render(source, 2, { leftLimit: false })
    assert.equal(bounds(draws).length, 0)
    const green = bounds(draws, 'green')
    // As in Watch, the damage tick at 2 has despawned at 2; the one at 2.25 has begun.
    assert.equal(green.length, 6)
    assert.ok(green.every(({ a }) => a === 1))
    // A paused frame at 2 shows the instant before: only the tick at 2.
    assert.equal(bounds(render(source, 2, { leftLimit: true }), 'green').length, 6)
    assert.equal(bounds(render(source, 2 - 1e-3, { leftLimit: false }), 'green').length, 6)
    // It follows the slide at the current time, on the segment from 1.75.
    const live = computeSlideInputBounds(
        createGeometryContext(source, viewport, 2),
        EaseType.linear,
        source.chains[0]!.notes[1]!,
        source.chains[0]!.notes[2]!,
        0,
    )
    toLine(green, live)
})

// Reassemble the quad whose outline the six bounds lines were drawn from.
const toLine = (lines: Draw[], expected: Quad) => {
    const mid = (quad: Quad, a: 'bl' | 'br', b: 'tl' | 'tr') => ({
        x: (quad[a].x + quad[b].x) / 2,
        y: (quad[a].y + quad[b].y) / 2,
    })
    // The first line runs from tl to tr; its center line must match.
    const line = lines[0]!.quad
    closeVec(mid(line, 'bl', 'tl'), expected.tl)
    closeVec(mid(line, 'br', 'tr'), expected.tr)
    return line
}

test('damage ticks own the exact note-chain segment, walking back but never forward', () => {
    // An attached note splits the chain. The tick at 1 attaches to the first
    // note, so after the attached note at 0.25 the engine keeps that segment
    // and reports the attached note's position.
    const forward = preview(
        chart([
            [
                note(0, { connectorType: 'damage', noteType: 'damage', left: -5 }),
                note(0.25, { isAttached: true, noteType: 'damage' }),
                note(2, { noteType: 'damage', left: 3 }),
            ],
        ]),
    )
    const [a, b, c] = forward.chains[0]!.notes as [PreviewNote, PreviewNote, PreviewNote]
    const tick = getHiddenTickHitboxes(forward.chains[0]!).find(({ target }) => target === 1)!
    assert.equal(tick.note.attachHead, a)
    assert.equal(tick.drawStart, 0.5)
    const context = createGeometryContext(forward, viewport, 0.75)
    const owned = computeSlideInputBounds(context, EaseType.linear, a, b, 0)
    // Exactly the attached note's own position.
    closeQuad(owned, expectedBounds(-4, -2, 0, 5))
    assert.ok(
        Math.abs(computeSlideInputBounds(context, EaseType.linear, a, c, 0).tl.x - owned.tl.x) >
            0.1,
    )
    toLine(bounds(render(forward, 0.75, { leftLimit: false }), 'green'), owned)

    // A window opening before the tick's attachment head walks back along the chain.
    const backward = preview(
        chart([
            [
                note(0, { connectorType: 'damage', noteType: 'damage', left: -5 }),
                note(1, { isAttached: true, noteType: 'damage' }),
                note(1.25, { noteType: 'damage', left: 3 }),
                note(2, { noteType: 'damage', left: 3 }),
            ],
        ]),
    )
    const notes = backward.chains[0]!.notes
    const late = getHiddenTickHitboxes(backward.chains[0]!).find(({ target }) => target === 1.5)!
    assert.equal(late.drawStart, 1)
    assert.equal(late.note.attachHead, notes[2])
    const green = bounds(render(backward, 1.1, { leftLimit: false }), 'green')
    assert.equal(green.length, 6)
    toLine(
        green,
        computeSlideInputBounds(
            createGeometryContext(backward, viewport, 1.1),
            EaseType.linear,
            notes[1]!,
            notes[2]!,
            0,
        ),
    )
})

test('a connector between notes at the same time interpolates halfway; ease none holds the head', () => {
    const same = preview(chart([[note(1, { left: -3 }), note(1, { left: 1 })]]))
    const context = createGeometryContext(same, viewport, 1)
    const [head, tail] = same.chains[0]!.notes as [PreviewNote, PreviewNote]
    closeQuad(
        computeSlideInputBounds(context, EaseType.linear, head, tail, 1),
        expectedBounds(-1, 1, 1, 5),
    )

    const held = preview(chart([[note(0, { left: -3, connectorEase: 'inStep' }), note(2)]]))
    const [first, last] = held.chains[0]!.notes as [PreviewNote, PreviewNote]
    closeQuad(
        computeSlideInputBounds(
            createGeometryContext(held, viewport, 1.5),
            EaseType.none,
            first,
            last,
            1,
        ),
        expectedBounds(-3, -1, 1, 5),
    )
})

const pivot = (beat: number, pivotLane: number, stage = stageId): StagePivotEventObject => ({
    stageId: stage,
    beat,
    pivotLane,
    divisionSize: 1,
    divisionParity: 'even',
    yOffset: 0,
    yOffsetBeat: 0,
    eventEase: 'inStep',
})
const mask = (
    beat: number,
    maskLeft: number,
    maskSize: number,
    stage = stageId,
): StageMaskEventObject => ({
    stageId: stage,
    beat,
    maskLeft,
    maskSize,
    isMaskNotes: true,
    eventEase: 'inStep',
})
const transform = (
    beat: number,
    rotation: number,
    overrides: Partial<StageTransformEventObject> = {},
): StageTransformEventObject => ({
    stageId,
    beat,
    rotation,
    xTranslation: 0,
    yTranslation: 0,
    elevation: 0,
    anchor: 'default',
    eventEase: 'inStep',
    ...overrides,
})
const style = (
    beat: number,
    overrides: Partial<StageStyleEventObject> = {},
): StageStyleEventObject => ({
    stageId,
    beat,
    editorLane: 0,
    judgmentLineColor: 'neutral',
    judgmentLineStyle: 'default',
    leftBorderStyle: 'default',
    rightBorderStyle: 'default',
    isFullWidth: false,
    noteAlpha: 1,
    laneAlpha: 1,
    judgmentLineAlpha: 1,
    divisionLineAlpha: 1,
    eventEase: 'inStep',
    ...overrides,
})
const camera = (beat: number, overrides: Partial<CameraEventObject> = {}): CameraEventObject => ({
    beat,
    cameraLeft: -6,
    cameraSize: 12,
    cameraZoom: 1,
    cameraZoomTargetLane: 0,
    cameraZoomTargetY: 0,
    cameraZoomVerticalAlign: 'default',
    cameraRotation: 0,
    cameraStageTilt: 1,
    eventEase: 'inStep',
    ...overrides,
})

test('input geometry holds every family, pivots included, at a step on the input time', () => {
    // Every family steps at 2. The stepped pivot would move the note to lane 3,
    // the mask would clip it and the transform and camera would rotate it.
    const events: Partial<Chart> = {
        isDynamicStages: true,
        stagePivotEvents: [pivot(0, 0), pivot(2, 3)],
        stageMaskEvents: [mask(0, -12, 24), mask(2, 2, 1)],
        stageTransformEvents: [transform(0, 0), transform(2, 90)],
        cameraEvents: [camera(0), camera(2, { cameraRotation: 90 })],
    }
    const source = preview(chart([[note(2)]], events))
    closeQuad(scoredHitbox(source, () => true).bounds, expectedBounds(-1, 1, 1, 2.5))

    // Live connector geometry samples the same way, while playing or paused.
    const slide = preview(chart([[note(0), note(4)]], events))
    for (const leftLimit of [false, true]) {
        const connector = bounds(render(slide, 2, { leftLimit })).filter(({ a }) => a === 0.6)
        assert.equal(connector.length, 6)
        toLine(connector, expectedBounds(-1, 1, 1, 2.5))
    }
})

test('camera rotation and zoom rotate and scale the bounds but keep their screen height', () => {
    const source = preview(
        chart([[note(2)]], {
            isDynamicStages: true,
            cameraEvents: [camera(0, { cameraRotation: 90, cameraZoom: 2 })],
        }),
    )
    const { bounds: quad, target } = scoredHitbox(source, () => true)
    // The judge line runs vertically on screen.
    close(target.l.x, target.r.x)
    close(Math.hypot(target.r.x - target.l.x, target.r.y - target.l.y), 2 * 2 * laneW)
    // Zoom widens lanes; the height scales with the lane width.
    close(Math.hypot(quad.tl.x - quad.bl.x, quad.tl.y - quad.bl.y), 2 * 2.5 * 2 * laneW)
    close(Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y), 4 * 2 * laneW)
})

test('masked zero-width notes and collapsed elevation keep the leniency and height', () => {
    const masked = preview(
        chart([[note(2, { left: 4 })]], {
            isDynamicStages: true,
            stageMaskEvents: [mask(0, -2, 4)],
        }),
    )
    const zero = scoredHitbox(masked, () => true)
    closeVec(zero.target.l, zero.target.r)
    closeQuad(zero.bounds, expectedBounds(2, 2, 1, 2.5))
    // The overlay still draws the bounds; the degenerate marker has no area.
    const draws = overlay(render(masked, 2))
    assert.equal(bounds(draws).length, 6)
    for (const { quad } of draws) {
        for (const point of Object.values(quad)) {
            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
        }
    }

    // Raising a note far enough flattens the stage into a line; the hitbox keeps its size.
    const raised = preview(chart([[note(2, { elevation: 100 })]], { isDynamicStages: true }))
    const flat = scoredHitbox(raised, () => true)
    close(
        Math.hypot(flat.bounds.tl.x - flat.bounds.bl.x, flat.bounds.tl.y - flat.bounds.bl.y),
        5 * laneW,
    )
    close(
        Math.hypot(flat.bounds.tr.x - flat.bounds.tl.x, flat.bounds.tr.y - flat.bounds.tl.y),
        4 * laneW,
    )
})

test('attached notes interpolate their endpoints across stages, including untransformed pivots', () => {
    const source = preview(
        chart(
            [
                [
                    note(0, { connectorEase: 'inQuad' }),
                    note(1, { isAttached: true, stageId: otherStageId }),
                    note(2, { stageId: otherStageId, left: 0 }),
                ],
            ],
            {
                isDynamicStages: true,
                stagePivotEvents: [pivot(0, 4, otherStageId)],
                stageTransformEvents: [
                    { ...transform(0, 30), stageId: otherStageId, xTranslation: 1 },
                ],
            },
        ),
    )
    const [head, attached, tail] = source.chains[0]!.notes as [
        PreviewNote,
        PreviewNote,
        PreviewNote,
    ]
    assert.ok(attached.isAttached)
    const context = createGeometryContext(source, viewport, 1)
    const headTransform = computeStageTransform(viewport, context.layout, 0, 0, 0, 0, 0, 0)
    const tailTransform = computeStageTransform(
        viewport,
        context.layout,
        Math.PI / 6,
        1,
        0,
        0,
        0,
        0,
    )
    // Quadratic ease-in at the midpoint.
    const eased = 0.25
    const expected = computeHitbox(
        true,
        context.layout,
        (head.lane + 0) * (1 - eased) + (4 + tail.lane) * eased,
        1 * (1 - eased) + tail.size * eased,
        1,
        0,
        stageTransformToAffine(blendStageTransform(headTransform, tailTransform, eased)),
    )
    const actual = scoredHitbox(source, (value) => value === attached)
    closeQuad(actual.bounds, expected.bounds)
    // A head stage without a transform still has its own rotation pivot.
    const naive = computeHitbox(
        true,
        context.layout,
        (head.lane + 0) * (1 - eased) + (4 + tail.lane) * eased,
        1 * (1 - eased) + tail.size * eased,
        1,
        0,
        stageTransformToAffine(blendStageTransform(identityStageTransform, tailTransform, eased)),
    )
    assert.ok(Math.abs(naive.bounds.bl.y - actual.bounds.bl.y) > 1e-6)
})

const lazyChart = () =>
    chart([
        [note(0), note(2), note(4)],
        [note(1, { connectorType: 'damage', noteType: 'damage' }), note(3, { noteType: 'damage' })],
    ])

test('nothing is scheduled or indexed for hitboxes while the option is off', () => {
    const state = createState(lazyChart(), 0)
    // Count slide reads after compilation: scheduling hidden ticks reads the slides.
    let reads = 0
    const info = new Map(
        [...state.store.slides.info].map(([id, infos]) => [
            id,
            new Proxy(infos, {
                get(target, key, receiver) {
                    if (key === 'entries' || (typeof key === 'string' && /^d+$/.test(key))) reads++
                    return Reflect.get(target, key, receiver)
                },
            }),
        ]),
    )
    const proxied: State = {
        ...state,
        store: { ...state.store, slides: { ...state.store.slides, info } },
    }
    const compiled = buildPreviewChart(proxied, noteSpeed)
    reads = 0

    for (const now of [0.5, 2.5, 3]) {
        assert.equal(overlay(render(compiled, now, { showHitboxes: false })).length, 0)
    }
    assert.equal(reads, 0)
    assert.equal(peekHitboxIndex(compiled), undefined)

    assert.ok(overlay(render(compiled, 2.5)).length > 0)
    assert.ok(reads > 0)
    assert.ok(peekHitboxIndex(compiled))
})

test('toggling hitboxes only adds the overlay without recompiling or mutating the chart', () => {
    const state = createState(lazyChart(), 0)
    const build = createPreviewChartBuilder()
    const compiled = build(state, noteSpeed)
    const snapshot = structuredClone(compiled)
    const frameIndex = getFrameIndex(compiled)

    for (const leftLimit of [false, true]) {
        const off = render(compiled, 2.5, { leftLimit, showHitboxes: false })
        const on = render(compiled, 2.5, { leftLimit })
        assert.ok(overlay(on).length > 0)
        assert.deepEqual(
            on.filter(({ z }) => z[0] !== 24),
            off,
        )
    }
    assert.equal(build(state, noteSpeed), compiled)
    assert.equal(getFrameIndex(compiled), frameIndex)
    assert.deepEqual(compiled, snapshot)

    // Unchanged slides keep their schedules when another part of the chart changes.
    const [first] = compiled.chains
    const ticks = getHiddenTickHitboxes(first!)
    const edited = build(
        { ...state, store: { ...state.store, slides: { ...state.store.slides } } },
        noteSpeed,
    )
    assert.notEqual(edited, compiled)
    assert.equal(edited.chains[0], first)
    assert.equal(getHiddenTickHitboxes(edited.chains[0]!), ticks)
})

// A note exactly on a stage step or an In-Out Step midpoint takes the held value
// (left limit) at its own time; frames are drawn at the right limit, as in Watch.
const particleSprite: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1 }
sprites.set('particle', particleSprite)
const stepParticle = resolveParticle(() => ({
    groups: [
        {
            count: 1,
            particles: [
                {
                    sprite: particleSprite,
                    tint: { r: 1, g: 1, b: 1 },
                    start: 0,
                    duration: 1,
                    x: { from: { c: 0 }, to: { c: 0 }, ease: 'linear' },
                    y: { from: { c: 0 }, to: { c: 0 }, ease: 'linear' },
                    w: { from: { c: 1 }, to: { c: 1 }, ease: 'linear' },
                    h: { from: { c: 1 }, to: { c: 1 }, ease: 'linear' },
                    r: { from: { c: 0 }, to: { c: 0 }, ease: 'linear' },
                    a: { from: { c: 1 }, to: { c: 1 }, ease: 'linear' },
                },
            ],
        },
    ],
}))
const isSlot = ({ sprite }: Draw) => sprite?.startsWith('Sekai Slot') ?? false
const isParticle = ({ sprite }: Draw) => sprite === 'particle'

// Events, the held values alone, and the values after the step alone.
type StepCase = [string, Partial<Chart>, Partial<Chart>, Partial<Chart>]
const rotated = { cameraRotation: 90, cameraZoom: 2 }
const elevated = [transform(0, 0, { elevation: 2 })]
const stepCases: StepCase[] = [
    ...(['none', 'inStep'] as const).map((eventEase): StepCase => [
        `pivot step (${eventEase})`,
        { stagePivotEvents: [{ ...pivot(0, 0), eventEase }, pivot(2, 3)] },
        { stagePivotEvents: [pivot(0, 0)] },
        { stagePivotEvents: [pivot(0, 3)] },
    ]),
    [
        'pivot In-Out Step midpoint',
        { stagePivotEvents: [{ ...pivot(0, 0), eventEase: 'inOutStep' }, pivot(4, 6)] },
        { stagePivotEvents: [pivot(0, 0)] },
        { stagePivotEvents: [pivot(0, 6)] },
    ],
    [
        'division step',
        {
            stagePivotEvents: [
                { ...pivot(0, 0), divisionSize: 2 },
                { ...pivot(2, 0), divisionSize: 3, divisionParity: 'odd' },
            ],
        },
        { stagePivotEvents: [{ ...pivot(0, 0), divisionSize: 2 }] },
        { stagePivotEvents: [{ ...pivot(0, 0), divisionSize: 3, divisionParity: 'odd' }] },
    ],
    [
        'mask In-Out Step midpoint',
        {
            stageMaskEvents: [{ ...mask(0, -12, 24), eventEase: 'inOutStep' }, mask(4, 0, 4)],
        },
        { stageMaskEvents: [mask(0, -12, 24)] },
        { stageMaskEvents: [mask(0, 0, 4)] },
    ],
    [
        'style In-Out Step midpoint',
        {
            stageStyleEvents: [
                style(0, { eventEase: 'inOutStep' }),
                style(4, { judgmentLineStyle: 'singleLine' }),
            ],
        },
        { stageStyleEvents: [style(0)] },
        { stageStyleEvents: [style(0, { judgmentLineStyle: 'singleLine' })] },
    ],
    [
        'transform In-Out Step midpoint',
        {
            stageTransformEvents: [
                transform(0, 0, { eventEase: 'inOutStep' }),
                transform(4, 90, { elevation: 2 }),
            ],
        },
        { stageTransformEvents: [transform(0, 0)] },
        { stageTransformEvents: [transform(0, 90, { elevation: 2 })] },
    ],
    // Cameras only move transformed stages; the frame's own camera matches in all three.
    [
        'camera In-Out Step midpoint',
        {
            stageTransformEvents: elevated,
            cameraEvents: [camera(0, { eventEase: 'inOutStep' }), camera(4, rotated)],
        },
        { stageTransformEvents: elevated, cameraEvents: [camera(0), camera(2.01, rotated)] },
        { stageTransformEvents: elevated, cameraEvents: [camera(0, rotated)] },
    ],
]

for (const [name, events, held, after] of stepCases) {
    test(`a note on a ${name} holds its hitbox and slot effects; frames take the right limit`, () => {
        // A note on the step, and a slide across it.
        const build = (overrides: Partial<Chart>, slide = true) =>
            preview(
                chart([[note(2)], ...(slide ? [[note(0), note(2.5, { left: 1 })]] : [])], {
                    isDynamicStages: true,
                    ...overrides,
                }),
            )
        const onStep = (note: PreviewNote) => note.targetTime === 2
        closeQuad(
            scoredHitbox(build(events), onStep).bounds,
            scoredHitbox(build(held), onStep).bounds,
        )

        for (const leftLimit of [false, true]) {
            const frame = (overrides: Partial<Chart>, now: number, slide = true) =>
                render(build(overrides, slide), now, {
                    leftLimit,
                    showEffects: true,
                    particle: stepParticle,
                })

            // A paused frame on the step is the instant before: everything is held.
            // A playing frame draws the value after the step, except note-time values
            // (hitboxes, slot effects, connector depth). Particles are checked below.
            const draws = frame(events, 2)
            assert.ok(draws.length > 0)
            if (leftLimit) {
                assert.deepEqual(draws, frame(held, 2))
            } else {
                const live = (draws: Draw[]) =>
                    draws
                        .filter((draw) => draw.z[0] !== 24 && !isSlot(draw) && !isParticle(draw))
                        .map(({ sprite, quad, a }) => ({ sprite, quad, a }))
                assert.deepEqual(live(draws), live(frame(after, 2)))
                assert.deepEqual(overlay(draws), overlay(frame(held, 2)))
            }

            // Afterwards slot effects keep the held value; particles take the frame at the target.
            const effects = (overrides: Partial<Chart>) => frame(overrides, 2.05, false)
            const slots = effects(events).filter(isSlot)
            const particles = effects(events).filter(isParticle)
            assert.ok(slots.length > 0)
            assert.ok(particles.length > 0)
            assert.deepEqual(slots, effects(held).filter(isSlot))
            assert.notDeepEqual(slots, effects(after).filter(isSlot))
            assert.deepEqual(particles, effects(after).filter(isParticle))
        }
    })
}

test('frames just after an In-Out Step midpoint draw the value after the jump', () => {
    const build = (overrides: Partial<Chart>) =>
        preview(chart([[note(2.2)]], { isDynamicStages: true, ...overrides }))
    const source = build({
        stagePivotEvents: [{ ...pivot(0, 0), eventEase: 'inOutStep' }, pivot(4, 6)],
    })
    const after = build({ stagePivotEvents: [pivot(0, 6)] })
    const isBody = ({ sprite }: Draw) => sprite?.startsWith('Sekai Normal Note') ?? false

    for (const leftLimit of [false, true]) {
        const body = render(source, 2.01, { leftLimit, showHitboxes: false }).filter(isBody)
        assert.ok(body.length > 0)
        assert.deepEqual(
            body,
            render(after, 2.01, { leftLimit, showHitboxes: false }).filter(isBody),
        )
    }
})

test('an attached note on a pivot step holds both ends of its attachment', () => {
    const build = (stagePivotEvents: StagePivotEventObject[]) =>
        preview(
            chart([[note(0), note(2, { isAttached: true }), note(4, { left: 2 })]], {
                isDynamicStages: true,
                stagePivotEvents,
            }),
        )
    const isAttached = (note: PreviewNote) => note.isAttached
    closeQuad(
        scoredHitbox(build([pivot(0, 0), pivot(2, 3)]), isAttached).bounds,
        scoredHitbox(build([pivot(0, 0)]), isAttached).bounds,
    )
})

test('connector depth keys on the segment head lane at its own time, held on a step', () => {
    const build = (stagePivotEvents: StagePivotEventObject[]) =>
        preview(
            chart([[note(2, { left: 1 }), note(6)]], {
                isDynamicStages: true,
                stagePivotEvents,
            }),
        )
    const depth = (chart: PreviewChart, now: number) =>
        render(chart, now, { leftLimit: false, showHitboxes: false })
            .filter(({ sprite }) => sprite?.includes('Connection'))
            .map(({ z }) => z[3])
    // The head is on a step to lane 3, then the pivot moves on to lane 6.
    const source = build([pivot(0, 0), { ...pivot(2, 3), eventEase: 'linear' }, pivot(6, 6)])
    const lanes = depth(source, 3)
    assert.ok(lanes.length > 0)
    assert.deepEqual(depth(source, 5), lanes)
    // Rel lane 2 at the held pivot 0, plus the positive-lane bias.
    assert.ok(lanes.every((lane) => Math.abs((lane ?? 0) - (2 + 0.05)) < 1e-5))
})
