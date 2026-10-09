import type { ConnectorLayer, ConnectorType } from '../../chart/note'
import { ease, isStepEase, sampleEase } from '../../ease'
import { sameBeatAttachmentFraction } from '../../state/entities/slides/attachment'
import type { ConnectorEntity } from '../../state/entities/slides/connector'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime, type BpmIntegral } from '../../state/integrals/bpms'
import type { StoreSlides } from '../../state/store/slides'
import { clamp, lerp, safeUnlerp, safeUnlerpClamped } from '../../utils/math'
import { connectorColors } from '../utils/connectorColors'
import { guideElevationFraction } from '../utils/guideAlpha'
import type { ElevationRow } from './layout'

export type ElevationConnection = {
    connector: ConnectorEntity
    head: ElevationRow
    tail: ElevationRow
    color: string
    edge?: string
    alpha: number
    tailAlpha?: number
    fake: boolean
    headFraction: number
    tailFraction: number
}

const layerOrder: Record<ConnectorLayer, number> = { under: 0, bottom: 1, top: 2, over: 3 }
const typeOrder: Record<ConnectorType, number> = { active: 0, damage: 1, guide: 2 }

const guideAlpha = (
    connector: ConnectorEntity,
    bpms?: BpmIntegral[],
    marker = connector.head,
    infos?: StoreSlides['info'],
) => {
    const timeAt = (beat: number) => (bpms ? beatToTime(bpms, beat) : beat)
    const start = timeAt(connector.segmentHead.beat)
    const end = timeAt(connector.segmentTail.beat)
    const fraction =
        (connector.segmentHead.beat === connector.segmentTail.beat
            ? guideElevationFraction(
                  marker,
                  connector.segmentHead,
                  connector.segmentTail,
                  infos?.get(connector.head.slideId),
              )
            : undefined) ??
        (Math.abs(end - start) < 1e-6
            ? 0.5
            : clamp((timeAt(connector.head.beat) - start) / (end - start)))
    return (
        clamp(
            lerp(
                connector.segmentHead.connectorGuideAlpha,
                connector.segmentTail.connectorGuideAlpha,
                fraction,
            ),
        ) * 0.5
    )
}

export const getElevationConnections = (
    rows: ElevationRow[],
    connectors: Iterable<ConnectorEntity[]>,
    enabled = true,
    bpms?: BpmIntegral[],
    infos?: StoreSlides['info'],
): ElevationConnection[] => {
    if (!enabled) return []
    const byNote = new Map(rows.map((row) => [row.note, row]))
    const result: ElevationConnection[] = []
    for (const slide of connectors) {
        for (const connector of slide) {
            const head = byNote.get(connector.head)
            const tail = byNote.get(connector.tail)
            if (!head || !tail) continue
            const properties = connector.segmentHead
            const guide = properties.connectorType === 'guide'
            const alpha = guide ? guideAlpha(connector, bpms, connector.head, infos) : 0.8
            const tailAlpha =
                guide && connector.segmentHead.beat === connector.segmentTail.beat
                    ? guideAlpha(connector, bpms, connector.tail, infos)
                    : undefined
            if (!alpha && !tailAlpha) continue
            const colors = connectorColors(properties)
            // A zero-beat piece inside a time-based attachment has no parent
            // elevation interval. Ease over that piece's full elevation span.
            const localElevation =
                connector.head.beat === connector.tail.beat &&
                connector.attachHead.beat !== connector.attachTail.beat
            const fraction = (note: NoteEntity, fallback: number) => {
                if (
                    localElevation ||
                    !note.isAttached ||
                    note === connector.attachHead ||
                    note === connector.attachTail
                )
                    return fallback
                const timeAt = (beat: number) => (bpms ? beatToTime(bpms, beat) : beat)
                return (
                    sameBeatAttachmentFraction(connector.attachHead, connector.attachTail, note) ??
                    safeUnlerpClamped(
                        timeAt(connector.attachHead.beat),
                        timeAt(connector.attachTail.beat),
                        timeAt(note.beat),
                    )
                )
            }
            result.push({
                connector,
                head,
                tail,
                color: colors.body,
                edge: colors.edge,
                alpha,
                tailAlpha,
                fake: !guide && properties.connectorIsFake,
                headFraction: fraction(connector.head, 0),
                tailFraction: fraction(connector.tail, 1),
            })
        }
    }
    return result.sort((a, b) => {
        const headA = a.connector.segmentHead
        const headB = b.connector.segmentHead
        return (
            layerOrder[headA.connectorLayer] - layerOrder[headB.connectorLayer] ||
            typeOrder[headA.connectorType] - typeOrder[headB.connectorType]
        )
    })
}

