import type { ConnectorLayer, ConnectorType } from '../../chart/note'
import { isStepEase } from '../../ease'
import type { ConnectorEntity } from '../../state/entities/slides/connector'
import { beatToTime, type BpmIntegral } from '../../state/integrals/bpms'
import { clamp, lerp } from '../../utils/math'
import { connectorColors } from '../utils/connectorColors'
import type { ElevationRow } from './layout'

export type ElevationConnection = {
    connector: ConnectorEntity
    head: ElevationRow
    tail: ElevationRow
    color: string
    edge?: string
    alpha: number
    fake: boolean
}

const layerOrder: Record<ConnectorLayer, number> = { under: 0, bottom: 1, top: 2, over: 3 }
const typeOrder: Record<ConnectorType, number> = { active: 0, damage: 1, guide: 2 }

const guideAlpha = (connector: ConnectorEntity, bpms?: BpmIntegral[]) => {
    const timeAt = (beat: number) => (bpms ? beatToTime(bpms, beat) : beat)
    const start = timeAt(connector.segmentHead.beat)
    const end = timeAt(connector.segmentTail.beat)
    const fraction =
        Math.abs(end - start) < 1e-6
            ? 0.5
            : clamp((timeAt(connector.head.beat) - start) / (end - start))
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
            const alpha = guide ? guideAlpha(connector, bpms) : 0.8
            if (!alpha) continue
            const colors = connectorColors(properties)
            result.push({
                connector,
                head,
                tail,
                color: colors.body,
                edge: colors.edge,
                alpha,
                fake: !guide && properties.connectorIsFake,
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

export const drawElevationConnections = (
    ctx: CanvasRenderingContext2D,
    connections: ElevationConnection[],
) => {
    ctx.save()
    ctx.lineCap = 'butt'
    ctx.setLineDash([])
    for (const connection of connections) {
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
        ctx.globalAlpha = connection.alpha
        ctx.fillStyle = connection.color
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
