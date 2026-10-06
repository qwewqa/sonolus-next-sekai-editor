import { approach, tiltWidthFactor, type PreviewLayout } from './layout'
import { EaseType, clamp, ease, lerp, safeUnlerp, type EaseTypeValue } from './math'

// sekai/lib/connector.py connector_curve_detail and circular_connector_fracs.

export const CONNECTOR_CURVE_ERROR = 2 * (2.5 / 1080)

const CURVE_BINS = 16
const CURVE_BIN_SAMPLES = 16
const CURVE_LEVELS = 5
const CURVE_TABLE_SIZE = Array.from(
    { length: CURVE_LEVELS },
    (_, level) => CURVE_BINS - 2 ** level + 1,
).reduce((a, b) => a + b, 0)

const isCurved = (easeType: number) =>
    easeType >= EaseType.linear && easeType <= EaseType.outInElastic

// The engine stores the table in its ROM as 32-bit floats.
const curveDerivativeBounds = (() => {
    const values: number[] = []
    const h = 1e-4
    for (let easeType = 0; easeType <= EaseType.outInStep; easeType++) {
        const type = easeType as EaseTypeValue
        for (const order of [1, 2]) {
            const runs: number[] = []
            for (let i = 0; i < CURVE_BINS; i++) {
                let largest = 0
                for (let j = 0; j <= CURVE_BIN_SAMPLES; j++) {
                    let x = clamp((i + j / CURVE_BIN_SAMPLES) / CURVE_BINS, 1e-3, 1 - 1e-3)
                    if (
                        (type === EaseType.outInExpo || type === EaseType.outInElastic) &&
                        x === 0.5
                    )
                        x = i < CURVE_BINS / 2 ? 0.5 - 2 * h : 0.5 + 2 * h
                    let derivative = 0
                    if (isCurved(type)) {
                        const before = ease(type, x - h)
                        const at = ease(type, x)
                        const after = ease(type, x + h)
                        derivative =
                            order === 1
                                ? (after - before) / (2 * h)
                                : (after - 2 * at + before) / (h * h)
                    }
                    largest = Math.max(largest, Math.abs(derivative))
                }
                runs.push(largest)
            }
            const levels = [runs]
            for (;;) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const previous = levels[levels.length - 1]!
                if (previous.length <= 1) break
                const width = 2 ** (levels.length - 1)
                levels.push(
                    Array.from({ length: previous.length - width }, (_, i) =>
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        Math.max(previous[i]!, previous[i + width]!),
                    ),
                )
            }
            for (const level of levels) for (const value of level) values.push(Math.fround(value))
        }
    }
    return Float64Array.from(values)
})()

export const easeDerivativeBound = (
    easeType: EaseTypeValue,
    order: 1 | 2,
    start: number,
    end: number,
) => {
    const first = clamp(Math.floor(start * CURVE_BINS), 0, CURVE_BINS - 1)
    const last = clamp(Math.ceil(end * CURVE_BINS) - 1, first, CURVE_BINS - 1)
    let run = 1
    let offset = 0
    while (run * 2 <= last - first + 1) {
        offset += CURVE_BINS - run + 1
        run *= 2
    }
    const base = (easeType * 2 + order - 1) * CURVE_TABLE_SIZE + offset
    return Math.max(
        curveDerivativeBounds[base + first] ?? 0,
        curveDerivativeBounds[base + last - run + 1] ?? 0,
    )
}

export const connectorCurveDetail = (
    layout: PreviewLayout,
    easeType: EaseTypeValue,
    headEased: number,
    tailEased: number,
    startEaseFrac: number,
    endEaseFrac: number,
    leftChange: number,
    rightChange: number,
    startTravel: number,
    endTravel: number,
) => {
    if (
        !(easeType >= EaseType.linear && easeType < EaseType.inStep) ||
        (leftChange === 0 && rightChange === 0) ||
        Math.abs(tailEased - headEased) < 1e-6 ||
        Math.min(startTravel, endTravel) <= 0
    )
        return 0
    const start = Math.min(startEaseFrac, endEaseFrac)
    const end = Math.max(startEaseFrac, endEaseFrac)
    const span = end - start
    const laneChange =
        Math.max(Math.abs(leftChange), Math.abs(rightChange)) / Math.abs(tailEased - headEased)
    const approachRate = Math.abs(Math.log(endTravel / startTravel))
    const width = tiltWidthFactor(layout, Math.max(startTravel, endTravel)) * layout.wScale
    const bend =
        span * easeDerivativeBound(easeType, 2, start, end) +
        approachRate * easeDerivativeBound(easeType, 1, start, end)
    return Math.sqrt((width * laneChange * span * bend) / (8 * CONNECTOR_CURVE_ERROR))
}

export const circularConnectorFracs = (
    layout: PreviewLayout,
    easeType: EaseTypeValue,
    startEaseFrac: number,
    endEaseFrac: number,
    startProgress: number,
    endProgress: number,
    laneChange: number,
    quality: number,
): number[] => {
    const result: number[] = []
    const ends: [frac: number, travel: number, x: number, depth: number][] = []
    let first = 0
    let firstTravel = approach(layout, startProgress)
    let firstX = ease(easeType, startEaseFrac) * tiltWidthFactor(layout, firstTravel)
    const lastTravel = approach(layout, endProgress)
    ends.push([1, lastTravel, ease(easeType, endEaseFrac) * tiltWidthFactor(layout, lastTravel), 0])
    const tolerance = CONNECTOR_CURVE_ERROR / (2 * quality * quality)
    while (ends.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [last, lastTravel, lastX, depth] = ends.pop()!
        let error = 0
        let middleTravel = 0
        let middleX = 0
        for (const sample of [0.25, 0.5, 0.75]) {
            const frac = lerp(first, last, sample)
            const travel = approach(layout, lerp(startProgress, endProgress, frac))
            const x =
                ease(easeType, lerp(startEaseFrac, endEaseFrac, frac)) *
                tiltWidthFactor(layout, travel)
            const chord = lerp(firstX, lastX, safeUnlerp(firstTravel, lastTravel, travel, sample))
            error = Math.max(error, Math.abs(x - chord) * laneChange * Math.abs(layout.wScale))
            if (sample === 0.5) {
                middleTravel = travel
                middleX = x
            }
        }
        if (error <= tolerance || depth >= 16) {
            result.push(last)
            first = last
            firstTravel = lastTravel
            firstX = lastX
        } else {
            if (result.length + ends.length + 2 > 128) return []
            ends.push([last, lastTravel, lastX, depth + 1])
            ends.push([(first + last) / 2, middleTravel, middleX, depth + 1])
        }
    }
    return result
}