export type ElevationRibbon = {
    headLeft: [number, number]
    headRight: [number, number]
    tailLeft: [number, number]
    tailRight: [number, number]
}

export const getElevationRibbon = (
    connection: ElevationConnection,
): ElevationRibbon | undefined => {
    const { head, tail, connector } = connection
    if (
        isStepEase(connector.attachHead.connectorEase) ||
        head.y === tail.y ||
        (head.w <= 0 && tail.w <= 0)
    )
        return
    return {
        headLeft: [head.x - head.w / 2, head.y],
        headRight: [head.x + head.w / 2, head.y],
        tailLeft: [tail.x - tail.w / 2, tail.y],
        tailRight: [tail.x + tail.w / 2, tail.y],
    }
}

type RibbonPoint = { x: number; y: number; w: number; u: number }

/** Same-beat connectors use elevation as their longitudinal easing axis. */
export const getElevationCurve = (connection: ElevationConnection): RibbonPoint[][] | undefined => {
    const { head, tail, connector, headFraction, tailFraction } = connection
    if (
        connector.head.beat !== connector.tail.beat ||
        head.y === tail.y ||
        (head.w <= 0 && tail.w <= 0)
    )
        return
    const type = connector.attachHead.connectorEase
    if (type === 'linear') return
    const pinned = (fraction: number) =>
        fraction <= 0 ? 0 : fraction >= 1 ? 1 : ease(type, fraction)
    const first = pinned(headFraction)
    const last = pinned(tailFraction)
    const interp = (u: number) =>
        type === 'none' || type === 'inStep'
            ? 0
            : safeUnlerp(
                  first,
                  last,
                  ease(type, lerp(headFraction, tailFraction, u)),
                  isStepEase(type) ? 0 : u,
              )
    const at = (u: number, q = interp(u)): RibbonPoint => ({
        x: lerp(head.x, tail.x, q),
        y: lerp(head.y, tail.y, u),
        w: Math.max(0, lerp(head.w, tail.w, q)),
        u,
    })
    if (isStepEase(type)) {
        const split = safeUnlerp(headFraction, tailFraction, 0.5, -1)
        const breaks = type === 'inOutStep' && split > 0 && split < 1 ? [0, split, 1] : [0, 1]
        return breaks.slice(1).map((to, index) => {
            const from = breaks[index] ?? 0
            const q = interp((from + to) / 2)
            return [
                { ...at(from, q), u: 0 },
                { ...at(to, q), u: 1 },
            ]
        })
    }
    const span = Math.max(
        Math.abs(tail.x - tail.w / 2 - head.x + head.w / 2),
        Math.abs(tail.x + tail.w / 2 - head.x - head.w / 2),
        1,
    )
    if (Math.abs(last - first) < 1e-6) return [[at(0), at(1)]]
    const fractions = sampleEase(
        type,
        Math.min(headFraction, tailFraction),
        Math.max(headFraction, tailFraction),
        (0.25 * Math.abs(last - first)) / span,
    )
    if (headFraction > tailFraction) fractions.reverse()
    return [fractions.map((fraction) => at(safeUnlerp(headFraction, tailFraction, fraction, 0)))]
}

