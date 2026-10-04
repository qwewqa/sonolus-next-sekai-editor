import { computed } from 'vue'
import { settings } from '../settings'
import { timeToBeat } from '../state/integrals/bpms'
import { beatToKey } from '../state/store/grid'
import { computedRange } from '../utils/range'
import { sceneBpms } from './sceneState'
import { view } from './view'

export const times = computed(() => ({
    min: Math.max(0, view.time - (0.5 * view.h) / settings.pps),
    max: view.time + (0.5 * view.h) / settings.pps,
}))

export const beats = computed(() => ({
    min: timeToBeat(sceneBpms.value, times.value.min),
    max: timeToBeat(sceneBpms.value, times.value.max),
}))

// Include artwork whose center lies outside the viewport. Diagonal flick
// arrows extend 1.2 scene units above their beat, plus a non-scaling stroke.
export const keys = computedRange(() => ({
    min: beatToKey(
        timeToBeat(
            sceneBpms.value,
            Math.max(
                0,
                view.time - (0.5 * view.h + (1.25 * view.w) / settings.width + 4) / settings.pps,
            ),
        ),
    ),
    max: beatToKey(
        timeToBeat(
            sceneBpms.value,
            Math.max(
                0,
                view.time + (0.5 * view.h + (1.25 * view.w) / settings.width + 4) / settings.pps,
            ),
        ),
    ),
}))
