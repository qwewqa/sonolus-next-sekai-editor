import { align } from '../utils/math'

export type Snapping = 'absolute' | 'relative'

export const snappedOffset = (
    start: number,
    current: number,
    anchor: number,
    division: number,
    snapping: Snapping,
) =>
    snapping === 'absolute'
        ? align(anchor + current - start, division) - anchor
        : align(current - start, division)
