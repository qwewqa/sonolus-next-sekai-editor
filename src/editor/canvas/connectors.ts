import { ease } from '../../ease'
import type { ConnectorEntity } from '../../state/entities/slides/connector'
import { beatToTime, type BpmIntegral } from '../../state/integrals/bpms'
import { activeColors, damageColor, guideColors } from '../../utils/colors'
import { clamp, lerp, remap, unlerp } from '../../utils/math'
import { isConnectorVisible } from '../entities/visibility'
import type { EditorDrawContext } from './types'

type Edge = { time: number; left: number; size: number }

type ConnectorGraphic = {
    bpms: BpmIntegral[]
    ups: number
    path: Path2D
    fakeMarker?: Path2D
    color: string
    headAlpha: number
    tailAlpha: number
    headColor: string
    tailColor: string
    gradient?: CanvasGradient
    yHead: number
    yTail: number
}

const rgba = (color: string, alpha: number) =>
    `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${clamp(alpha)})`

const appendEase = (
    path: Path2D,
    attachHead: Edge,
    attachTail: Edge,
    tHead: number,
    tTail: number,
    connectorEase: 'in' | 'out',
    ups: number,
) => {
    const pHead = unlerp(attachHead.time, attachTail.time, tHead)
    const pTail = unlerp(attachHead.time, attachTail.time, tTail)
    const qHead = ease(connectorEase, pHead)
    const qTail = ease(connectorEase, pTail)
    const qMid = connectorEase === 'in' ? pHead * pTail : 1 - (1 - pHead) * (1 - pTail)

    const lHead = lerp(attachHead.left, attachTail.left, qHead)
    const lTail = lerp(attachHead.left, attachTail.left, qTail)
    const lMid = lerp(attachHead.left, attachTail.left, qMid)
    const sHead = lerp(attachHead.size, attachTail.size, qHead)
    const sTail = lerp(attachHead.size, attachTail.size, qTail)
    const sMid = lerp(attachHead.size, attachTail.size, qMid)
    const yHead = tHead * ups
    const yTail = tTail * ups
    const yMid = ((tHead + tTail) / 2) * ups

    path.moveTo(lHead, yHead)
    path.quadraticCurveTo(lMid, yMid, lTail, yTail)
    path.lineTo(lTail + sTail, yTail)
    path.quadraticCurveTo(lMid + sMid, yMid, lHead + sHead, yHead)
    path.closePath()
}

