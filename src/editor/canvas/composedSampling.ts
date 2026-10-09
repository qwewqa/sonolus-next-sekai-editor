import type { BpmIntegral } from '../../state/integrals/bpms'
import { beatToTime, timeToBeat } from '../../state/integrals/bpms'

export type ComposedSample = { time: number; left: number; size: number }

/** Sample smooth stretches separately, retaining both limits at every event jump. */
export const sampleComposed = <T extends { left: number; size: number }>(
    bpms: BpmIntegral[],
    breaks: readonly number[],
    at: (beat: number, rightLimit: boolean) => T,
    options: { coordinates?: (point: T) => readonly number[]; maxTimeStep?: number } = {},
): (T & { time: number })[][] => {
    const strips: (T & { time: number })[][] = []
    const sample = (time: number, rightLimit: boolean) => ({
        ...at(timeToBeat(bpms, time), rightLimit),
        time,
    })
    for (let index = 1; index < breaks.length; index++) {
        const fromBeat = breaks[index - 1]
        const toBeat = breaks[index]
        if (fromBeat === undefined || toBeat === undefined) continue
        const from = beatToTime(bpms, fromBeat)
        const to = beatToTime(bpms, toBeat)
        if (!(to > from)) continue
        let previous = { ...at(fromBeat, true), time: from }
        const points = [previous]
        const append = (a: T & { time: number }, b: T & { time: number }, depth: number) => {
            const middle = sample((a.time + b.time) / 2, false)
            let error = Math.max(
                Math.abs(middle.left - (a.left + b.left) / 2),
                Math.abs(middle.left + middle.size - (a.left + a.size + b.left + b.size) / 2),
            )
            if (options.coordinates) {
                const aValues = options.coordinates(a)
                const bValues = options.coordinates(b)
                const middleValues = options.coordinates(middle)
                for (const [index, value] of middleValues.entries()) {
                    const start = aValues[index]
                    const end = bValues[index]
                    if (start === undefined || end === undefined) continue
                    error = Math.max(error, Math.abs(value - (start + end) / 2))
                }
            }
            if (
                (error > 0.01 || b.time - a.time > (options.maxTimeStep ?? Infinity)) &&
                depth < 10
            ) {
                append(a, middle, depth + 1)
                append(middle, b, depth + 1)
            } else points.push(b)
        }
        // Seed oscillating and compound eases so a coincident midpoint cannot hide a curve.
        for (let seed = 1; seed <= 16; seed++) {
            const next =
                seed === 16
                    ? { ...at(toBeat, false), time: to }
                    : sample(from + ((to - from) * seed) / 16, false)
            append(previous, next, 0)
            previous = next
        }
        strips.push(points)
    }
    return strips
}
