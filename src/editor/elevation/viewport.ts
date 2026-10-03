import { shallowReactive } from 'vue'
import { clamp } from '../../utils/math'
import type { ElevationNote } from './layout'

export const elevationViewport = shallowReactive({ center: 2.5, scale: 64 })
export const elevationBounds = shallowReactive({ x: 0, y: 0, w: 0, h: 0 })
export const fitElevationViewport = (
    height: number,
    notes: ElevationNote[],
    padding = { top: 80, bottom: 140 },
) => {
    let min = 0
    let max = 5
    for (const note of notes) {
        min = Math.min(min, note.elevation)
        max = Math.max(max, note.elevation)
    }
    const top = Math.min(padding.top, Math.max(0, height - 1))
    const bottom = Math.min(padding.bottom, Math.max(0, (height - top) / 2))
    elevationViewport.scale = clamp((height - top - bottom) / (max - min), 0.01, 400)
    elevationViewport.center = (min + max) / 2 + (top - bottom) / (2 * elevationViewport.scale)
}
