import type { PreviewChart, PreviewNote } from './model'
import { createTimeIndex } from './timeIndex'

export const CONNECTOR_THROUGH_JUDGE_LINE_DESPAWN_DELAY = 5
export const SLIDE_EFFECT_DESPAWN_DELAY = 0.6
export const MAX_HIT_EFFECT_DURATION = 1

// Attached notes interpolate their endpoints' progress. Either endpoint can
// bring them into view well before the attached note's own approach window.
const earliestTarget = (note: PreviewNote) =>
    note.isAttached && note.attachHead && note.attachTail
        ? Math.min(note.targetTime, note.attachHead.targetTime, note.attachTail.targetTime)
        : note.targetTime

const createFrameIndex = (chart: PreviewChart) => {
    let minimumTimescale = 1
    for (const group of chart.groups) {
        for (const change of group.changes) {
            // Scroll, reversals, stops and backwards skips need the full future
            // range: target time alone cannot bound their visual position.
            if (change.transitionStyle === 1 || change.skipSeconds < 0 || !(change.timescale > 0)) {
                minimumTimescale = 0
                break
            }
            minimumTimescale = Math.min(minimumTimescale, change.timescale)
        }
    }
    return {
        minimumTimescale,
        notes: createTimeIndex(chart.notes, earliestTarget, (note) => note.targetTime),
        effects: createTimeIndex(
            chart.notes,
            (note) => note.targetTime,
            (note) => note.targetTime + MAX_HIT_EFFECT_DURATION,
        ),
        connectors: createTimeIndex(
            chart.connectors,
            (connector) => Math.min(earliestTarget(connector.head), earliestTarget(connector.tail)),
            (connector) =>
                Math.min(
                    Math.max(connector.head.targetTime, connector.tail.targetTime) +
                        (connector.throughJudgeLine
                            ? CONNECTOR_THROUGH_JUDGE_LINE_DESPAWN_DELAY
                            : 0),
                    connector.activeTail?.targetTime ?? Infinity,
                ),
        ),
        simLines: createTimeIndex(
            chart.simLines,
            ({ left, right }) => Math.min(earliestTarget(left), earliestTarget(right)),
            ({ left, right }) => Math.min(left.targetTime, right.targetTime),
        ),
        slides: createTimeIndex(
            chart.slides,
            (slide) => slide.activeHead.targetTime,
            (slide) => slide.activeTail.targetTime + SLIDE_EFFECT_DESPAWN_DELAY,
        ),
    }
}

const indexes = new WeakMap<PreviewChart, ReturnType<typeof createFrameIndex>>()

export const getFrameIndex = (chart: PreviewChart) => {
    let index = indexes.get(chart)
    if (!index) {
        index = createFrameIndex(chart)
        indexes.set(chart, index)
    }
    return index
}

export const latestVisibleTarget = (
    now: number,
    minimumTimescale: number,
    maximumPreempt: number,
    progressStart: number,
    minimumYOffset: number,
) => {
    if (minimumTimescale <= 0 || !Number.isFinite(maximumPreempt)) return Infinity
    const distance = maximumPreempt * Math.max(0, 1 - progressStart - minimumYOffset)
    // noteDistance clamps its result, so that clamp is not an upper time bound.
    if (distance >= 1e20) return Infinity
    return now + distance / minimumTimescale + 1e-7
}
