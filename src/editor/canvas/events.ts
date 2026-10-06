import type { StageId } from '../../chart/stages'
import { isNoneEase } from '../../ease'
import { easeGlyphPoints } from '../../easeGlyph'
import type { Entity, EntityType } from '../../state/entities'
import type { EventConnectionEntity } from '../../state/entities/events/connections'
import type { EventJointEntity } from '../../state/entities/events/joints'
import type { StageEventJointEntity } from '../../state/entities/events/joints/stage'
import type { TimeScaleEntity } from '../../state/entities/timeScale'
import { beatToTime } from '../../state/integrals/bpms'
import type { StoreGrid } from '../../state/store/grid'
import { formatBpm, formatTimeScale } from '../../utils/format'
import type { Range } from '../../utils/range'
import { getPathD, getRangePathDs } from '../entities/events/path'
import type { ScopeLookup } from '../scopeRules'
import { drawText, measureText } from './text'
import type { CanvasBounds, EditorDrawContext } from './types'

type DrawnEventEntity = Exclude<Entity, { type: 'note' | 'connector' }>

const connectionPaths = new WeakMap<
    EventConnectionEntity,
    {
        bpms: EditorDrawContext['state']['bpms']
        ups: number
        paths: Path2D[]
    }
>()

const jointXs = (entity: EventJointEntity): number[] => {
    switch (entity.type) {
        case 'cameraEventJoint':
            return [entity.cameraLeft, entity.cameraLeft + entity.cameraSize]
        case 'stageMaskEventJoint':
            return [entity.maskLeft, entity.maskLeft + entity.maskSize]
        case 'stagePivotEventJoint':
            return [entity.pivotLane]
        case 'stageStyleEventJoint':
            return [entity.editorLane]
        case 'stageTransformEventJoint':
            return [entity.xTranslation]
    }
}

// The engine's minimum camera and mask widths, in editor lanes.
const rangeMinWidth = (entity: EventJointEntity) =>
    entity.type === 'cameraEventJoint'
        ? 0.02
        : entity.type === 'stageMaskEventJoint'
          ? 0
          : undefined

const eventColor = (entity: EventJointEntity) => {
    switch (entity.type) {
        case 'cameraEventJoint':
            return '#f00'
        case 'stageMaskEventJoint':
            return '#0f0'
        case 'stagePivotEventJoint':
            return '#00f'
        case 'stageStyleEventJoint':
            return '#0ff'
        case 'stageTransformEventJoint':
            return '#ddd'
    }
}

const line = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
}

const marker = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.beginPath()
    ctx.arc(x, y, 0.1, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
}

const DIAMOND_RADIUS = 0.135

/** Circles change the time scale and diamonds the scroll; hollow ones hide notes. */
const timeScaleMarker = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    isScroll: boolean,
    hideNotes: boolean,
) => {
    ctx.beginPath()
    if (isScroll) {
        ctx.moveTo(x, y - DIAMOND_RADIUS)
        ctx.lineTo(x + DIAMOND_RADIUS, y)
        ctx.lineTo(x, y + DIAMOND_RADIUS)
        ctx.lineTo(x - DIAMOND_RADIUS, y)
        ctx.closePath()
    } else {
        ctx.arc(x, y, 0.1, 0, 2 * Math.PI)
    }
    ctx.fillStyle = '#ff0'
    ctx.strokeStyle = hideNotes ? '#ff0' : '#fff'
    if (!hideNotes) ctx.fill()
    ctx.stroke()
}

const nextTimeScales = new WeakMap<
    StoreGrid['timeScale'],
    Map<TimeScaleEntity, TimeScaleEntity | null>
>()

/**
 * The next time scale of the same group, which its ease transitions to: null
 * for the last one, undefined for one outside the chart such as a preview.
 */
const nextTimeScale = ({ state }: EditorDrawContext, entity: TimeScaleEntity) => {
    const grid = state.store.grid.timeScale
    let next = nextTimeScales.get(grid)
    if (!next) {
        const groups = new Map<TimeScaleEntity['groupId'], TimeScaleEntity[]>()
        for (const entities of grid.values()) {
            for (const timeScale of entities) {
                const group = groups.get(timeScale.groupId)
                if (group) group.push(timeScale)
                else groups.set(timeScale.groupId, [timeScale])
            }
        }
        next = new Map()
        for (const group of groups.values()) {
            group.sort((a, b) => a.beat - b.beat)
            for (const [index, timeScale] of group.entries())
                next.set(timeScale, group[index + 1] ?? null)
        }
        nextTimeScales.set(grid, next)
    }
    return next.get(entity)
}

