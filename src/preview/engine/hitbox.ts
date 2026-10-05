import { scheduleHiddenTicks } from '../../state/entities/slides/hiddenTicks'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime } from '../../state/integrals/bpms'
import type { ZKey } from '../gl'
import type { PreviewSkin, Sprite } from '../skin'
import { attachEasedFrac } from './chart'
import { getZAlt, type Layer } from './layer'
import {
    approachAtTilt,
    blendStageTransform,
    computeStageTransform,
    defaultCameraInfo,
    getCameraInfo,
    identityStageTransform,
    layoutTransformAtCamera,
    stageTransformToAffine,
    widthFactorAtTilt,
    type LayoutTransform,
    type PreviewViewport,
    type StageScreenTransform,
    type StageTransform,
} from './layout'
import { interpolateVisualMasks, maskedNoteExtents, noVisualMask, type VisualMask } from './mask'
import {
    addVec,
    applyAffine,
    connectorInterpFrac,
    lerp,
    normalizeVecOrZero,
    orthogonalVec,
    rotateVec,
    safeUnlerpClamped,
    scaleVec,
    subVec,
    unlerpClamped,
    vec,
    type EaseTypeValue,
    type Quad,
    type Vec,
} from './math'
import {
    ConnectorKind,
    NoteKind,
    type NoteKindValue,
    type PreviewChart,
    type PreviewConnector,
    type PreviewNote,
    type PreviewNoteChain,
} from './model'
import { getStageProps, type StageProps } from './stage'
import { createTimeIndex, queryTimeIndex, type TimeIndex } from './timeIndex'

// The engine's Show Hitboxes debug overlay (sekai/lib/note.py draw_hitbox_overlay,
// sekai/play/note.py BaseNote.draw_hitbox and sekai/play/connector.py
// Connector.draw_hitbox) for an autoplay that judges every note on time.

type Draw = (sprite: Sprite | undefined, quad: Quad, z: ZKey, a: number) => void

// sekai/lib/layer.py layers.overlay
const LAYER_OVERLAY: Layer = { layer: 24, sublayer: 0 }

// sekai/lib/note.py
const INSTANT_HITBOX_DRAW_WINDOW = 0.05
const DAMAGE_HITBOX_ACTIVE_WINDOW = 1 / 60
const BORDER_THICKNESS = 0.01
const END_HALF_HEIGHT = 0.05
const END_WIDTH = 0.04
const DOT_HALF = 0.012
const TRIANGLE_HEIGHT = 0.2
const APEX_HALF = 0.012

// sekai/lib/connector.py CONNECTOR_LENIENCY; sekai/play/connector.py draw_hitbox
const CONNECTOR_LENIENCY = 1
const CONNECTOR_HITBOX_ALPHA = 0.6

// skin.guides order
const GUIDE_NEUTRAL = 0
const GUIDE_RED = 1
const GUIDE_GREEN = 2
const GUIDE_BLUE = 3
const GUIDE_BLACK = 7

const frames = (before: number, after = before): readonly [number, number] => [
    -before / 60,
    after / 60,
]

// The bad windows of sekai/lib/buckets.py, by sekai/lib/note.py get_note_window.
// Only their bounds affect input; criticality never changes them.
const TAP_WINDOW = frames(7.5)
const FLICK_WINDOW = frames(7.5, 8.5)
const TRACE_WINDOW = frames(5)
const TRACE_FLICK_WINDOW = frames(6.5, 7.5)
const SLIDE_END_WINDOW = frames(7.5, 8.5)
const SLIDE_END_TRACE_WINDOW = frames(6.5, 8)
const SLIDE_TICK_WINDOW = frames(5)
const EMPTY_WINDOW = frames(0)

