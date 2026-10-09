import type { StageProps, Transition } from '../../preview/engine/stage'
import { timeToBeat } from '../../state/integrals/bpms'
import { clamp, lerp } from '../../utils/math'
import type { Range } from '../../utils/range'
import type { ScopeLookup } from '../scopeRules'
import { sampleComposed } from './composedSampling'
import type { EditorDrawContext } from './types'

type StagePoint = StageProps & { left: number; right: number; size: number; time: number }

const borderWidth = (style: Transition<number>, scale: number) => {
    const width = (value: number) => (value === 2 ? 0 : value === 1 ? 1 : value === 3 ? 2 : 3)
    return Math.max(0, lerp(width(style.start), width(style.end), style.progress)) / scale
}

const drawSlice = (
    context: EditorDrawContext,
    a: StagePoint,
    b: StagePoint,
    opacity: number,
    laneDivision: number,
    gridOffset: number,
) => {
    const { ctx, ups, scale, bounds } = context
    const alpha = clamp((a.laneAlpha * (1 - a.fullWidth) + b.laneAlpha * (1 - b.fullWidth)) / 2)
    if (alpha <= 0 || (a.size <= 0 && b.size <= 0)) return
    const yA = a.time * ups
    const yB = b.time * ups
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(a.left, yA)
    ctx.lineTo(b.left, yB)
    ctx.lineTo(b.right, yB)
    ctx.lineTo(a.right, yA)
    ctx.closePath()
    ctx.globalAlpha = opacity * alpha * 0.16
    ctx.fillStyle = '#83b6d0'
    ctx.fill()
    ctx.clip()

    // Divider sets crossfade when their spacing or parity changes. The mask clips
    // each slanted line, including a divider entering or leaving a moving edge.
    const division = b.division
    const same =
        division.start.size === division.end.size && division.start.parity === division.end.parity
    const progress =
        a.division.start.size === division.start.size &&
        a.division.end.size === division.end.size &&
        a.division.start.parity === division.start.parity &&
        a.division.end.parity === division.end.parity
            ? (a.division.progress + division.progress) / 2
            : division.progress
    const sets = same
        ? [{ ...division.start, alpha: 1 }]
        : [
              { ...division.start, alpha: clamp(1 - progress) },
              { ...division.end, alpha: clamp(progress) },
          ]
    ctx.strokeStyle = '#b4d6e8'
    ctx.lineWidth = 1 / scale
    const drawLines = (spacing: number, parity: number, lineAlpha: number) => {
        if (lineAlpha <= 0) return
        const pivotA = a.pivotLane + a.xLaneTranslate + parity
        const pivotB = b.pivotLane + b.xLaneTranslate + parity
        const min = Math.floor(
            Math.min(
                (Math.max(a.left, bounds.l) - pivotA) / spacing,
                (Math.max(b.left, bounds.l) - pivotB) / spacing,
            ),
        )
        const max = Math.ceil(
            Math.max(
                (Math.min(a.right, bounds.r) - pivotA) / spacing,
                (Math.min(b.right, bounds.r) - pivotB) / spacing,
            ),
        )
        ctx.globalAlpha = opacity * alpha * lineAlpha
        ctx.beginPath()
        for (let count = 0; count <= max - min && count < 2048; count++) {
            const index = min + count
            ctx.moveTo(pivotA + index * spacing, yA)
            ctx.lineTo(pivotB + index * spacing, yB)
        }
        ctx.stroke()
    }
    // Authoring subdivisions follow the dominant division's parity. Each strip
    // is split at parity switches, so a constant midpoint phase avoids inventing
    // diagonal guides between two discrete lattices during a crossfade.
    if (Number.isFinite(laneDivision) && laneDivision > 0 && scale / laneDivision >= 8) {
        drawLines(
            1 / laneDivision,
            gridOffset,
            clamp((a.divisionLineAlpha + b.divisionLineAlpha) / 2) * 0.1,
        )
    }
    for (const set of sets) {
        if (set.size <= 0 || set.size * scale < 2 || set.alpha <= 0) continue
        drawLines(
            set.size,
            set.parity ? set.size / 2 : 0,
            clamp((a.divisionLineAlpha + b.divisionLineAlpha) / 2) * set.alpha * 0.4,
        )
    }
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = opacity * alpha * 0.65
    ctx.strokeStyle = '#b4d6e8'
    for (const side of ['left', 'right'] as const) {
        const style = side === 'left' ? 'leftBorderStyle' : 'rightBorderStyle'
        const width = (borderWidth(a[style], scale) + borderWidth(b[style], scale)) / 2
        if (width <= 0) continue
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(a[side], yA)
        ctx.lineTo(b[side], yB)
        ctx.stroke()
    }
    ctx.restore()
}

/** The engine Preview's mask shapes and pivot-relative divisions in editor coordinates. */
export const drawComposedStages = (
    context: EditorDrawContext,
    beats: Range<number>,
    scope: ScopeLookup,
    laneDivision = 1,
) => {
    const { composed } = context
    if (!composed) return
    for (const [id, data] of composed.stages) {
        const visibility = scope.stage(id)
        if (visibility === 'hidden') continue
        const from = Math.max(0, beats.min, data.startBeat)
        const to = Math.min(beats.max, data.endBeat)
        if (!(to > from)) continue
        const breaks = [from, ...data.breakpoints.filter((beat) => from < beat && beat < to), to]
        const strips = sampleComposed(
            context.state.bpms,
            breaks,
            (beat, rightLimit) => {
                const props = composed.stage(id, beat, { rightLimit })
                if (!props) throw new Error('Composed stage missing from its layout')
                return { ...props, size: props.right - props.left }
            },
            {
                coordinates: (point) => [point.pivotLane + point.xLaneTranslate],
                maxTimeStep: 8 / Math.abs(context.scale * context.ups),
            },
        )
        for (const points of strips) {
            const first = points[0]
            const last = points.at(-1)
            if (!first || !last) continue
            // Evaluate the actual eased midpoint. Averaging endpoint progress
            // can pick the wrong side near an oscillating ease's discontinuity.
            const gridOffset = composed.gridOffset(
                id,
                timeToBeat(context.state.bpms, (first.time + last.time) / 2),
            )
            for (let index = 1; index < points.length; index++) {
                const previous = points[index - 1]
                const current = points[index]
                if (!previous || !current) continue
                drawSlice(
                    context,
                    previous,
                    current,
                    visibility === 'dimmed' ? 0.25 : 1,
                    laneDivision,
                    gridOffset,
                )
            }
        }
    }
}
