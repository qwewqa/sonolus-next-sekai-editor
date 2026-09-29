import { ref, watch } from 'vue'
import { i18n } from '../i18n'
import {
    startPlayer as _startPlayer,
    stopPlayer as _stopPlayer,
    getPlayerTime,
    previewPlayer,
    stopPreviewPlayer,
} from '../player'
import { settings } from '../settings'
import { time } from '../time'
import { interpolate } from '../utils/interpolate'
import { audioPreviewRequest } from './audioPreview'
import { notify } from './notification'
import { createTransport } from './transport'
import { focusView, updateViewLastActive, view } from './view'

const auditionVersion = ref(0)
const transport = createTransport({
    audio: {
        start: (...args) => {
            _startPlayer(...args)
        },
        stop: () => {
            _stopPlayer()
        },
        getTime: () => getPlayerTime(),
        audition: (time) => {
            previewPlayer(time)
        },
        stopAudition: () => {
            stopPreviewPlayer()
        },
    },
    view,
    settings: {
        get playFollow() {
            return settings.playFollow
        },
        get playFollowPosition() {
            return settings.playFollowPosition
        },
        get pps() {
            return settings.pps
        },
    },
    now: () => time.value.now,
    focus: (time) => {
        focusView(time)
    },
    activate: () => {
        updateViewLastActive()
    },
    queueFlush: () => auditionVersion.value++,
    onPlay: () => {
        notify(() => i18n.value.player.started)
    },
    onStop: () => {
        notify(() => i18n.value.player.stopped)
    },
    onSpeedChange: (speed) => {
        notify(interpolate(() => i18n.value.player.changed, `${speed}`))
    },
})

watch(time, transport.update)
watch(auditionVersion, transport.flushAudition)
// Record intent synchronously, then coalesce audio at the normal Vue flush.
// Transport actions can cancel queued work without comparing ref identities.
watch(() => view.cursorTime, transport.cursorChanged, { flush: 'sync' })
watch(
    audioPreviewRequest,
    (request) => {
        if (request) transport.audition(request.time)
    },
    { flush: 'sync' },
)

export const startOrStopPlayer = () => {
    if (transport.isPlaying) {
        transport.pause()
        return
    }
    transport.play(
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

export const togglePreviewPlayback = () => {
    if (transport.isPlaying) {
        transport.pause()
        return
    }
    view.scrollingY = undefined
    transport.play(view.cursorTime)
}

export const stopPlayer = transport.stop
export const stepPreviewTime = transport.step
export const beginPreviewScrub = transport.beginScrub
export const scrubPreviewTo = transport.scrubTo
export const endPreviewScrub = transport.endScrub
export const cancelPreviewFollow = transport.cancelFollow
export const changePlayerSpeed = transport.changeSpeed
