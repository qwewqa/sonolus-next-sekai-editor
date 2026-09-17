import { computed, ref, shallowRef, watch } from 'vue'
import normalTickUrl from './assets/se_live_connect.mp3?url'
import criticalTickUrl from './assets/se_live_connect_critical.mp3?url'
import criticalTapUrl from './assets/se_live_critical.mp3?url'
import normalFlickUrl from './assets/se_live_flick.mp3?url'
import criticalFlickUrl from './assets/se_live_flick_critical.mp3?url'
import normalActiveUrl from './assets/se_live_long.mp3?url'
import criticalActiveUrl from './assets/se_live_long_critical.mp3?url'
import normalTapUrl from './assets/se_live_perfect.mp3?url'
import normalTraceUrl from './assets/se_live_trace.mp3?url'
import criticalTraceUrl from './assets/se_live_trace_critical.mp3?url'
import { bgm } from './history/bgm'
import { bpms } from './history/bpms'
import { cullEntities, store } from './history/store'
import {
    createPlayerAudio,
    scheduleActivePlayerAudio,
    type ActivePlayerAudio,
    type PlayerAudio,
} from './playerAudio'
import { settings } from './settings'
import type { ConnectorEntity } from './state/entities/slides/connector'
import { beatToTime, timeToBeat } from './state/integrals/bpms'
import { beatToKey } from './state/store/grid'
import { entries } from './utils/object'
import { optional } from './utils/optional'

const startupDelay = 0.2
// Keep enough audio queued to survive a slow editor frame without delaying play.
const lookAhead = 0.75
const scheduleInterval = 25

const context = new AudioContext()

const sfxBuffers = {
    normalTap: optional<AudioBuffer>(),
    criticalTap: optional<AudioBuffer>(),
    normalFlick: optional<AudioBuffer>(),
    criticalFlick: optional<AudioBuffer>(),
    normalTrace: optional<AudioBuffer>(),
    criticalTrace: optional<AudioBuffer>(),
    normalTick: optional<AudioBuffer>(),
    criticalTick: optional<AudioBuffer>(),
    normalActive: optional<AudioBuffer>(),
    criticalActive: optional<AudioBuffer>(),
}

const state = shallowRef<{
    speed: number
    bgmTime: number
    // Audio time at which bgmTime begins, including any initial preroll.
    contextTime: number

    scheduledUntil?: number
    bgmNodes: Set<PlayerAudio>
    sfxNodes: Set<PlayerAudio>
    actives: {
        normalActive: Set<ActivePlayerAudio>
        criticalActive: Set<ActivePlayerAudio>
    }
}>()
export const isPlaying = computed(() => !!state.value)

export const isBgmEnabled = ref(true)
watch(isBgmEnabled, () => {
    if (!state.value) return

    const value = isBgmEnabled.value ? settings.playBgmVolume : 0

    for (const audio of state.value.bgmNodes) {
        audio.setVolume(value)
    }
})

export const isSfxEnabled = ref(true)
watch(isSfxEnabled, () => {
    if (!state.value) return

    const value = isSfxEnabled.value ? settings.playSfxVolume : 0

    for (const audio of state.value.sfxNodes) {
        audio.setVolume(value)
    }

    for (const actives of Object.values(state.value.actives)) {
        for (const audio of actives) {
            audio.setVolume(value)
        }
    }
})

let preview: PlayerAudio | undefined
let scheduler: ReturnType<typeof setInterval> | undefined
let resuming: Promise<void> | undefined
let areSfxReady = false