const createGraphic = (
    entity: ConnectorEntity,
    bpms: BpmIntegral[],
    ups: number,
): ConnectorGraphic => {
    const { attachHead, attachTail, head, tail, segmentHead, segmentTail } = entity
    const tAttachHead = beatToTime(bpms, attachHead.beat)
    const tAttachTail = beatToTime(bpms, attachTail.beat)
    const tHead = beatToTime(bpms, head.beat)
    const tTail = beatToTime(bpms, tail.beat)
    const yHead = tHead * ups
    const yTail = tTail * ups
    const path = new Path2D()
    const first = { time: tAttachHead, left: attachHead.left, size: attachHead.size }
    const last = { time: tAttachTail, left: attachTail.left, size: attachTail.size }

    switch (attachHead.connectorEase) {
        case 'none':
            path.rect(attachHead.left, yTail, attachHead.size, yHead - yTail)
            break
        case 'linear': {
            const lHead = remap(tAttachHead, tAttachTail, first.left, last.left, tHead)
            const lTail = remap(tAttachHead, tAttachTail, first.left, last.left, tTail)
            const sHead = remap(tAttachHead, tAttachTail, first.size, last.size, tHead)
            const sTail = remap(tAttachHead, tAttachTail, first.size, last.size, tTail)
            path.moveTo(lHead, yHead)
            path.lineTo(lTail, yTail)
            path.lineTo(lTail + sTail, yTail)
            path.lineTo(lHead + sHead, yHead)
            path.closePath()
            break
        }
        case 'in':
        case 'out':
            appendEase(path, first, last, tHead, tTail, attachHead.connectorEase, ups)
            break
        case 'inOut':
        case 'outIn': {
            const middle = {
                time: (tAttachHead + tAttachTail) / 2,
                left: (first.left + last.left) / 2,
                size: (first.size + last.size) / 2,
            }
            if (tHead < middle.time) {
                appendEase(
                    path,
                    first,
                    middle,
                    tHead,
                    Math.min(middle.time, tTail),
                    attachHead.connectorEase === 'inOut' ? 'in' : 'out',
                    ups,
                )
            }
            if (tTail > middle.time) {
                appendEase(
                    path,
                    middle,
                    last,
                    Math.max(tHead, middle.time),
                    tTail,
                    attachHead.connectorEase === 'inOut' ? 'out' : 'in',
                    ups,
                )
            }
            break
        }
    }

    let color: string
    let headAlpha: number
    let tailAlpha: number
    if (segmentHead.connectorType === 'guide') {
        color = guideColors[segmentHead.connectorGuideColor]
        const tSegmentHead = beatToTime(bpms, segmentHead.beat)
        const tSegmentTail = beatToTime(bpms, segmentTail.beat)
        headAlpha =
            remap(
                tSegmentHead,
                tSegmentTail,
                segmentHead.connectorGuideAlpha,
                segmentTail.connectorGuideAlpha,
                tHead,
            ) * 0.5
        tailAlpha =
            remap(
                tSegmentHead,
                tSegmentTail,
                segmentHead.connectorGuideAlpha,
                segmentTail.connectorGuideAlpha,
                tTail,
            ) * 0.5
    } else {
        color =
            segmentHead.connectorType === 'damage'
                ? damageColor
                : activeColors[segmentHead.connectorActiveIsCritical ? 'critical' : 'normal']
        headAlpha = tailAlpha = 0.8
    }

    let fakeMarker: Path2D | undefined
    if (segmentHead.connectorType !== 'guide' && segmentHead.connectorIsFake) {
        const lHead = remap(tAttachHead, tAttachTail, first.left, last.left, tHead)
        const lTail = remap(tAttachHead, tAttachTail, first.left, last.left, tTail)
        const sHead = remap(tAttachHead, tAttachTail, first.size, last.size, tHead)
        const sTail = remap(tAttachHead, tAttachTail, first.size, last.size, tTail)
        fakeMarker = new Path2D()
        fakeMarker.moveTo(lHead, yHead)
        fakeMarker.lineTo(lTail + sTail, yTail)
        fakeMarker.moveTo(lTail, yTail)
        fakeMarker.lineTo(lHead + sHead, yHead)
    }

    return {
        bpms,
        ups,
        path,
        fakeMarker,
        color,
        headAlpha,
        tailAlpha,
        headColor: rgba(color, headAlpha),
        tailColor: rgba(color, tailAlpha),
        yHead,
        yTail,
    }
}

export const createConnectorRenderer = () => {
    // Entity keys are immutable and weak: deleted charts and old undo states do
    // not leave native paths permanently retained by the renderer. Each entity
    // keeps only its most recent zoom/BPM geometry.
    let graphics = new WeakMap<ConnectorEntity, ConnectorGraphic>()

    return {
        draw(
            context: EditorDrawContext,
            entity: ConnectorEntity,
            _highlighted: boolean,
            opacity = 1,
        ) {
            if (opacity <= 0 || !isConnectorVisible(entity)) return

            const { ctx, state, ups, scale } = context
            let graphic = graphics.get(entity)
            if (graphic?.bpms !== state.bpms || graphic.ups !== ups) {
                graphic = createGraphic(entity, state.bpms, ups)
                graphics.set(entity, graphic)
            }

            ctx.save()
            if (graphic.headAlpha === graphic.tailAlpha) {
                ctx.globalAlpha = opacity * clamp(graphic.headAlpha)
                ctx.fillStyle = graphic.color
            } else {
                // Like the path, gradient coordinates follow the drawing
                // transform, so panning can reuse the native gradient object.
                if (!graphic.gradient) {
                    graphic.gradient = ctx.createLinearGradient(0, graphic.yHead, 0, graphic.yTail)
                    graphic.gradient.addColorStop(0, graphic.headColor)
                    graphic.gradient.addColorStop(1, graphic.tailColor)
                }
                ctx.globalAlpha = opacity
                ctx.fillStyle = graphic.gradient
            }
            ctx.fill(graphic.path)

            if (graphic.fakeMarker) {
                ctx.globalAlpha = opacity * 0.8
                ctx.strokeStyle = '#f44'
                ctx.lineWidth = 2 / scale
                ctx.setLineDash([])
                ctx.stroke(graphic.fakeMarker)
            }
            ctx.restore()
        },
        clear() {
            graphics = new WeakMap()
        },
    }
}