const stacks = new WeakMap<Map<number, Set<Entity>>, Map<Entity, readonly Entity[]>>()

/**
 * Objects at one beat of one track (a group's time scales, a stage's events),
 * in the order the chart plays them, for each object stacked with others.
 */
const stackOf = <T extends Entity>(
    grid: Map<number, Set<T>>,
    entity: T,
    track: (entity: T) => unknown,
): readonly T[] | undefined => {
    let stacked = stacks.get(grid) as Map<T, readonly T[]> | undefined
    if (!stacked) {
        stacked = new Map()
        for (const entities of grid.values()) {
            const byTrack = new Map<string, T[]>()
            for (const other of entities) {
                const key = `${String(track(other))}:${other.beat}`
                const list = byTrack.get(key)
                if (list) list.push(other)
                else byTrack.set(key, [other])
            }
            for (const list of byTrack.values())
                if (list.length > 1) for (const other of list) stacked.set(other, list)
        }
        stacks.set(grid, stacked)
    }
    return stacked.get(entity)
}

// Lanes, in proportion to the 0.5-lane label font; nearer its value than its marker.
const EASE_GLYPH = { width: 0.3, height: 0.34, gap: 0.06, stroke: 0.05 }

// From the marker to the ease glyph.
const LABEL_OFFSET = 0.23

/** Labels point outward from the stage, and inward where outward would leave the view. */
export const timeScaleLabelDirection = (
    x: number,
    width: number,
    { l, r }: Pick<CanvasBounds, 'l' | 'r'>,
): 1 | -1 => {
    const outward = x > 0 ? 1 : -1
    const fits = (direction: 1 | -1) => (direction > 0 ? x + width <= r : x - width >= l)
    return fits(outward) || !fits(-outward as 1 | -1) ? outward : (-outward as 1 | -1)
}

// A plain jump: Step In, the last change, or one to the same value.
const INSTANT_ALPHA = 0.7

/**
 * Draws a time scale's ease toward the next change, mirrored when the value
 * decreases and faded when the speed simply jumps. Returns the width it takes.
 */
const drawEaseGlyph = (
    context: EditorDrawContext,
    entity: TimeScaleEntity,
    x: number,
    y: number,
    direction: 1 | -1,
    color: string,
) => {
    const { ctx, scale } = context
    const next = nextTimeScale(context, entity)
    const { width, height, gap, stroke } = EASE_GLYPH
    const left = direction > 0 ? x : x - width
    const top = y - height / 2
    ctx.save()
    if (isNoneEase(entity.timeScaleEase) || next === null || next?.timeScale === entity.timeScale)
        ctx.globalAlpha *= INSTANT_ALPHA
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(stroke, 1 / scale)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    for (const [index, [px, py]] of easeGlyphPoints(
        entity.timeScaleEase,
        !!next && next.timeScale < entity.timeScale,
    ).entries()) {
        if (index) ctx.lineTo(left + px * width, top + py * height)
        else ctx.moveTo(left + px * width, top + py * height)
    }
    ctx.stroke()
    ctx.restore()
    return width + gap
}

const drawConnection = (context: EditorDrawContext, entity: EventConnectionEntity) => {
    const { ctx, state, ups } = context
    let cached = connectionPaths.get(entity)
    if (cached?.bpms !== state.bpms || cached.ups !== ups) {
        const minXs = jointXs(entity.min)
        const maxXs = jointXs(entity.max)
        const yMin = beatToTime(state.bpms, entity.min.beat) * ups
        const yMax = beatToTime(state.bpms, entity.max.beat) * ups
        const minWidth = rangeMinWidth(entity.min)
        cached = {
            bpms: state.bpms,
            ups,
            paths:
                minWidth === undefined
                    ? minXs.map(
                          (x, index) =>
                              new Path2D(
                                  getPathD(x, maxXs[index] ?? x, yMin, yMax, entity.min.eventEase),
                              ),
                      )
                    : getRangePathDs(
                          minXs as [number, number],
                          maxXs as [number, number],
                          yMin,
                          yMax,
                          entity.min.eventEase,
                          minWidth,
                      ).map((d) => new Path2D(d)),
        }
        connectionPaths.set(entity, cached)
    }

    ctx.strokeStyle = eventColor(entity.min)
    ctx.globalAlpha *= 0.5
    // Keep separate strokes: coincident left/right edges intentionally overlap.
    for (const path of cached.paths) ctx.stroke(path)
}

/** A time scale's line, or its marker and label, for drawing them in separate layers. */
export type TimeScalePart = 'line' | 'marker'

