import { ease, easeMode, isStepEase, sampleEase, type Ease } from '../../ease'
import type { ConnectorEntity } from '../../state/entities/slides/connector'
import { beatToTime, type BpmIntegral } from '../../state/integrals/bpms'
import { clamp, lerp, remap, unlerp } from '../../utils/math'
import { isConnectorVisible } from '../entities/visibility'
import { connectorColors } from '../utils/connectorColors'
import type { EditorDrawContext } from './types'

type Edge = { time: number; left: number; size: number }

type ConnectorGraphic = {
    bpms: BpmIntegral[]
    ups: number
    path: Path2D
    edges?: Path2D
    edgeColor?: string
    maxEdgeWidth: number
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
    connectorEase: 'inQuad' | 'outQuad',
    ups: number,
    edges: Path2D | undefined,
) => {
    const pHead = unlerp(attachHead.time, attachTail.time, tHead)
    const pTail = unlerp(attachHead.time, attachTail.time, tTail)
    const qHead = ease(connectorEase, pHead)
    const qTail = ease(connectorEase, pTail)
    const qMid = connectorEase === 'inQuad' ? pHead * pTail : 1 - (1 - pHead) * (1 - pTail)

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

    edges?.moveTo(lHead, yHead)
    edges?.quadraticCurveTo(lMid, yMid, lTail, yTail)
    edges?.moveTo(lHead + sHead, yHead)
    edges?.quadraticCurveTo(lMid + sMid, yMid, lTail + sTail, yTail)
}

const appendCurve = (
    path: Path2D,
    attachHead: Edge,
    attachTail: Edge,
    tHead: number,
    tTail: number,
    connectorEase: Ease,
    ups: number,
    edges: Path2D | undefined,
) => {
    const span = Math.max(
        Math.abs(attachTail.left - attachHead.left),
        Math.abs(attachTail.left + attachTail.size - attachHead.left - attachHead.size),
    )
    const points = sampleEase(
        connectorEase,
        unlerp(attachHead.time, attachTail.time, tHead),
        unlerp(attachHead.time, attachTail.time, tTail),
        CURVE_TOLERANCE / Math.max(span, CURVE_TOLERANCE),
    ).map((p) => {
        const q = ease(connectorEase, p)
        // Overshooting sizes collapse to the center instead of turning inside out.
        const size = lerp(attachHead.size, attachTail.size, q)
        return {
            left: lerp(attachHead.left, attachTail.left, q) + Math.min(size, 0) / 2,
            size: Math.max(size, 0),
            y: lerp(attachHead.time, attachTail.time, p) * ups,
        }
    })

    for (const [index, { left, y }] of points.entries()) {
        if (index) {
            path.lineTo(left, y)
            edges?.lineTo(left, y)
        } else {
            path.moveTo(left, y)
            edges?.moveTo(left, y)
        }
    }
    for (const [index, { left, size, y }] of [...points].reverse().entries()) {
        path.lineTo(left + size, y)
        if (index) {
            edges?.lineTo(left + size, y)
        } else {
            edges?.moveTo(left + size, y)
        }
    }
    path.closePath()
}

const appendConstant = (
    path: Path2D,
    { left, size }: Omit<Edge, 'time'>,
    yHead: number,
    yTail: number,
    edges: Path2D | undefined,
) => {
    path.rect(left, yTail, size, yHead - yTail)
    edges?.moveTo(left, yHead)
    edges?.lineTo(left, yTail)
    edges?.moveTo(left + size, yHead)
    edges?.lineTo(left + size, yTail)
}

// Steps hold their interior value; in-out steps jump at the attachment midpoint.
const appendStep = (
    path: Path2D,
    attachHead: Edge,
    attachTail: Edge,
    tHead: number,
    tTail: number,
    connectorEase: Ease,
    ups: number,
    edges: Path2D | undefined,
) => {
    const at = (q: number) => ({
        left: lerp(attachHead.left, attachTail.left, q),
        size: lerp(attachHead.size, attachTail.size, q),
    })
    const tMiddle = (attachHead.time + attachTail.time) / 2
    if (easeMode(connectorEase) === 'inOut' && tHead < tMiddle && tMiddle < tTail) {
        appendConstant(path, attachHead, tHead * ups, tMiddle * ups, edges)
        appendConstant(path, attachTail, tMiddle * ups, tTail * ups, edges)
        return
    }

    const p = unlerp(attachHead.time, attachTail.time, (tHead + tTail) / 2)
    appendConstant(path, at(ease(connectorEase, p)), tHead * ups, tTail * ups, edges)
}

const safeUnlerp = (a: number, b: number, x: number, fallback: number) =>
    Math.abs(a - b) < 1e-6 ? fallback : unlerp(a, b, x)

