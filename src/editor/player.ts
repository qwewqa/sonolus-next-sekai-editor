import { watch } from 'vue'
import { i18n } from '../i18n'
import {
    startPlayer as _startPlayer,
    stopPlayer as _stopPlayer,
    previewPlayer,
    stopPreviewPlayer,
} from '../player'
import { settings } from '../settings'
import { time } from '../time'
import { interpolate } from '../utils/interpolate'
import { audioPreviewRequest } from './audioPreview'
import { notify } from './notification'
import { focusView, updateViewLastActive, view } from './view'

let speed = 1
let isPreviewScrubbing = false
let isPreviewScrubLocked = false
let previewFollowScroll: typeof view.scrollingY

let state:
    | {
          speed: number
          startTime: number
          startBgmTime: number
          returnTime: number
      }
    | undefined

let transportPreview:
    | {
          time: number
          request: typeof audioPreviewRequest.value
          audition: boolean
      }
    | undefined

const followTime = (cursorTime: number) =>
    Math.max(0, cursorTime + ((0.5 - settings.playFollowPosition / 100) * view.h) / settings.pps)

watch(time, ({ now }) => {
    if (!state) return

    view.cursorTime = Math.max(0, now - state.startTime) * state.speed + state.startBgmTime

    if (!settings.playFollow) return

    view.time = followTime(view.cursorTime)
})

watch(
    [() => view.cursorTime, audioPreviewRequest],
    ([cursorTime, request], [, previousRequest]) => {
        const transport = transportPreview
        transportPreview = undefined
        if (state || isPreviewScrubbing) return

        // Vue batches cursor and note-audition changes. A later transport action
        // takes precedence over work already queued in the same browser task.
        if (transport?.time === cursorTime && transport.request === request) {
            if (transport.audition) previewPlayer(cursorTime)
            return
        }

        previewPlayer(request && request !== previousRequest ? request.time : cursorTime)
    },
)

const startPlayerAt = (bgmTime: number) => {
    endPreviewScrub(false)
    cancelPreviewFollow()
    state = {
        speed,
        startTime: _startPlayer(bgmTime, speed),
        startBgmTime: bgmTime,
        returnTime: bgmTime,
    }

    notify(() => i18n.value.player.started)
}

export const startOrStopPlayer = () => {
    if (state) {
        stopPlayer(false)
        return
    }

    startPlayerAt(
        settings.playStartPosition === 'cursor'
            ? view.cursorTime
            : Math.max(
                  0,
                  view.time +
                      (((settings.playFollow ? settings.playFollowPosition : 0) / 100 - 0.5) *
                          view.h) /
                          settings.pps,
              ),
    )
}

export const stopPlayer = (shouldReturn: boolean) => {
    if (!state) return

    _stopPlayer()

    if (shouldReturn) focusView(state.returnTime)
    state = undefined

    notify(() => i18n.value.player.stopped)
}

export const togglePreviewPlayback = () => {
    if (state) {
        stopPlayer(false)
        transportPreview = {
            time: view.cursorTime,
            request: audioPreviewRequest.value,
            audition: false,
        }
        return
    }

    view.scrollingY = undefined
    startPlayerAt(view.cursorTime)
}

const seekPreviewTime = (seconds: number) => {
    if (!settings.playFollow) {
        focusView(seconds)
        return
    }

    view.cursorTime = seconds
    updateViewLastActive()
    const target = followTime(seconds)
    if (isPreviewScrubLocked) {
        view.time = target
        view.scrollingY = undefined
        previewFollowScroll = undefined
        return
    }
    if (view.scrollingY?.type === 'ease' && view.scrollingY.to.viewTime === target) return

    // Retarget from the viewport's current position, preserving smooth motion
    // across successive seeks without accumulating old destinations.
    view.scrollingY =
        view.time === target
            ? undefined
            : {
                  type: 'ease',
                  from: { time: time.value.now, viewTime: view.time },
                  to: { time: time.value.now + 0.25, viewTime: target },
              }
    previewFollowScroll = view.scrollingY
}

export const cancelPreviewFollow = () => {
    if (view.scrollingY === previewFollowScroll) view.scrollingY = undefined
    previewFollowScroll = undefined
}

export const stepPreviewTime = (milliseconds: number) => {
    if (!Number.isFinite(milliseconds)) return

    endPreviewScrub(false)
    stopPlayer(false)
    view.scrollingY = undefined
    const previousTime = view.cursorTime
    seekPreviewTime(Math.max(0, view.cursorTime + milliseconds / 1000))
    const changed = view.cursorTime !== previousTime
    transportPreview = {
        time: view.cursorTime,
        request: audioPreviewRequest.value,
        audition: changed,
    }
    // Clamping can leave both watched values unchanged. Replace any old snippet
    // directly, while suppressing a cursor or note update already queued above.
    if (!changed) previewPlayer(view.cursorTime)
}

export const beginPreviewScrub = (follow: 'smooth' | 'locked' = 'smooth') => {
    if (isPreviewScrubbing) return

    stopPlayer(false)
    stopPreviewPlayer()
    view.scrollingY = undefined
    isPreviewScrubbing = true
    isPreviewScrubLocked = follow === 'locked'
    if (isPreviewScrubLocked && settings.playFollow) seekPreviewTime(view.cursorTime)
}

export const scrubPreviewTo = (seconds: number) => {
    if (!isPreviewScrubbing || !Number.isFinite(seconds)) return

    const target = Math.max(0, seconds)
    if (target !== view.cursorTime || settings.playFollow) seekPreviewTime(target)
}

export const endPreviewScrub = (audition = true) => {
    if (!isPreviewScrubbing) return

    isPreviewScrubbing = false
    isPreviewScrubLocked = false
    // The last scrub update may still be queued. Audition once on release and
    // prevent that queued cursor watcher from creating a second snippet.
    transportPreview = {
        time: view.cursorTime,
        request: audioPreviewRequest.value,
        audition: false,
    }
    if (audition) previewPlayer(view.cursorTime)
}

export const changePlayerSpeed = (direction: -1 | 1) => {
    if (state) {
        _stopPlayer()
    }

    speed = getNewSpeed(direction)

    if (state) {
        state = {
            speed,
            startTime: _startPlayer(view.cursorTime, speed),
            startBgmTime: view.cursorTime,
            returnTime: state.returnTime,
        }
    }

    notify(interpolate(() => i18n.value.player.changed, `${speed}`))
}

const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2]

const getNewSpeed = (direction: -1 | 1) => {
    const index = speeds.indexOf(speed)
    if (index === -1) return 1

    return speeds[index + direction] ?? speed
}