export const getInputWindow = (kind: NoteKindValue): readonly [number, number] => {
    switch (kind) {
        case NoteKind.tap:
        case NoteKind.headTap:
        case NoteKind.tailTap:
            return TAP_WINDOW
        case NoteKind.flick:
        case NoteKind.headFlick:
            return FLICK_WINDOW
        case NoteKind.tailFlick:
            return SLIDE_END_WINDOW
        case NoteKind.trace:
        case NoteKind.headTrace:
            return TRACE_WINDOW
        case NoteKind.traceFlick:
        case NoteKind.headTraceFlick:
        case NoteKind.tailTraceFlick:
            return TRACE_FLICK_WINDOW
        case NoteKind.release:
        case NoteKind.headRelease:
        case NoteKind.tailRelease:
            return SLIDE_END_WINDOW
        case NoteKind.tailTrace:
            return SLIDE_END_TRACE_WINDOW
        case NoteKind.tick:
        case NoteKind.hideTick:
            return SLIDE_TICK_WINDOW
        case NoteKind.damage:
        case NoteKind.anchor:
            return EMPTY_WINDOW
    }
}

// has_tap_input or has_release_input: the notes whose target the overlay marks.
const hasTargetMarker = (kind: NoteKindValue) =>
    kind === NoteKind.tap ||
    kind === NoteKind.flick ||
    kind === NoteKind.headTap ||
    kind === NoteKind.headFlick ||
    kind === NoteKind.tailTap ||
    kind === NoteKind.release ||
    kind === NoteKind.headRelease ||
    kind === NoteKind.tailRelease

// The last 0.5-beat grid point strictly before the beat (damage_tick_input_start_beat).
export const damageTickInputStartBeat = (beat: number) => (Math.ceil(beat * 2 - 1e-6) - 1) / 2

export type HitboxNote = {
    /** The note whose geometry the hitbox uses; hidden ticks get a synthetic attached note. */
    note: PreviewNote
    /** A transient hidden damage tick, whose bounds follow its slide. */
    damageTick?: { chain: PreviewNoteChain }
    drawStart: number
    target: number
    leniency: number
}

const toHitboxNote = (note: PreviewNote): HitboxNote => {
    // hitbox_draw_start: damage notes appear briefly before their instant check.
    const drawStart =
        note.kind === NoteKind.damage
            ? note.targetTime - INSTANT_HITBOX_DRAW_WINDOW
            : note.targetTime + getInputWindow(note.kind)[0]
    return {
        note,
        drawStart,
        target: note.targetTime,
        leniency: note.kind === NoteKind.damage ? 0 : 1,
    }
}

// Fake notes and anchors are not scored, so the engine gives them no input.
const isScored = (note: PreviewNote) => !note.isFake && note.kind !== NoteKind.anchor

const noteHitboxes = new WeakMap<PreviewNote, HitboxNote>()
const getNoteHitbox = (note: PreviewNote) => {
    let hitbox = noteHitboxes.get(note)
    if (!hitbox) {
        hitbox = toHitboxNote(note)
        noteHitboxes.set(note, hitbox)
    }
    return hitbox
}

// The level data serializer emits these ticks for the engine; schedule the
// same ones per slide and keep them until the slide is recompiled.
const chainHiddenTicks = new WeakMap<PreviewNoteChain, HitboxNote[]>()
export const getHiddenTickHitboxes = (chain: PreviewNoteChain): HitboxNote[] => {
    let ticks = chainHiddenTicks.get(chain)
    if (ticks) return ticks

    const previewNotes = new Map<NoteEntity, PreviewNote>()
    for (const note of chain.notes) if (note.source) previewNotes.set(note.source, note)
    const getNote = (entity: NoteEntity) => {
        const note = previewNotes.get(entity)
        if (!note) throw new Error('Unexpected missing preview note')
        return note
    }
    const toTime = (beat: number) => beatToTime(chain.bpms, beat)

    ticks = scheduleHiddenTicks(chain.infos).map((tick): HitboxNote => {
        const beat = tick.tick / 480
        const attachHead = getNote(tick.attachHead)
        const attachTail = getNote(tick.attachTail)
        const note: PreviewNote = {
            style: 'default',
            kind: NoteKind.hideTick,
            isCritical: false,
            isFake: false,
            targetTime: toTime(beat),
            lane: 0,
            size: 0,
            direction: 0,
            groupIndex: attachHead.groupIndex,
            stageIndex: -1,
            isAttached: true,
            attachHead,
            attachTail,
            connectorEase: attachHead.connectorEase,
            targetScaledTime: 0,
        }
        // BaseNote.preprocess: attached notes take their size from the attachment.
        note.size = Math.max(0, lerp(attachHead.size, attachTail.size, attachEasedFrac(note)))

        if (tick.connectorType === 'active') return toHitboxNote(note)

        // BaseNote.init_data: a damage tick checks from the previous half beat,
        // but never before its damage connector's head.
        let startBeat = damageTickInputStartBeat(beat)
        if (tick.damageHead) startBeat = Math.max(startBeat, tick.damageHead.beat)
        return {
            note,
            damageTick: { chain },
            drawStart: toTime(startBeat),
            target: note.targetTime,
            leniency: 0,
        }
    })
    chainHiddenTicks.set(chain, ticks)
    return ticks
}

