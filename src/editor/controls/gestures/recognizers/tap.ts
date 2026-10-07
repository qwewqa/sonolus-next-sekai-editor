import { tool } from '../../../tools'
import { setViewHover } from '../../../view'
import { isDragging } from './drag'
import type { Recognizer } from './recognizer'

/** A release in place; touch also needs it quick, as holding is a long press. */
export const tap = (maxDuration = 250): Recognizer<1> => ({
    count: 1,

    recognize([, { isActive, st, sx, sy, t, x, y, modifiers }]) {
        if (isActive) return false
        if (t - st > maxDuration) return false
        if (Math.hypot(x - sx, y - sy) > 20) return false

        // Another input's drag holds the tool.
        if (isDragging.value) return true
        setViewHover(y)
        void tool.value.tap?.(x, y, modifiers)
        return true
    },
})