/** Draws one event without retaining reactive editor state. */
export const drawEvent = (
    context: EditorDrawContext,
    entity: DrawnEventEntity,
    highlighted: boolean,
    opacity = 1,
    part?: TimeScalePart,
) => {
    const { ctx, state, ups } = context
    ctx.save()
    ctx.globalAlpha *= opacity
    ctx.lineWidth = 2 / context.scale
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'
    ctx.setLineDash([])

    switch (entity.type) {
        case 'cameraEventConnection':
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            drawConnection(context, entity)
            break
        case 'bpm': {
            const y = beatToTime(state.bpms, entity.beat) * ups
            ctx.strokeStyle = '#f0f'
            ctx.globalAlpha *= 0.5
            line(ctx, -6, y, 6, y)
            ctx.globalAlpha *= 2
            drawText(
                context,
                formatBpm(entity.bpm),
                6.1,
                y,
                '#f0f',
                0.5,
                'start',
                context.figureMiddle,
            )
            break
        }
        case 'timeScale': {
            const stack = stackOf(state.store.grid.timeScale, entity, ({ groupId }) => groupId)
            // A same-beat jump shares one marker on its first change's lane.
            const lead = stack?.[0] ?? entity
            if (lead !== entity && lead.editorLane === entity.editorLane) break
            const members =
                lead === entity
                    ? (stack ?? [entity]).filter(
                          ({ editorLane }) => editorLane === entity.editorLane,
                      )
                    : [entity]
            const x = entity.editorLane
            const y = beatToTime(state.bpms, entity.beat) * ups
            const isScroll = members.some(
                ({ timeScaleTransition }) => timeScaleTransition === 'scroll',
            )
            const hideNotes = members.some(({ hideNotes }) => hideNotes)
            // Hollow markers keep the line out of their interior.
            const gap = hideNotes ? (isScroll ? DIAMOND_RADIUS : 0.1) : 0
            if (part !== 'marker') {
                ctx.strokeStyle = '#ff0'
                ctx.globalAlpha *= 0.5
                if (hideNotes) ctx.setLineDash([2 / context.scale, 2 / context.scale])
                ctx.lineDashOffset = 0
                if (x - gap > Math.min(x, -6)) line(ctx, Math.min(x, -6), y, x - gap, y)
                if (x + gap < Math.max(x, 6)) line(ctx, x + gap, y, Math.max(x, 6), y)
                ctx.globalAlpha *= 2
                ctx.setLineDash([])
            }
            if (part === 'line') break
            timeScaleMarker(ctx, x, y, isScroll, hideNotes)
            // A same-beat jump reads as one label, in the order it plays.
            if (lead !== entity) break
            const text = (stack ?? [entity])
                .map(({ timeScale, skip }) => formatTimeScale(timeScale, skip))
                .join('→')
            const direction = timeScaleLabelDirection(
                x,
                LABEL_OFFSET + EASE_GLYPH.width + EASE_GLYPH.gap + measureText(context, text, 0.5),
                context.bounds,
            )
            const labelX = x + LABEL_OFFSET * direction
            const glyphWidth = drawEaseGlyph(
                context,
                stack?.at(-1) ?? entity,
                labelX,
                y,
                direction,
                '#ff0',
            )
            const textX = labelX + glyphWidth * direction
            drawText(
                context,
                text,
                textX,
                y,
                '#ff0',
                0.5,
                direction > 0 ? 'start' : 'end',
                context.figureMiddle,
            )
            if (
                context.showGroupName &&
                entity.groupId !== context.defaultGroupId &&
                (highlighted ||
                    context.recentlyActive ||
                    !!stack?.some((member) => context.isHighlighted?.(member)))
            ) {
                // Opposite the label, unless it turned inward for want of room there.
                const side = direction === (x > 0 ? 1 : -1) ? -direction : direction
                drawText(
                    context,
                    state.groups.get(entity.groupId)?.name ?? '',
                    side === direction
                        ? textX + (measureText(context, text, 0.5) + 0.2) * direction
                        : x + 0.2 * side,
                    y,
                    '#0aa',
                    0.4,
                    side > 0 ? 'start' : 'end',
                )
            }
            break
        }
        case 'cameraEventJoint':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint': {
            const xs = jointXs(entity)
            const x = xs[0] ?? 0
            const y = beatToTime(state.bpms, entity.beat) * ups
            const color = eventColor(entity)
            ctx.strokeStyle = color
            ctx.fillStyle = color
            ctx.globalAlpha *= 0.5
            if (xs[1] !== undefined) line(ctx, x, y, xs[1], y)
            if (entity.type === 'cameraEventJoint') {
                ctx.beginPath()
                ctx.arc(
                    entity.cameraLeft + entity.cameraSize / 2 + entity.cameraZoomTargetLane,
                    y,
                    0.1,
                    0,
                    2 * Math.PI,
                )
                ctx.fill()
            }
            ctx.globalAlpha *= 2
            ctx.strokeStyle = '#fff'
            for (const x of xs) marker(ctx, x, y)
            // Same-beat joints of one track draw as one; say how many there are.
            const stack = stackOf(
                state.store.grid[entity.type] as Map<number, Set<Entity>>,
                entity,
                (joint) => ('stageId' in joint ? joint.stageId : undefined),
            )
            if (stack?.[0] === entity)
                drawText(
                    context,
                    `×${stack.length}`,
                    x + 0.15,
                    y - 0.25,
                    color,
                    0.35,
                    'start',
                    context.figureMiddle,
                )
            if (
                entity.type !== 'cameraEventJoint' &&
                context.showStageName &&
                state.isDynamicStages &&
                (highlighted || context.recentlyActive)
            ) {
                const stageName = state.stages.get(entity.stageId)?.name
                if (stageName) drawText(context, stageName, (x + (xs[1] ?? x)) / 2, y, '#a0a')
            }
        }
    }
    ctx.restore()
}