// Like the engine, a piece between attached notes eases between its own ends, so equal
// eased ends give a straight piece. Steps hold one value per piece.
const appendAttachedPiece = (
    path: Path2D,
    attachHead: Edge,
    attachTail: Edge,
    tHead: number,
    tTail: number,
    connectorEase: Ease,
    ups: number,
    edges: Path2D | undefined,
) => {
    const fHead = safeUnlerp(attachHead.time, attachTail.time, tHead, 0.5)
    const fTail = safeUnlerp(attachHead.time, attachTail.time, tTail, 0.5)
    // Attached notes sit on the curve at their time, with sizes floored at 0 about their centers.
    const edgeAt = (f: number) => {
        const q = ease(connectorEase, f)
        const size = lerp(attachHead.size, attachTail.size, q)
        return {
            left: lerp(attachHead.left, attachTail.left, q) + Math.min(size, 0) / 2,
            size: Math.max(size, 0),
        }
    }
    const head = edgeAt(fHead)
    const tail = edgeAt(fTail)
    const pinned = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : ease(connectorEase, f))
    const interpFrac = (f: number, fallback: number) =>
        connectorEase === 'inStep'
            ? 0
            : safeUnlerp(pinned(fHead), pinned(fTail), ease(connectorEase, f), fallback)
    const at = (interp: number) => {
        const size = lerp(head.size, tail.size, interp)
        return {
            left: lerp(head.left, tail.left, interp) + Math.min(size, 0) / 2,
            size: Math.max(size, 0),
        }
    }

    if (isStepEase(connectorEase)) {
        const constant = (from: number, to: number, tFrom: number, tTo: number) => {
            appendConstant(path, at(interpFrac((from + to) / 2, 0)), tFrom * ups, tTo * ups, edges)
        }
        if (connectorEase === 'inOutStep' && fHead < 0.5 && 0.5 < fTail) {
            const tSplit = lerp(tHead, tTail, (0.5 - fHead) / (fTail - fHead))
            constant(fHead, 0.5, tHead, tSplit)
            constant(0.5, fTail, tSplit, tTail)
        } else {
            constant(fHead, fTail, tHead, tTail)
        }
        return
    }

    const span = Math.max(
        Math.abs(tail.left - head.left),
        Math.abs(tail.left + tail.size - head.left - head.size),
    )
    const points = sampleEase(
        connectorEase,
        fHead,
        fTail,
        CURVE_TOLERANCE / Math.max(span, CURVE_TOLERANCE),
    ).map((f) => ({
        ...at(interpFrac(f, safeUnlerp(fHead, fTail, f, 0))),
        y: lerp(attachHead.time, attachTail.time, f) * ups,
    }))
    for (const [index, { left, y }] of points.entries()) {
        if (index) {
            path.lineTo(left, y)
            edges?.lineTo(left, y)
        } else {
            path.moveTo(left, y)
            edges?.moveTo(left, y)
        }
    }
    for (const [index, { left, size, y }] of [...points].reverse().entries()) {
        path.lineTo(left + size, y)
        if (index) {
            edges?.lineTo(left + size, y)
        } else {
            edges?.moveTo(left + size, y)
        }
    }
    path.closePath()
}

const CURVE_TOLERANCE = 0.01

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
    const colors = connectorColors(segmentHead)
    const edges = colors.edge ? new Path2D() : undefined
    const first = { time: tAttachHead, left: attachHead.left, size: attachHead.size }
    const last = { time: tAttachTail, left: attachTail.left, size: attachTail.size }

    const attached = head.isAttached || tail.isAttached
    if (attached)
        appendAttachedPiece(path, first, last, tHead, tTail, attachHead.connectorEase, ups, edges)
    const pieceEase = attached ? undefined : attachHead.connectorEase
    // Linear and quadratic eases are exact; the rest are sampled.
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
    switch (pieceEase) {
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
            edges?.moveTo(lHead, yHead)
            edges?.lineTo(lTail, yTail)
            edges?.moveTo(lHead + sHead, yHead)
            edges?.lineTo(lTail + sTail, yTail)
            break
        }
        case 'inQuad':
        case 'outQuad':
            appendEase(path, first, last, tHead, tTail, pieceEase, ups, edges)
            break
        case 'inOutQuad':
        case 'outInQuad': {
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
                    pieceEase === 'inOutQuad' ? 'inQuad' : 'outQuad',
                    ups,
                    edges,
                )
            }
            if (tTail > middle.time) {
                appendEase(
                    path,
                    middle,
                    last,
                    Math.max(tHead, middle.time),
                    tTail,
                    pieceEase === 'inOutQuad' ? 'outQuad' : 'inQuad',
                    ups,
                    edges,
                )
            }
            break
        }
        case undefined:
            break
        default: {
            const append = isStepEase(pieceEase) ? appendStep : appendCurve
            append(path, first, last, tHead, tTail, pieceEase, ups, edges)
        }
    }

    const color = colors.body
    let headAlpha: number
    let tailAlpha: number
    if (segmentHead.connectorType === 'guide') {
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
        edges,
        edgeColor: colors.edge,
        maxEdgeWidth: Math.min(first.size, last.size) * 0.12,
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

            // Only the two sides are outlined: segment boundaries and compound
            // easing midpoints must not acquire horizontal seams. Cap the width
            // for narrow connectors so their selected color remains visible.
            if (graphic.edges && graphic.edgeColor && graphic.maxEdgeWidth > 0) {
                ctx.save()
                // Strokes straddle their paths. Keep the shading inside the
                // connector, including the head/tail cuts of slanted curves.
                ctx.clip(graphic.path)
                ctx.strokeStyle = graphic.edgeColor
                ctx.lineWidth = Math.min(3 / scale, graphic.maxEdgeWidth)
                ctx.lineCap = 'butt'
                ctx.setLineDash([])
                ctx.stroke(graphic.edges)
                ctx.restore()
            }

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