const drawElevationCurve = (
    ctx: CanvasRenderingContext2D,
    connection: ElevationConnection,
    sections: RibbonPoint[][],
) => {
    const body = () => {
        ctx.beginPath()
        for (const points of sections) {
            for (const [index, { x, y, w }] of points.entries()) {
                if (index) ctx.lineTo(x - w / 2, y)
                else ctx.moveTo(x - w / 2, y)
            }
            for (const { x, y, w } of [...points].reverse()) ctx.lineTo(x + w / 2, y)
            ctx.closePath()
        }
    }
    setFillStyle(ctx, connection)
    body()
    ctx.fill()
    const edgeWidth = Math.min(3, Math.min(connection.head.w, connection.tail.w) * 0.12)
    if (connection.edge && edgeWidth > 0) {
        ctx.save()
        body()
        ctx.clip()
        ctx.strokeStyle = connection.edge
        ctx.lineWidth = edgeWidth
        ctx.beginPath()
        for (const points of sections) {
            for (const side of [-1, 1]) {
                for (const [index, { x, y, w }] of points.entries()) {
                    if (index) ctx.lineTo(x + (w / 2) * side, y)
                    else ctx.moveTo(x + (w / 2) * side, y)
                }
            }
        }
        ctx.stroke()
        ctx.restore()
    }
    if (connection.fake) {
        ctx.globalAlpha = 0.8
        ctx.strokeStyle = '#f44'
        ctx.lineWidth = 2
        ctx.beginPath()
        for (const points of sections) {
            for (const side of [-1, 1]) {
                for (const [index, { x, y, w, u }] of points.entries()) {
                    if (index) ctx.lineTo(x + w * (u - 0.5) * side, y)
                    else ctx.moveTo(x + w * (u - 0.5) * side, y)
                }
            }
        }
        ctx.stroke()
    }
}

const setFillStyle = (ctx: CanvasRenderingContext2D, connection: ElevationConnection) => {
    const { alpha, tailAlpha = alpha, color, head, tail } = connection
    if (alpha === tailAlpha || head.y === tail.y) {
        ctx.globalAlpha = (alpha + tailAlpha) / 2
        ctx.fillStyle = color
        return
    }
    const rgba = (opacity: number) =>
        `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${clamp(opacity)})`
    const gradient = ctx.createLinearGradient(0, head.y, 0, tail.y)
    gradient.addColorStop(0, rgba(alpha))
    gradient.addColorStop(1, rgba(tailAlpha))
    ctx.globalAlpha = 1
    ctx.fillStyle = gradient
}

export const drawElevationConnections = (
    ctx: CanvasRenderingContext2D,
    connections: ElevationConnection[],
) => {
    ctx.save()
    ctx.lineCap = 'butt'
    ctx.setLineDash([])
    for (const connection of connections) {
        const curve = getElevationCurve(connection)
        if (curve) {
            drawElevationCurve(ctx, connection, curve)
            continue
        }
        const ribbon = getElevationRibbon(connection)
        if (!ribbon) continue
        const { headLeft, headRight, tailLeft, tailRight } = ribbon
        const body = () => {
            ctx.beginPath()
            ctx.moveTo(...headLeft)
            ctx.lineTo(...tailLeft)
            ctx.lineTo(...tailRight)
            ctx.lineTo(...headRight)
            ctx.closePath()
        }
        setFillStyle(ctx, connection)
        body()
        ctx.fill()
        const edgeWidth = Math.min(3, Math.min(connection.head.w, connection.tail.w) * 0.12)
        if (connection.edge && edgeWidth > 0) {
            ctx.save()
            body()
            ctx.clip()
            ctx.strokeStyle = connection.edge
            ctx.lineWidth = edgeWidth
            ctx.beginPath()
            ctx.moveTo(...headLeft)
            ctx.lineTo(...tailLeft)
            ctx.moveTo(...headRight)
            ctx.lineTo(...tailRight)
            ctx.stroke()
            ctx.restore()
        }
        if (connection.fake) {
            ctx.globalAlpha = 0.8
            ctx.strokeStyle = '#f44'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(...headLeft)
            ctx.lineTo(...tailRight)
            ctx.moveTo(...tailLeft)
            ctx.lineTo(...headRight)
            ctx.stroke()
        }
    }
    ctx.restore()
}
