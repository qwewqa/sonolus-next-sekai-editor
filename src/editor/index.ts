import { computed } from 'vue'
import { bpms } from '../history/bpms'
import { settings } from '../settings'
import { timeToBeat } from '../state/integrals/bpms'
import { beatToKey } from '../state/store/grid'
import { computedRange } from '../utils/range'
import { view } from './view'

export const times = computed(() => ({
    min: Math.max(0, view.time - (0.5 * view.h) / settings.pps),
    max: view.time + (0.5 * view.h) / settings.pps,
}))

export const beats = computed(() => ({
    min: timeToBeat(bpms.value, times.value.min),
    max: timeToBeat(bpms.value, times.value.max),
}))

// Include outlines whose centers are just outside the viewport (the largest
// hitbox has a half-height of 0.4, plus 0.1 units of outline padding and a
// non-scaling stroke extending one CSS pixel past the rectangle).
export const keys = computedRange(() => ({
    min: beatToKey(
        timeToBeat(
            bpms.value,
            Math.max(
                0,
                view.time - (0.5 * view.h + (0.5 * view.w) / settings.width + 1) / settings.pps,
            ),
        ),
    ),
    max: beatToKey(
        timeToBeat(
            bpms.value,
            Math.max(
                0,
                view.time + (0.5 * view.h + (0.5 * view.w) / settings.width + 1) / settings.pps,
            ),
        ),
    ),
}))
