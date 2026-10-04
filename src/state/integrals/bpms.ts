import { findIntegral, integrate, type Integral } from '.'
import { type Chart } from '../../chart'
import { type BpmObject } from '../../chart/bpm'
import { bisect } from '../../utils/ordered'

export type BpmIntegral = Integral & {
    meter: number
    measure: number
    measureBeat: number
}

export const createBpms = (chart: Chart) => calculateBpms(chart.bpms.map(toBpmIntegral))

export const calculateBpms = (bpms: (Integral & { meter?: number })[]): BpmIntegral[] => {
    let meter = 4
    let measure = 0
    let measureBeat = 0
    return integrate(bpms.sort((a, b) => a.x - b.x)).map((integral) => {
        measure += Math.ceil(roundBoundary((integral.x - measureBeat) / meter))
        measureBeat = integral.x
        meter = integral.meter ?? 4
        return { ...integral, meter, measure, measureBeat }
    })
}

export const toBpmIntegral = (object: BpmObject): BpmIntegral => ({
    x: object.beat,
    y: 0,
    s: 60 / object.bpm,
    meter: object.meter ?? 4,
    measure: 0,
    measureBeat: 0,
})

const roundBoundary = (value: number) =>
    Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : value

export const beatToMeasure = (bpms: BpmIntegral[], beat: number) => {
    const { meter, measure, measureBeat } = findIntegral(bpms, 'x', beat)
    const position = roundBoundary((beat - measureBeat) / meter)
    const offset = Math.floor(position)
    return { measure: measure + offset + 1, beat: (position - offset) * meter + 1 }
}

export const getMeasureBeats = (bpms: BpmIntegral[], min: number, max: number, limit = 100) => {
    const beats: number[] = []
    const index = bisect(bpms, 'x', min)
    for (let i = Math.max(0, bpms[index]?.x === min ? index : index - 1); i < bpms.length; i++) {
        const integral = bpms[i]
        if (!integral || integral.x > max) break
        const next = bpms[i + 1]?.x ?? Number.POSITIVE_INFINITY
        const first = Math.max(0, Math.ceil(roundBoundary((min - integral.x) / integral.meter)))
        for (let measure = first; ; measure++) {
            const beat = integral.x + measure * integral.meter
            if (beat > max || beat >= next) break
            if (beats.length === limit) return []
            beats.push(beat)
        }
    }
    return beats
}

export const beatToTime = (bpms: Integral[], beat: number) => {
    const { x, y, s } = findIntegral(bpms, 'x', beat)

    return y + (beat - x) * s
}

export const timeToBeat = (bpms: Integral[], time: number) => {
    const { x, y, s } = findIntegral(bpms, 'y', time)

    return x + (time - y) / s
}
