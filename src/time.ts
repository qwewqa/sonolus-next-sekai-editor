import { ref, watch } from 'vue'
import { isAppActive } from './activity'

export const time = ref({
    now: performance.now() / 1000,
    delta: 0,
})

let frame = 0

const update = () => {
    frame = 0
    if (!isAppActive.value) return
    const now = performance.now() / 1000

    time.value = {
        now,
        delta: now - time.value.now,
    }

    frame = requestAnimationFrame(update)
}

const stop = watch(
    isAppActive,
    (active) => {
        cancelAnimationFrame(frame)
        frame = 0
        if (!active) return

        // Playback catches up to real time, while gestures and inertia must not
        // integrate the entire time spent away as one enormous animation frame.
        time.value = { now: performance.now() / 1000, delta: 0 }
        frame = requestAnimationFrame(update)
    },
    { immediate: true, flush: 'sync' },
)

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        stop()
        cancelAnimationFrame(frame)
    })
}
