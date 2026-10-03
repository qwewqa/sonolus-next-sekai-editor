import type { ConnectorEntity } from '../../state/entities/slides/connector'
import { clamp } from '../../utils/math'
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

export const getElevationConnections = (
    rows: ElevationRow[],
    connectors: Iterable<ConnectorEntity[]>,
    enabled = true,
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
            const alpha = guide
                ? clamp(
                      Math.max(
                          properties.connectorGuideAlpha,
                          connector.segmentTail.connectorGuideAlpha,
                      ),
                  ) * 0.6
                : 0.85
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
    return result
}

const edgeDistance = (row: ElevationRow, dx: number, dy: number, laneScale: number) =>
    Math.min(
        dx === 0 ? Infinity : (row.w / 2 + 3) / Math.abs(dx),
        dy === 0 ? Infinity : (laneScale * 0.3 + 3) / Math.abs(dy),
    )

export const drawElevationConnections = (
    ctx: CanvasRenderingContext2D,
    connections: ElevationConnection[],
    laneScale: number,
) => {
    ctx.save()
    ctx.lineJoin = 'round'
    for (const connection of connections) {
        const { head, tail, connector } = connection
        const distance = Math.hypot(tail.x - head.x, tail.y - head.y)
        const dx = distance ? (tail.x - head.x) / distance : 0
        const dy = distance ? (tail.y - head.y) / distance : -1
        const start = edgeDistance(head, dx, dy, laneScale)
        const end = edgeDistance(tail, dx, dy, laneScale)
        const points: [number, number][] =
            distance > start + end + 2
                ? [
                      [head.x + dx * start, head.y + dy * start],
                      [tail.x - dx * end, tail.y - dy * end],
                  ]
                : [
                      [head.x, head.y - laneScale * 0.3 - 3],
                      [head.x, Math.min(head.y, tail.y) - laneScale * 0.3 - 18],
                      [tail.x, Math.min(head.y, tail.y) - laneScale * 0.3 - 18],
                      [tail.x, tail.y - laneScale * 0.3 - 3],
                  ]
        const drawPath = () => {
            ctx.beginPath()
            points.forEach(([x, y], index) => {
                if (index) ctx.lineTo(x, y)
                else ctx.moveTo(x, y)
            })
            ctx.stroke()
        }
        ctx.globalAlpha = connection.alpha
        ctx.setLineDash(
            connection.fake
                ? [5, 4]
                : connector.segmentHead.connectorType === 'guide'
                  ? [3, 3]
                  : [],
        )
        if (connection.edge) {
            ctx.strokeStyle = connection.edge
            ctx.lineWidth = 5
            drawPath()
        }
        ctx.strokeStyle = ctx.fillStyle = connection.color
        ctx.lineWidth = connector.segmentHead.connectorType === 'guide' ? 2 : 3
        drawPath()
        const tip = points.at(-1)
        const previous = points.at(-2)
        if (!tip || !previous) continue
        const angle = Math.atan2(tip[1] - previous[1], tip[0] - previous[0])
        const length = Math.min(9, Math.hypot(tip[0] - previous[0], tip[1] - previous[1]) * 0.6)
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(...tip)
        ctx.lineTo(tip[0] - Math.cos(angle - 0.5) * length, tip[1] - Math.sin(angle - 0.5) * length)
        ctx.lineTo(tip[0] - Math.cos(angle + 0.5) * length, tip[1] - Math.sin(angle + 0.5) * length)
        ctx.closePath()
        ctx.fill()
    }
    ctx.restore()
}