// Damage connectors handle input, but their ticks already show the input
// bounds (should_show_connector_hitbox). Fake and guide connectors have none.
const hasConnectorHitbox = (connector: PreviewConnector) =>
    !!connector.activeHead &&
    (connector.kind === ConnectorKind.activeNormal ||
        connector.kind === ConnectorKind.activeCritical)

// Damage ticks stay checked through their target; everything else is judged
// on time by the autoplay and disappears then.
const endIsInclusive = (hitbox: HitboxNote) => !!hitbox.damageTick

export type HitboxIndex = {
    notes: TimeIndex<HitboxNote>
    connectors: TimeIndex<PreviewConnector>
    // Static note hitboxes depend only on the chart and the viewport.
    hitboxes: Map<HitboxNote, Hitbox>
    fieldW: number
    fieldH: number
}

const indexes = new WeakMap<PreviewChart, HitboxIndex>()

/** The overlay's index, if it has been built for the chart. */
export const peekHitboxIndex = (chart: PreviewChart) => indexes.get(chart)

export const getHitboxIndex = (chart: PreviewChart) => {
    let index = indexes.get(chart)
    if (!index) {
        const notes: HitboxNote[] = []
        for (const note of chart.notes) if (isScored(note)) notes.push(getNoteHitbox(note))
        for (const chain of chart.chains) {
            for (const tick of getHiddenTickHitboxes(chain)) notes.push(tick)
        }
        index = {
            notes: createTimeIndex(
                notes,
                (hitbox) => hitbox.drawStart,
                // Admit the inclusive end of damage ticks; visibility is exact below.
                (hitbox) => hitbox.target + (endIsInclusive(hitbox) ? 1e-6 : 0),
            ),
            connectors: createTimeIndex(
                chart.connectors.filter(hasConnectorHitbox),
                ({ head, tail }) => Math.min(head.targetTime, tail.targetTime),
                ({ head, tail, throughJudgeLine }) =>
                    Math.max(head.targetTime, tail.targetTime) + (throughJudgeLine ? 1e-6 : 0),
            ),
            hitboxes: new Map(),
            fieldW: NaN,
            fieldH: NaN,
        }
        indexes.set(chart, index)
    }
    return index
}

export type Hitbox = {
    target: { l: Vec; r: Vec }
    bounds: Quad
}

type StageGeometry = {
    pivotLane: number
    props: StageProps
    transform: StageTransform
}

type InputGeometry = {
    lane: number
    mask: VisualMask
    yOffset: number
    transform: StageTransform
}

/**
 * Camera and stage state at one input time (InputGeometryContext). Pivot lanes
 * include events at the timestamp; masks, offsets, transforms and the camera use
 * the left limit. Only the stages of the queried notes are sampled.
 */
export type GeometryContext = {
    chart: PreviewChart
    viewport: PreviewViewport
    time: number
    layout: LayoutTransform
    stages: Map<number, StageGeometry>
}

export const createGeometryContext = (
    chart: PreviewChart,
    viewport: PreviewViewport,
    time: number,
): GeometryContext => ({
    chart,
    viewport,
    time,
    layout: layoutTransformAtCamera(
        viewport,
        chart.isDynamicStages
            ? getCameraInfo(viewport, chart.cameras, time, true)
            : defaultCameraInfo(),
    ),
    stages: new Map(),
})