const scheduleAudio = () => {
    if (!state.value || !areSfxReady) return

    // Scan only new, still playable audio time. The audio clock freezes during
    // suspension, so neither the cursor nor scheduling can run ahead of the BGM.
    const now = context.currentTime
    const startTime = Math.max(
        state.value.contextTime,
        state.value.scheduledUntil ?? state.value.contextTime,
        now,
    )
    const endTime = Math.max(startTime, now + lookAhead)
    if (startTime === endTime) return
    const isCatchingUp =
        state.value.scheduledUntil === undefined || startTime > state.value.scheduledUntil
    const beats = {
        min: timeToBeat(
            bpms.value,
            (startTime - state.value.contextTime) * state.value.speed + state.value.bgmTime,
        ),
        max: timeToBeat(
            bpms.value,
            (endTime - state.value.contextTime) * state.value.speed + state.value.bgmTime,
        ),
    }

    const keys = {
        min: beatToKey(beats.min),
        max: beatToKey(beats.max),
    }

    const targets = {
        normalTap: new Set<number>(),
        criticalTap: new Set<number>(),
        normalFlick: new Set<number>(),
        criticalFlick: new Set<number>(),
        normalTrace: new Set<number>(),
        criticalTrace: new Set<number>(),
        normalTick: new Set<number>(),
        criticalTick: new Set<number>(),
    }

    for (const entity of cullEntities('note', keys.min, keys.max)) {
        if (entity.beat < beats.min || entity.beat >= beats.max) continue

        if (entity.isFake) continue

        if (entity.sfx === 'none') continue
        if (entity.sfx === 'damage') continue

        if (entity.sfx !== 'default') {
            targets[entity.sfx].add(entity.beat)
            continue
        }

        if (entity.noteType === 'anchor') continue

        if (entity.noteType === 'damage') continue

        const infos = store.value.slides.info.get(entity.slideId)
        if (!infos) throw new Error('Unexpected missing infos')

        const info = infos.find((info) => info.note === entity)
        if (!info) throw new Error('Unexpected missing info')

        const isInActive = info.activeHead !== info.activeTail
        const isActiveHead = info.activeHead === info.note
        const isActiveTail = info.activeTail === info.note
        const isFlick = info.note.flickDirection !== 'none'

        if (entity.noteType === 'trace') {
            if (isFlick) {
                if (entity.isCritical) {
                    targets.criticalFlick.add(entity.beat)
                } else {
                    targets.normalFlick.add(entity.beat)
                }
            } else {
                if (entity.isCritical) {
                    targets.criticalTrace.add(entity.beat)
                } else {
                    targets.normalTrace.add(entity.beat)
                }
            }
        } else if (entity.noteType === 'forceTick') {
            if (entity.isCritical) {
                targets.criticalTick.add(entity.beat)
            } else {
                targets.normalTick.add(entity.beat)
            }
        } else if (!isInActive) {
            if (isFlick) {
                if (entity.isCritical) {
                    targets.criticalFlick.add(entity.beat)
                } else {
                    targets.normalFlick.add(entity.beat)
                }
            } else {
                if (entity.isCritical) {
                    targets.criticalTap.add(entity.beat)
                } else {
                    targets.normalTap.add(entity.beat)
                }
            }
        } else if (isActiveHead || isActiveTail) {
            if (isFlick) {
                if (entity.isCritical) {
                    targets.criticalFlick.add(entity.beat)
                } else {
                    targets.normalFlick.add(entity.beat)
                }
            } else {
                targets.normalTap.add(entity.beat)
            }
        } else if (entity.noteType === 'default') {
            if (entity.isCritical) {
                targets.criticalTick.add(entity.beat)
            } else {
                targets.normalTick.add(entity.beat)
            }
        } else {
            if (isFlick) {
                if (entity.isCritical) {
                    targets.criticalFlick.add(entity.beat)
                } else {
                    targets.normalFlick.add(entity.beat)
                }
            } else {
                if (entity.isCritical) {
                    targets.criticalTap.add(entity.beat)
                } else {
                    targets.normalTap.add(entity.beat)
                }
            }
        }
    }

    for (const [type, beats] of entries(targets)) {
        if (!sfxBuffers[type]) continue

        for (const beat of beats) {
            const when =
                (beatToTime(bpms.value, beat) - state.value.bgmTime) / state.value.speed +
                state.value.contextTime
            if (when < context.currentTime) continue

            schedule(
                state.value.sfxNodes,
                sfxBuffers[type],
                isSfxEnabled.value ? settings.playSfxVolume : 0,
                when,
            )
        }
    }

    const activeTargets = {
        normalActive: Array<ConnectorEntity>(),
        criticalActive: Array<ConnectorEntity>(),
    }

    for (const entity of cullEntities('connector', keys.min, keys.max)) {
        if (entity.head.beat >= beats.max || entity.tail.beat <= beats.min) continue
        if (entity.head.beat < beats.min && !isCatchingUp) continue

        if (entity.segmentHead.connectorType !== 'active') continue

        if (entity.segmentHead.connectorActiveIsCritical) {
            activeTargets.criticalActive.push(entity)
        } else {
            activeTargets.normalActive.push(entity)
        }
    }

    for (const [type, entities] of entries(activeTargets)) {
        if (!sfxBuffers[type]) continue

        for (const entity of entities.sort((a, b) => a.head.beat - b.head.beat)) {
            scheduleActivePlayerAudio(
                context,
                state.value.actives[type],
                sfxBuffers[type],
                entity.head.beat,
                entity.tail.beat,
                isSfxEnabled.value ? settings.playSfxVolume : 0,
                (beatToTime(bpms.value, entity.head.beat) - state.value.bgmTime) /
                    state.value.speed +
                    state.value.contextTime,
                (beatToTime(bpms.value, entity.tail.beat) - state.value.bgmTime) /
                    state.value.speed +
                    state.value.contextTime,
            )
        }
    }

    state.value.scheduledUntil = endTime
}