const drawInfinity = (
    context: EditorDrawContext,
    range: Range<EventJointEntity>,
    fromStart: boolean,
    untilEnd: boolean,
    opacity: number,
) => {
    const { ctx, state, ups, bounds } = context
    ctx.save()
    ctx.globalAlpha *= 0.5 * opacity
    ctx.strokeStyle = eventColor(range.min)
    if (fromStart) {
        const y = beatToTime(state.bpms, range.min.beat) * ups
        for (const x of jointXs(range.min)) line(ctx, x, 0, x, y)
    }
    if (untilEnd) {
        const y = beatToTime(state.bpms, range.max.beat) * ups
        for (const x of jointXs(range.max)) line(ctx, x, y, x, bounds.t)
    }
    ctx.restore()
}

const drawStageInfinities = (
    context: EditorDrawContext,
    ranges: Iterable<[StageId, Range<StageEventJointEntity>]>,
    isEventVisible: boolean,
    scope: ScopeLookup,
) => {
    for (const [id, range] of ranges) {
        const visibility = scope.stage(range.min.stageId)
        if (visibility === 'hidden') continue
        const isVisible = isEventVisible && visibility === 'full'

        const stage = context.state.stages.get(id)
        const isMask = range.min.type === 'stageMaskEventJoint'
        drawInfinity(
            context,
            range,
            !isMask || !!stage?.isFromStart,
            !isMask || !!stage?.isUntilEnd,
            isVisible ? 1 : 0.25,
        )
    }
}

const infinityTypes = [
    'cameraEventConnection',
    'stageMaskEventConnection',
    'stagePivotEventConnection',
    'stageStyleEventConnection',
    'stageTransformEventConnection',
] as const

/**
 * Draws the lines extending event ranges to the chart start and end. Stage
 * ranges follow their stage's scope like the event connections they extend;
 * hidden event types are drawn faintly unless other objects are hidden.
 */
export const drawEventInfinities = (
    context: EditorDrawContext,
    visibilities: Record<EntityType, boolean>,
    scope: ScopeLookup,
    showOtherObjects: boolean,
) => {
    const { ctx, state } = context
    const { stageEventRanges } = state.store
    ctx.save()
    ctx.lineWidth = 2 / context.scale
    ctx.lineCap = 'butt'
    ctx.setLineDash([])
    const sortedTypes = [...infinityTypes].sort((a, b) => +visibilities[a] - +visibilities[b])
    for (const type of sortedTypes) {
        const isVisible = visibilities[type]
        if (!isVisible && !showOtherObjects) continue
        switch (type) {
            case 'cameraEventConnection': {
                const range = state.store.globalEventRanges.cameraEventJoint
                if (range) drawInfinity(context, range, true, true, isVisible ? 1 : 0.25)
                break
            }
            case 'stageMaskEventConnection':
                drawStageInfinities(context, stageEventRanges.stageMaskEventJoint, isVisible, scope)
                break
            case 'stagePivotEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stagePivotEventJoint,
                    isVisible,
                    scope,
                )
                break
            case 'stageStyleEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stageStyleEventJoint,
                    isVisible,
                    scope,
                )
                break
            case 'stageTransformEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stageTransformEventJoint,
                    isVisible,
                    scope,
                )
                break
        }
    }
    ctx.restore()
}