const stageGeometry = (context: GeometryContext, stageIndex: number) => {
    const stage = context.chart.stages[stageIndex]
    if (!stage) return
    let geometry = context.stages.get(stageIndex)
    if (!geometry) {
        const props = getStageProps(stage, context.time, true)
        geometry = {
            pivotLane: getStageProps(stage, context.time).pivotLane,
            props,
            // Untransformed stages still have a rotation pivot to blend with.
            transform: computeStageTransform(
                context.viewport,
                context.layout,
                props.rotate,
                props.xLaneTranslate,
                props.yLaneTranslate,
                props.lane,
                props.centerWeight,
                props.elevation,
            ),
        }
        context.stages.set(stageIndex, geometry)
    }
    return geometry
}

// BaseNote._basic_input_geometry
const basicInputGeometry = (context: GeometryContext, note: PreviewNote): InputGeometry => {
    const elevation = note.elevation ?? 0
    const stage = stageGeometry(context, note.stageIndex)
    if (!stage) {
        return {
            lane: note.lane,
            mask: noVisualMask,
            yOffset: 0,
            transform:
                elevation !== 0
                    ? computeStageTransform(
                          context.viewport,
                          context.layout,
                          0,
                          0,
                          0,
                          0,
                          0,
                          elevation,
                      )
                    : identityStageTransform,
        }
    }
    const { props } = stage
    return {
        lane: stage.pivotLane + note.lane,
        mask: props.maskNotes
            ? {
                  enabled: true,
                  left: props.lane - props.width,
                  right: props.lane + props.width,
                  stageIndex: note.stageIndex,
              }
            : noVisualMask,
        yOffset: props.yOffset,
        transform:
            elevation !== 0
                ? computeStageTransform(
                      context.viewport,
                      context.layout,
                      props.rotate,
                      props.xLaneTranslate,
                      props.yLaneTranslate,
                      props.lane,
                      props.centerWeight,
                      props.elevation + elevation,
                  )
                : stage.transform,
    }
}

// BaseNote.input_geometry. An attached note interpolates its attachment's
// endpoints, which may lie on different stages.
export const inputGeometry = (context: GeometryContext, note: PreviewNote): InputGeometry => {
    const { attachHead, attachTail } = note
    if (!note.isAttached || !attachHead || !attachTail) return basicInputGeometry(context, note)

    const head = basicInputGeometry(context, attachHead)
    const tail = basicInputGeometry(context, attachTail)
    const easedFrac = attachEasedFrac(note)
    return {
        lane: lerp(head.lane, tail.lane, easedFrac),
        mask: interpolateVisualMasks(head.mask, tail.mask, easedFrac),
        yOffset: lerp(
            head.yOffset,
            tail.yOffset,
            safeUnlerpClamped(attachHead.targetTime, attachTail.targetTime, note.targetTime),
        ),
        transform: blendStageTransform(head.transform, tail.transform, easedFrac),
    }
}

// sekai/lib/layout.py compute_hitbox
export const computeHitbox = (
    isDynamicStages: boolean,
    transform: LayoutTransform,
    lane: number,
    size: number,
    leniency: number,
    yOffset: number,
    stageTransform: StageScreenTransform,
): Hitbox => {
    const tilt = transform.stageTilt
    const travel = approachAtTilt(1 - yOffset, tilt)
    const widthFactor = widthFactorAtTilt(travel, tilt)
    const lX = (lane - size) * widthFactor * transform.wScale + transform.xTranslate
    const rX = (lane + size) * widthFactor * transform.wScale + transform.xTranslate
    const noteY = travel * transform.hScale + transform.t
    // The engine keeps the same screen-space leniency at low tilt.
    const laneW = transform.wScale
    // Dividing out the camera size keeps the height constant on screen.
    const verticalLaneW = laneW / transform.sizeZoom
    // The editor preview has no stage cover, so no cover compensation applies.
    const verticalExtent = (isDynamicStages ? 2.5 : 5) * verticalLaneW
    const rotation = -transform.rotate
    const targetL = applyAffine(stageTransform, rotateVec(vec(lX, noteY), rotation))
    const targetR = applyAffine(stageTransform, rotateVec(vec(rX, noteY), rotation))
    // Keep the height and leniency even when elevation flattens the stage to a line.
    const axis = rotateVec(vec(1, 0), rotation)
    const horizontal = normalizeVecOrZero(
        vec(
            stageTransform.a00 * axis.x + stageTransform.a01 * axis.y,
            stageTransform.a10 * axis.x + stageTransform.a11 * axis.y,
        ),
    )
    const vertical = scaleVec(orthogonalVec(horizontal), verticalExtent)
    const margin = scaleVec(horizontal, leniency * laneW)
    return {
        target: { l: targetL, r: targetR },
        bounds: {
            bl: subVec(subVec(targetL, margin), vertical),
            br: subVec(addVec(targetR, margin), vertical),
            tl: addVec(subVec(targetL, margin), vertical),
            tr: addVec(addVec(targetR, margin), vertical),
        },
    }
}

