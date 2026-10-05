import {
    ease,
    easeFamily,
    easeMode,
    easeOvershoot,
    sampleEase,
    type Ease,
    type EaseMode,
} from './ease'

// Steps as [time, value] corners, jumping between their held values.
const steps: Record<EaseMode, [number, number][]> = {
    in: [
        [0, 0],
        [1, 0],
        [1, 1],
    ],
    out: [
        [0, 0],
        [0, 1],
        [1, 1],
    ],
    inOut: [
        [0, 0],
        [0.5, 0],
        [0.5, 1],
        [1, 1],
    ],
    outIn: [
        [0, 0],
        [0, 0.5],
        [1, 0.5],
        [1, 1],
    ],
}

const cache = new Map<string, [number, number][]>()

/**
 * An ease's curve in the unit square as on the timeline: time runs up from the
 * bottom edge and the value to the right, or to the left when it decreases.
 * Overshoot shrinks the curve to keep it inside the square.
 */
export const easeGlyphPoints = (type: Ease, decreasing = false): readonly [number, number][] => {
    const key = decreasing ? `-${type}` : type
    let points = cache.get(key)
    if (points) return points

    const mode = easeMode(type)
    const overshoot = easeOvershoot(type)
    const samples: [number, number][] =
        easeFamily(type) === 'step' && mode
            ? steps[mode]
            : sampleEase(type, 0, 1, 0.01).map((t) => [t, ease(type, t)])
    points = samples.map(([t, value]) => {
        const x = (value + overshoot) / (1 + 2 * overshoot)
        return [decreasing ? 1 - x : x, 1 - t]
    })
    cache.set(key, points)
    return points
}

const round = (value: number) => Math.round(value * 100) / 100

/** SVG path data for an ease glyph in a box at (x, y) of the given size. */
export const easeGlyphPathD = (
    type: Ease,
    decreasing: boolean,
    x: number,
    y: number,
    width: number,
    height: number,
) =>
    easeGlyphPoints(type, decreasing)
        .map(
            ([px, py], index) =>
                `${index ? 'L' : 'M'} ${round(x + px * width)} ${round(y + py * height)}`,
        )
        .join(' ')