const clearScheduler = () => {
    clearInterval(scheduler)
    scheduler = undefined
}

const updateScheduler = () => {
    clearScheduler()
    if (!state.value || context.state !== 'running') return
    scheduleAudio()
    // Audio scheduling must not depend on whether the preview renders a frame.
    scheduler = setInterval(scheduleAudio, scheduleInterval)
}

context.addEventListener('statechange', updateScheduler)

export const getPlayerTime = () => {
    if (!state.value) return
    return (
        Math.max(0, context.currentTime - state.value.contextTime) * state.value.speed +
        state.value.bgmTime
    )
}

export const loadBgm = (data: ArrayBuffer) => context.decodeAudioData(data)

export const startPlayer = (bgmTime: number, speed: number, delay = startupDelay) => {
    stopPlayer()

    const contextTime = context.currentTime + delay

    state.value = {
        speed,
        bgmTime,
        contextTime,

        bgmNodes: new Set(),
        sfxNodes: new Set(),
        actives: {
            normalActive: new Set(),
            criticalActive: new Set(),
        },
    }

    startContext()

    if (bgm.value.buffer)
        schedule(
            state.value.bgmNodes,
            bgm.value.buffer,
            isBgmEnabled.value ? settings.playBgmVolume : 0,
            contextTime,
            bgmTime + bgm.value.offset,
            speed,
            true,
        )

    // Queue the first window even if resume is pending; native audio starts and
    // the cursor share the same suspended clock, and stop cancels these sources.
    scheduleAudio()
    updateScheduler()
}

export const stopPlayer = () => {
    clearScheduler()
    if (!state.value) return

    for (const audio of state.value.bgmNodes) {
        audio.fadeOut()
    }
    for (const audio of state.value.sfxNodes) {
        audio.fadeOut()
    }

    for (const actives of Object.values(state.value.actives)) {
        for (const audio of actives) {
            audio.fadeOut()
        }
    }

    state.value = undefined
}

export const previewPlayer = (bgmTime: number) => {
    const duration = settings.playPreviewDuration / 1000
    if (duration <= 0) return

    startContext()

    if (!bgm.value.buffer) return

    const offset = bgmTime + bgm.value.offset
    if (offset < 0) return

    const audio = createPlayerAudio(
        context,
        { buffer: bgm.value.buffer },
        settings.playBgmVolume,
        () => {
            if (preview === audio) preview = undefined
        },
    )
    preview = audio

    const time = context.currentTime
    audio.envelope(time, duration)
    audio.start(time, offset, duration)
}

export const stopPreviewPlayer = () => {
    preview?.fadeOut()
    preview = undefined
}

const startContext = () => {
    if (context.state !== 'running' && !resuming) {
        resuming = context
            .resume()
            .catch(() => {
                if (context.state === 'running') return
                stopPlayer()
                stopPreviewPlayer()
            })
            .finally(() => {
                resuming = undefined
            })
    }

    stopPreviewPlayer()
}

const schedule = (
    nodes: Set<PlayerAudio>,
    buffer: AudioBuffer,
    volume: number,
    when: number,
    offset = 0,
    speed = 1,
    fadeIn = false,
) => {
    const audio = createPlayerAudio(context, { buffer, playbackRate: speed }, volume, () =>
        nodes.delete(audio),
    )
    nodes.add(audio)

    const startTime = offset < 0 ? when - offset / speed : when
    if (fadeIn) audio.fadeIn(startTime)
    audio.start(startTime, Math.max(0, offset))
}

const loadSfx = () => {
    const load = async (type: keyof typeof sfxBuffers, url: string) => {
        const response = await fetch(url)
        const data = await response.arrayBuffer()
        sfxBuffers[type] = await context.decodeAudioData(data)
    }

    void Promise.allSettled([
        load('normalTap', normalTapUrl),
        load('criticalTap', criticalTapUrl),
        load('normalFlick', normalFlickUrl),
        load('criticalFlick', criticalFlickUrl),
        load('normalTrace', normalTraceUrl),
        load('criticalTrace', criticalTraceUrl),
        load('normalTick', normalTickUrl),
        load('criticalTick', criticalTickUrl),
        load('normalActive', normalActiveUrl),
        load('criticalActive', criticalActiveUrl),
    ]).then(() => {
        areSfxReady = true
    })
}

loadSfx()

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        stopPlayer()
        stopPreviewPlayer()
        context.removeEventListener('statechange', updateScheduler)
        void context.close()
    })
}