const geometryHitbox = (
    context: GeometryContext,
    geometry: InputGeometry,
    size: number,
    leniency: number,
) => {
    const extents = maskedNoteExtents(geometry.lane, size, geometry.mask)
    return computeHitbox(
        context.chart.isDynamicStages,
        context.layout,
        extents.lane,
        extents.size,
        leniency,
        geometry.yOffset,
        stageTransformToAffine(geometry.transform),
    )
}

// BaseNote.preprocess: the hitbox at the target time, fixed for the note's life.
export const computeNoteHitbox = (context: GeometryContext, hitbox: HitboxNote) =>
    geometryHitbox(context, inputGeometry(context, hitbox.note), hitbox.note.size, hitbox.leniency)

const headEaseFrac = (note: PreviewNote) =>
    note.isAttached && note.attachHead && note.attachTail
        ? safeUnlerpClamped(note.attachHead.targetTime, note.attachTail.targetTime, note.targetTime)
        : 0

const tailEaseFrac = (note: PreviewNote) =>
    note.isAttached && note.attachHead && note.attachTail
        ? safeUnlerpClamped(note.attachHead.targetTime, note.attachTail.targetTime, note.targetTime)
        : 1

// Attached notes connect with their attachment head's ease (BaseNote.preprocess).
const connectorEase = (note: PreviewNote) =>
    note.isAttached && note.attachHead ? note.attachHead.connectorEase : note.connectorEase

// sekai/play/note.py compute_slide_input_bounds, with get_connector_fractions.
export const computeSlideInputBounds = (
    context: GeometryContext,
    easeType: EaseTypeValue,
    head: PreviewNote,
    tail: PreviewNote,
    leniency: number,
): Quad => {
    const headFrac = headEaseFrac(head)
    const tailFrac = tailEaseFrac(tail)
    const inputFrac = safeUnlerpClamped(head.targetTime, tail.targetTime, context.time)
    const interpFrac = connectorInterpFrac(
        easeType,
        headFrac,
        tailFrac,
        lerp(headFrac, tailFrac, inputFrac),
        inputFrac,
    )
    const headGeometry = inputGeometry(context, head)
    const tailGeometry = inputGeometry(context, tail)
    return geometryHitbox(
        context,
        {
            lane: lerp(headGeometry.lane, tailGeometry.lane, interpFrac),
            mask: interpolateVisualMasks(headGeometry.mask, tailGeometry.mask, interpFrac),
            yOffset: lerp(headGeometry.yOffset, tailGeometry.yOffset, inputFrac),
            transform: blendStageTransform(
                headGeometry.transform,
                tailGeometry.transform,
                interpFrac,
            ),
        },
        Math.max(lerp(head.size, tail.size, interpFrac), 0),
        leniency,
    ).bounds
}

const chainPositions = new WeakMap<PreviewNoteChain, Map<PreviewNote, number>>()
const getChainPositions = (chain: PreviewNoteChain) => {
    let positions = chainPositions.get(chain)
    if (!positions) {
        positions = new Map(chain.notes.map((note, index) => [note, index]))
        chainPositions.set(chain, positions)
    }
    return positions
}

// BaseNote.damage_tick_input_bounds: follow the slide's note chain (every note,
// attached or not) back from the tick's attachment head to the segment at the
// input time.
export const computeDamageTickBounds = (
    context: GeometryContext,
    hitbox: HitboxNote,
    fallback: () => Quad,
): Quad => {
    const chain = hitbox.damageTick?.chain
    const attachHead = hitbox.note.isAttached ? hitbox.note.attachHead : hitbox.note
    let index = chain && attachHead ? (getChainPositions(chain).get(attachHead) ?? -1) : -1
    if (!chain || index < 0) return fallback()
    const { notes } = chain

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (index > 0 && notes[index]!.targetTime > context.time) index--
    if (index === notes.length - 1 && index > 0) index--

    const head = notes[index]
    const next = notes[index + 1]
    if (!head || !next) return fallback()
    return computeSlideInputBounds(context, connectorEase(head), head, next, hitbox.leniency)
}

