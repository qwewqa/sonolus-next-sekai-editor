import { watch } from 'vue'
import { isAppActive } from '../../activity'
import { stopPlayer } from '../player'

export const useFocusControl = () => {
    // Preserve pause-on-blur and handle visibility changes that arrive without a
    // blur event, so background audio cannot outlive its suspended visual clock.
    watch(
        isAppActive,
        (active) => {
            if (!active) stopPlayer(false)
        },
        { flush: 'sync' },
    )
}
