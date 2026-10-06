/** Wall-time playback clock that eases toward the blocky audio clock, within `maxError` s. */
export const createDisplayClock = (maxError = 0.025, correction = 0.05) => {
    let anchor: { audioTime: number; at: number } | undefined
    let shown = -Infinity

    return {
        reset() {
            anchor = undefined
            shown = -Infinity
        },
        read(audioTime: number, now: number, running: boolean) {
            if (!running) {
                anchor = undefined
                shown = Math.max(shown, audioTime)
                return shown
            }
            if (anchor) {
                const error = audioTime - (anchor.audioTime + now - anchor.at)
                if (Math.abs(error) > maxError) anchor = undefined
                else anchor.audioTime += error * correction
            }
            anchor ??= { audioTime, at: now }
            const predicted = anchor.audioTime + now - anchor.at
            shown = Math.max(shown, Math.min(predicted, audioTime + maxError))
            return shown
        },
    }
}
