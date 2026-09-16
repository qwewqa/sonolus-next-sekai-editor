import type { StageId } from '../../chart/stages'
import type { Entity, EntityType } from '../../state/entities'
import type { EventConnectionEntity } from '../../state/entities/events/connections'
import type { EventJointEntity } from '../../state/entities/events/joints'
import type { StageEventJointEntity } from '../../state/entities/events/joints/stage'
import { beatToTime } from '../../state/integrals/bpms'
import { formatBpm, formatTimeScale } from '../../utils/format'
import type { Range } from '../../utils/range'
import { getPathD } from '../entities/events/path'
import type { EditorDrawContext } from './types'

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

const label = (
    context: EditorDrawContext,
    text: string,
    x: number,
    y: number,
    color: string,
    size = 0.4,
    align: CanvasTextAlign = 'center',
) => {
    const { ctx, fontFamily } = context
    ctx.fillStyle = color
    ctx.font = `${size}px ${fontFamily}`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y)
}

const drawConnection = (context: EditorDrawContext, entity: EventConnectionEntity) => {
    const { ctx, state, ups } = context
    let cached = connectionPaths.get(entity)
    if (cached?.bpms !== state.bpms || cached.ups !== ups) {
        const minXs = jointXs(entity.min)
        const maxXs = jointXs(entity.max)
        const yMin = beatToTime(state.bpms, entity.min.beat) * ups
        const yMax = beatToTime(state.bpms, entity.max.beat) * ups
        cached = {
            bpms: state.bpms,
            ups,
            paths: minXs.map(
                (x, index) =>
                    new Path2D(getPathD(x, maxXs[index] ?? x, yMin, yMax, entity.min.eventEase)),
            ),
        }
        connectionPaths.set(entity, cached)
    }

    ctx.strokeStyle = eventColor(entity.min)
    ctx.globalAlpha *= 0.5
    // Keep separate strokes: coincident left/right edges intentionally overlap.
    for (const path of cached.paths) ctx.stroke(path)
}

/** Draws one event without retaining reactive editor state. */
export const drawEvent = (
    context: EditorDrawContext,
    entity: DrawnEventEntity,
    highlighted: boolean,
    opacity = 1,
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
            label(context, formatBpm(entity.bpm), 6.1, y, '#f0f', 0.5, 'left')
            break
        }
        case 'timeScale': {
            const x = entity.editorLane
            const y = beatToTime(state.bpms, entity.beat) * ups
            ctx.strokeStyle = '#ff0'
            ctx.globalAlpha *= 0.5
            if (entity.hideNotes) ctx.setLineDash([2 / context.scale, 2 / context.scale])
            ctx.lineDashOffset = 0
            line(ctx, Math.min(x, -6), y, Math.max(x, 6), y)
            ctx.globalAlpha *= 2
            ctx.setLineDash([])
            ctx.strokeStyle = '#fff'
            ctx.fillStyle = '#ff0'
            marker(ctx, x, y)
            label(
                context,
                formatTimeScale(entity.timeScale, entity.skip, entity.timeScaleEase),
                x + (x > 0 ? 0.2 : -0.2),
                y,
                '#ff0',
                0.5,
                x > 0 ? 'left' : 'right',
            )
            if (
                context.showGroupName &&
                entity.groupId !== context.defaultGroupId &&
                (highlighted || context.recentlyActive)
            ) {
                label(
                    context,
                    state.groups.get(entity.groupId)?.name ?? '',
                    x + (x > 0 ? -0.2 : 0.2),
                    y,
                    '#0aa',
                    0.4,
                    x > 0 ? 'right' : 'left',
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
            if (
                entity.type !== 'cameraEventJoint' &&
                context.showStageName &&
                state.isDynamicStages &&
                (highlighted || context.recentlyActive)
            ) {
                const stageName = state.stages.get(entity.stageId)?.name
                if (stageName) label(context, stageName, (x + (xs[1] ?? x)) / 2, y, '#a0a')
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
    stageId: StageId | undefined,
    showOtherStages: boolean,
) => {
    for (const [id, range] of ranges) {
        const isVisible = isEventVisible && (stageId === undefined || range.min.stageId === stageId)
        if (!isVisible && !showOtherStages) continue

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

export const drawEventInfinities = (
    context: EditorDrawContext,
    visibilities: Record<EntityType, boolean>,
    stageId: StageId | undefined,
    showOtherStages: boolean,
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
        switch (type) {
            case 'cameraEventConnection': {
                const range = state.store.globalEventRanges.cameraEventJoint
                if (range) drawInfinity(context, range, true, true, isVisible ? 1 : 0.25)
                break
            }
            case 'stageMaskEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stageMaskEventJoint,
                    isVisible,
                    stageId,
                    showOtherStages,
                )
                break
            case 'stagePivotEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stagePivotEventJoint,
                    isVisible,
                    stageId,
                    showOtherStages,
                )
                break
            case 'stageStyleEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stageStyleEventJoint,
                    isVisible,
                    stageId,
                    showOtherStages,
                )
                break
            case 'stageTransformEventConnection':
                drawStageInfinities(
                    context,
                    stageEventRanges.stageTransformEventJoint,
                    isVisible,
                    stageId,
                    showOtherStages,
                )
                break
        }
    }
    ctx.restore()
}
