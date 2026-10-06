import type { settings } from '../settings'
import type { view } from './view'

type TransportDependencies = {
    audio: {
        start(time: number, speed: number, delay?: number): void
        stop(): void
        getTime(): number | undefined
        /** Smoothed for drawing. */
        getDisplayTime(): number | undefined
        audition(time: number): void
        stopAudition(): void
    }
    view: Pick<typeof view, 'cursorTime' | 'time' | 'h' | 'scrollingY'>
    settings: Pick<typeof settings, 'playFollow' | 'playFollowPosition' | 'pps'>
    now: () => number
    focus: (time: number) => void
    activate: () => void
    queueFlush: () => void
    onPlay: () => void
    onStop: () => void
    onSpeedChange: (speed: number) => void
}

const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2]

export const createTransport = ({
    audio,
    view,
    settings,
    now,
    focus,
    activate,
    queueFlush,
    onPlay,
    onStop,
    onSpeedChange,
}: TransportDependencies) => {
    let speed = 1
    // floor: the frame shown before a speed change, which the display holds until it passes.
    let playback: { returnTime: number; floor?: number } | undefined
    let scrub: 'smooth' | 'locked' | undefined
    let followScroll: typeof view.scrollingY
    let pendingAudition: { time: number; source: 'cursor' | 'note' | 'transport' } | undefined

    const followTime = (cursorTime: number) =>
        Math.max(
            0,
            cursorTime + ((0.5 - settings.playFollowPosition / 100) * view.h) / settings.pps,
        )

    const queueAudition = (time: number, source: 'cursor' | 'note' | 'transport') => {
        if (playback || scrub) return
        // A note audition has its own position, independent of cursor changes
        // made by the same editor interaction. Explicit transport actions replace it.
        if (source === 'cursor' && pendingAudition?.source === 'note') return
        pendingAudition = { time, source }
        queueFlush()
    }

    const flushAudition = () => {
        const pending = pendingAudition
        pendingAudition = undefined
        if (pending && !playback && !scrub) audio.audition(pending.time)
    }

    const update = () => {
        if (!playback) return
        let cursorTime = audio.getDisplayTime()
        if (cursorTime === undefined) {
            playback = undefined
            return
        }
        if (playback.floor !== undefined) {
            if (cursorTime < playback.floor) cursorTime = playback.floor
            else playback.floor = undefined
        }
        view.cursorTime = cursorTime
        if (settings.playFollow) view.time = followTime(cursorTime)
    }

    const cancelFollow = () => {
        if (view.scrollingY === followScroll) view.scrollingY = undefined
        followScroll = undefined
    }

    const stop = (shouldReturn = false) => {
        // Inactivity can stop a paused transport before its queued audition flushes.
        pendingAudition = undefined
        if (!playback) return
        const { returnTime } = playback
        audio.stop()
        playback = undefined
        if (shouldReturn) focus(returnTime)
        onStop()
    }

    const pause = () => {
        // Pause captures the audio clock even when the displayed frame is late.
        // Editing and fine steps use stop() to preserve the displayed position.
        const cursorTime = audio.getTime()
        if (cursorTime !== undefined) {
            view.cursorTime = cursorTime
            if (settings.playFollow) view.time = followTime(cursorTime)
        }
        stop()
        pendingAudition = undefined
    }

    const seek = (seconds: number) => {
        if (!settings.playFollow) {
            const scrolling = view.scrollingY
            focus(seconds)
            if (view.scrollingY !== scrolling) followScroll = view.scrollingY
            return
        }

        view.cursorTime = seconds
        activate()
        const target = followTime(seconds)
        if (scrub === 'locked') {
            view.time = target
            view.scrollingY = undefined
            followScroll = undefined
            return
        }
        if (view.scrollingY?.type === 'ease' && view.scrollingY.to.viewTime === target) return

        // Retarget from the current viewport instead of accumulating destinations.
        const start = now()
        view.scrollingY =
            view.time === target
                ? undefined
                : {
                      type: 'ease',
                      from: { time: start, viewTime: view.time },
                      to: { time: start + 0.25, viewTime: target },
                  }
        followScroll = view.scrollingY
    }

    const endScrub = (audition = true) => {
        if (!scrub) return
        scrub = undefined
        pendingAudition = undefined
        if (audition) audio.audition(view.cursorTime)
    }

    const play = (seconds: number) => {
        endScrub(false)
        cancelFollow()
        pendingAudition = undefined
        audio.start(seconds, speed)
        playback = { returnTime: seconds }
        onPlay()
    }

    const step = (milliseconds: number) => {
        if (!Number.isFinite(milliseconds)) return
        endScrub(false)
        stop()
        view.scrollingY = undefined
        const previousTime = view.cursorTime
        seek(Math.max(0, previousTime + milliseconds / 1000))
        pendingAudition = undefined
        // Clamped steps still replace an old snippet, even without a cursor change.
        if (view.cursorTime === previousTime) audio.audition(view.cursorTime)
        else queueAudition(view.cursorTime, 'transport')
    }

    const beginScrub = (follow: 'smooth' | 'locked' = 'smooth') => {
        if (scrub) return
        stop()
        audio.stopAudition()
        pendingAudition = undefined
        view.scrollingY = undefined
        scrub = follow
        if (scrub === 'locked' && settings.playFollow) seek(view.cursorTime)
    }

    const scrubTo = (seconds: number) => {
        if (!scrub || !Number.isFinite(seconds)) return
        const target = Math.max(0, seconds)
        if (target !== view.cursorTime || settings.playFollow) seek(target)
    }

    const changeSpeed = (direction: -1 | 1) => {
        const newSpeed = speeds[speeds.indexOf(speed) + direction] ?? speed
        if (newSpeed === speed) return
        speed = newSpeed
        if (playback) {
            // Audio restarts at its own clock, which the shown frame may lead.
            audio.start(audio.getTime() ?? view.cursorTime, speed, 0)
            playback.floor = view.cursorTime
        }
        onSpeedChange(speed)
    }

    return {
        get isPlaying() {
            return !!playback
        },
        update,
        play,
        pause,
        stop,
        step,
        beginScrub,
        scrubTo,
        endScrub,
        cancelFollow,
        changeSpeed,
        audition: (time: number) => {
            queueAudition(time, 'note')
        },
        cursorChanged: (time: number) => {
            queueAudition(time, 'cursor')
        },
        flushAudition,
    }
}
