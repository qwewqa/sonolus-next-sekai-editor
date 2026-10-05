import type { FlickDirection } from './chart/note'

type Point = readonly [number, number]

/** Flick arrows in note units, above the note's center, as the editor draws them. */
export const flickArrowPoints: Record<Exclude<FlickDirection, 'none'>, readonly Point[]> = {
    up: [
        [-1, 0],
        [-1, -0.4],
        [0, -1],
        [1, -0.4],
        [1, 0],
        [0, -0.6],
    ],
    upLeft: [
        [-1, 0],
        [-1.2, -0.3],
        [-0.6, -1.1],
        [0.6, -0.8],
        [0.8, -0.4],
        [-0.4, -0.7],
    ],
    upRight: [
        [1, 0],
        [1.2, -0.3],
        [0.6, -1.1],
        [-0.6, -0.8],
        [-0.8, -0.4],
        [0.4, -0.7],
    ],
    down: [
        [-1, -1.2],
        [-1, -0.8],
        [0, -0.2],
        [1, -0.8],
        [1, -1.2],
        [0, -0.6],
    ],
    downLeft: [
        [-1, -1.2],
        [-1.2, -0.9],
        [-0.6, -0.1],
        [0.6, -0.4],
        [0.8, -0.8],
        [-0.4, -0.5],
    ],
    downRight: [
        [1, -1.2],
        [1.2, -0.9],
        [0.6, -0.1],
        [-0.6, -0.4],
        [-0.8, -0.8],
        [0.4, -0.5],
    ],
}

const round = (value: number) => Math.round(value * 100) / 100

/** SVG polygon points for a flick arrow centered at (center, center), scaled by `scale`. */
export const flickGlyphPoints = (
    direction: Exclude<FlickDirection, 'none'>,
    center: number,
    scale: number,
) => {
    const points = flickArrowPoints[direction]
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    return points
        .map(([x, y]) => `${round(center + (x - cx) * scale)},${round(center + (y - cy) * scale)}`)
        .join(' ')
}
