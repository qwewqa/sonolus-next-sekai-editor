import { beatToTime } from '../../state/integrals/bpms'
import { formatIntegerBeat, formatIntegerTime } from '../../utils/format'
import type { Range } from '../../utils/range'
import { drawText } from './text'
import type { EditorDrawContext } from './types'

export const drawGrid = (
    context: EditorDrawContext,
    beats: Range<number>,
    times: Range<number>,
    division: number,
) => {
    const { ctx, bounds, scale, state, ups } = context
    ctx.save()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2 / scale
    // Batch disjoint grid lines with the same opacity into a single stroke.
    for (const alpha of [0.5, 0.25, 0.05]) {
        ctx.globalAlpha = alpha
        ctx.beginPath()
        for (let i = 1; i <= 13; i++) {
            if ((i === 1 || i === 13 ? 0.5 : i % 2 ? 0.25 : 0.05) !== alpha) continue
            ctx.moveTo(i - 7, Math.min(0, bounds.b))
            ctx.lineTo(i - 7, bounds.t)
        }
        ctx.stroke()
    }

    const min = Math.ceil(beats.min * division)
    const max = Math.floor(beats.max * division)
    if (max - min <= 100) {
        for (const isBeat of [false, true]) {
            ctx.globalAlpha = isBeat ? 0.5 : 0.25
            ctx.beginPath()
            for (let i = min; i <= max; i++) {
                if ((i % division === 0) !== isBeat) continue
                const y = beatToTime(state.bpms, i / division) * ups
                ctx.moveTo(-6, y)
                ctx.lineTo(6, y)
            }
            ctx.stroke()
        }
    }

    ctx.globalAlpha = 0.5
    for (let beat = Math.max(1, Math.ceil(beats.min)); beat <= beats.max; beat++) {
        drawText(
            context,
            formatIntegerBeat(beat),
            6.1,
            beatToTime(state.bpms, beat) * ups,
            '#fff',
            0.4,
            'start',
        )
    }
    for (let time = Math.max(1, Math.ceil(times.min)); time <= times.max; time++) {
        drawText(context, formatIntegerTime(time), -6.1, time * ups, '#fff', 0.4, 'end')
    }
    ctx.restore()
}
