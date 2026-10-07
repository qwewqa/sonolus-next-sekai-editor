import type { State } from '../../state'
import type { Entity } from '../../state/entities'
import { beatToTime, getMeasureBeats } from '../../state/integrals/bpms'
import { formatIntegerTime } from '../../utils/format'
import type { Range } from '../../utils/range'
import { formatBeatPosition, type BeatDisplay } from '../beatDisplay'
import type { LabelBox } from '../edgeLabels'
import { timeScaleLabel } from './events'
import { drawText, measureText } from './text'
import type { EdgeLabelYs, EditorDrawContext } from './types'

// Half the beat or time (0.4) and BPM or time scale (0.5) label sizes.
const LABEL_CLEARANCE = 0.45

/** Where drawn time scale labels cross into the time and beat columns, past lanes -6.1 and 6.1. */
export const timeScaleEdgeLabelYs = (
    context: EditorDrawContext,
    steps: { entity: Entity; part?: 'line' | 'marker' }[],
): EdgeLabelYs => {
    const ys: EdgeLabelYs = { left: [], right: [] }
    for (const { entity, part } of steps) {
        if (entity.type !== 'timeScale' || part === 'line') continue
        const label = timeScaleLabel(context, entity)
        if (!label) continue
        const y = beatToTime(context.state.bpms, entity.beat) * context.ups
        if (label.min < -6.1) ys.left.push(y)
        if (label.max > 6.1) ys.right.push(y)
    }
    return ys
}

/** The time (left) and beat (right) labels the grid draws, by text and y. */
const gridLabels = (
    state: State,
    ups: number,
    beats: Range<number>,
    times: Range<number>,
    beatDisplay: BeatDisplay,
) => {
    const left: { text: string; y: number }[] = []
    for (let time = Math.max(1, Math.ceil(times.min)); time <= times.max; time++)
        left.push({ text: formatIntegerTime(time), y: time * ups })
    const right: { text: string; y: number }[] = []
    for (let beat = Math.max(1, Math.ceil(beats.min)); beat <= beats.max; beat++)
        right.push({
            text: formatBeatPosition(state.bpms, beat, beatDisplay),
            y: beatToTime(state.bpms, beat) * ups,
        })
    return { left, right }
}

/** The ys of the time and beat labels under the given boxes, in pane pixels. */
export const coveredLabelYs = (
    context: EditorDrawContext,
    beats: Range<number>,
    times: Range<number>,
    beatDisplay: BeatDisplay,
    boxes: { left: LabelBox[]; right: LabelBox[] },
): EdgeLabelYs => {
    const { bounds, scale, state, ups } = context
    const labels = gridLabels(state, ups, beats, times, beatDisplay)
    // A label's box in pane pixels: drawn from `edge` toward `align`, 0.4 tall.
    const covered = (
        boxes: LabelBox[],
        { text, y }: { text: string; y: number },
        edge: number,
        align: 'start' | 'end',
    ) => {
        const top = (y - 0.2 - bounds.t) * scale
        const bottom = (y + 0.2 - bounds.t) * scale
        // Measure only labels in a box's band.
        const band = boxes.filter((box) => box.top < bottom && box.bottom > top)
        if (!band.length) return false
        const width = measureText(context, text)
        const left = ((align === 'start' ? edge : edge - width) - bounds.l) * scale
        const right = left + width * scale
        return band.some((box) => box.left < right && box.right > left)
    }
    return {
        left: labels.left
            .filter((label) => covered(boxes.left, label, -6.1, 'end'))
            .map(({ y }) => y),
        right: labels.right
            .filter((label) => covered(boxes.right, label, 6.1, 'start'))
            .map(({ y }) => y),
    }
}

export const drawGrid = (
    context: EditorDrawContext,
    beats: Range<number>,
    times: Range<number>,
    division: number,
    laneDivision = 1,
    beatDisplay: BeatDisplay = 'measure',
    isBpmVisible = false,
    edgeLabelYs: EdgeLabelYs = { left: [], right: [] },
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

    if (laneDivision > 1 && scale / laneDivision >= 8 && laneDivision <= 32) {
        ctx.globalAlpha = 0.025
        ctx.beginPath()
        for (let i = -6 * laneDivision; i <= 6 * laneDivision; i++) {
            if (i % laneDivision === 0) continue
            const lane = i / laneDivision
            ctx.moveTo(lane, Math.min(0, bounds.b))
            ctx.lineTo(lane, bounds.t)
        }
        ctx.stroke()
    }

    const min = Math.ceil(beats.min * division)
    const max = Math.floor(beats.max * division)
    const showMeasures = beatDisplay !== 'beat'
    if (max - min <= 100) {
        for (const isBeat of [false, true]) {
            ctx.globalAlpha = showMeasures ? (isBeat ? 0.35 : 0.15) : isBeat ? 0.5 : 0.25
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

    if (showMeasures) {
        ctx.globalAlpha = 0.7
        ctx.lineWidth = 3 / scale
        ctx.beginPath()
        for (const beat of getMeasureBeats(state.bpms, beats.min, beats.max)) {
            const y = beatToTime(state.bpms, beat) * ups
            ctx.moveTo(-6, y)
            ctx.lineTo(6, y)
        }
        ctx.stroke()
    }

    ctx.globalAlpha = 0.5
    // A BPM or edge time scale label takes the place of the beat or time labels
    // it would overlap.
    const bpmYs = isBpmVisible
        ? state.bpms
              .filter(({ x }) => x > beats.min - 1 && x < beats.max + 1)
              .map(({ x }) => beatToTime(state.bpms, x) * ups)
        : []
    const beatYs = [...bpmYs, ...edgeLabelYs.right]
    const near = (ys: number[], y: number) =>
        ys.some((other) => Math.abs(y - other) < LABEL_CLEARANCE)
    const labels = gridLabels(state, ups, beats, times, beatDisplay)
    for (const { text, y } of labels.right) {
        if (near(beatYs, y)) continue
        drawText(context, text, 6.1, y, '#fff', 0.4, 'start', context.figureMiddle)
    }
    for (const { text, y } of labels.left) {
        if (near(edgeLabelYs.left, y)) continue
        drawText(context, text, -6.1, y, '#fff', 0.4, 'end', context.figureMiddle)
    }
    ctx.restore()
}