const drawLine = (draw: Draw, sprite: Sprite | undefined, p1: Vec, p2: Vec, z: ZKey, a: number) => {
    const ortho = scaleVec(normalizeVecOrZero(orthogonalVec(subVec(p2, p1))), BORDER_THICKNESS / 2)
    draw(
        sprite,
        {
            bl: subVec(p1, ortho),
            br: subVec(p2, ortho),
            tr: addVec(p2, ortho),
            tl: addVec(p1, ortho),
        },
        z,
        a,
    )
}

const Z_BOUNDS = getZAlt(LAYER_OVERLAY, 0)
const Z_TRIANGLE = getZAlt(LAYER_OVERLAY, 1)
const Z_APEX = getZAlt(LAYER_OVERLAY, 2)
const Z_TARGET = getZAlt(LAYER_OVERLAY, 3)
const Z_TARGET_DOT = getZAlt(LAYER_OVERLAY, 4)

// draw_hitbox_bounds_overlay: the outline and both diagonals.
const drawBounds = (draw: Draw, bounds: Quad, sprite: Sprite | undefined, a: number) => {
    drawLine(draw, sprite, bounds.tl, bounds.tr, Z_BOUNDS, a)
    drawLine(draw, sprite, bounds.bl, bounds.br, Z_BOUNDS, a)
    drawLine(draw, sprite, bounds.tl, bounds.bl, Z_BOUNDS, a)
    drawLine(draw, sprite, bounds.tr, bounds.br, Z_BOUNDS, a)
    drawLine(draw, sprite, bounds.tl, bounds.br, Z_BOUNDS, a)
    drawLine(draw, sprite, bounds.tr, bounds.bl, Z_BOUNDS, a)
}

// draw_hitbox_overlay's triangle and draw_hitbox_marker. Only tap and release
// inputs have one, so the yellow damage target never appears.
const drawTarget = (draw: Draw, skin: PreviewSkin, l: Vec, r: Vec, a: number) => {
    const sprite = skin.guides[GUIDE_RED]
    const t = BORDER_THICKNESS
    const axis = normalizeVecOrZero(subVec(r, l))
    const ortho = orthogonalVec(axis)
    const along = (p: Vec, distance: number, across: number) =>
        addVec(addVec(p, scaleVec(axis, distance)), scaleVec(ortho, across))

    const apex = addVec(scaleVec(addVec(l, r), 0.5), scaleVec(ortho, TRIANGLE_HEIGHT))
    drawLine(draw, sprite, l, apex, Z_TRIANGLE, a)
    drawLine(draw, sprite, r, apex, Z_TRIANGLE, a)
    draw(
        sprite,
        {
            bl: along(apex, -APEX_HALF, -APEX_HALF),
            tl: along(apex, -APEX_HALF, APEX_HALF),
            tr: along(apex, APEX_HALF, APEX_HALF),
            br: along(apex, APEX_HALF, -APEX_HALF),
        },
        Z_APEX,
        a,
    )

    const li = along(l, END_WIDTH, 0)
    const ri = along(r, -END_WIDTH, 0)
    draw(
        sprite,
        { bl: along(li, 0, -t), tl: along(li, 0, t), tr: along(ri, 0, t), br: along(ri, 0, -t) },
        Z_TARGET,
        a,
    )
    draw(
        sprite,
        {
            bl: along(l, 0, -END_HALF_HEIGHT),
            tl: along(l, 0, END_HALF_HEIGHT),
            tr: along(li, 0, t),
            br: along(li, 0, -t),
        },
        Z_TARGET,
        a,
    )
    draw(
        sprite,
        {
            bl: along(ri, 0, -t),
            tl: along(ri, 0, t),
            tr: along(r, 0, END_HALF_HEIGHT),
            br: along(r, 0, -END_HALF_HEIGHT),
        },
        Z_TARGET,
        a,
    )
    const dot = skin.guides[GUIDE_BLACK]
    draw(
        dot,
        {
            bl: along(l, 0, -DOT_HALF),
            tl: along(l, 0, DOT_HALF),
            tr: along(l, 2 * DOT_HALF, DOT_HALF),
            br: along(l, 2 * DOT_HALF, -DOT_HALF),
        },
        Z_TARGET_DOT,
        a,
    )
    draw(
        dot,
        {
            bl: along(r, -2 * DOT_HALF, -DOT_HALF),
            tl: along(r, -2 * DOT_HALF, DOT_HALF),
            tr: along(r, 0, DOT_HALF),
            br: along(r, 0, -DOT_HALF),
        },
        Z_TARGET_DOT,
        a,
    )
}

// Playback shows the frame at `now`; a paused frame shows the instant before it,
// like the rest of the preview, so a hitbox ending at the cursor stays visible.
const isVisible = (
    start: number,
    end: number,
    inclusiveEnd: boolean,
    now: number,
    leftLimit: boolean,
) =>
    leftLimit ? start < now && now <= end : start <= now && (inclusiveEnd ? now <= end : now < end)

export const drawHitboxes = (
    draw: Draw,
    skin: PreviewSkin,
    chart: PreviewChart,
    viewport: PreviewViewport,
    now: number,
    leftLimit: boolean,
) => {
    const index = getHitboxIndex(chart)
    if (index.fieldW !== viewport.fieldW || index.fieldH !== viewport.fieldH) {
        index.hitboxes.clear()
        index.fieldW = viewport.fieldW
        index.fieldH = viewport.fieldH
    }

    // Live geometry is sampled at the input time, so share it across the frame.
    let live: GeometryContext | undefined
    const getLive = () => (live ??= createGeometryContext(chart, viewport, now))
    const targetContexts = new Map<number, GeometryContext>()
    const getNoteHitboxGeometry = (hitbox: HitboxNote) => {
        let geometry = index.hitboxes.get(hitbox)
        if (!geometry) {
            let context = targetContexts.get(hitbox.target)
            if (!context) {
                context = createGeometryContext(chart, viewport, hitbox.target)
                targetContexts.set(hitbox.target, context)
            }
            geometry = computeNoteHitbox(context, hitbox)
            index.hitboxes.set(hitbox, geometry)
        }
        return geometry
    }

    for (const { item: connector } of queryTimeIndex(index.connectors, now, now, leftLimit)) {
        const { head, tail, throughJudgeLine } = connector
        if (
            !isVisible(
                Math.min(head.targetTime, tail.targetTime),
                Math.max(head.targetTime, tail.targetTime),
                throughJudgeLine,
                now,
                leftLimit,
            )
        )
            continue
        drawBounds(
            draw,
            computeSlideInputBounds(getLive(), connector.ease, head, tail, CONNECTOR_LENIENCY),
            skin.guides[GUIDE_BLUE],
            CONNECTOR_HITBOX_ALPHA,
        )
    }

    for (const { item: hitbox } of queryTimeIndex(index.notes, now, now, leftLimit)) {
        if (!isVisible(hitbox.drawStart, hitbox.target, endIsInclusive(hitbox), now, leftLimit))
            continue

        const { kind } = hitbox.note
        if (hitbox.damageTick) {
            drawBounds(
                draw,
                computeDamageTickBounds(
                    getLive(),
                    hitbox,
                    () => getNoteHitboxGeometry(hitbox).bounds,
                ),
                skin.guides[GUIDE_GREEN],
                1,
            )
            continue
        }

        const geometry = getNoteHitboxGeometry(hitbox)
        const alpha = unlerpClamped(hitbox.drawStart, hitbox.target, now)
        const damage = kind === NoteKind.damage
        drawBounds(
            draw,
            geometry.bounds,
            skin.guides[
                damage
                    ? hitbox.target - now > DAMAGE_HITBOX_ACTIVE_WINDOW
                        ? GUIDE_NEUTRAL
                        : GUIDE_GREEN
                    : GUIDE_BLUE
            ],
            alpha,
        )
        if (hasTargetMarker(kind)) {
            drawTarget(draw, skin, geometry.target.l, geometry.target.r, alpha)
        }
    }
}
