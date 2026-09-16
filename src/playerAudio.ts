export type PlayerAudio = {
    node: GainNode
    source: AudioBufferSourceNode
    stop: () => void
}

export type ActivePlayerAudio = PlayerAudio & { endBeat: number; endTime: number }

export const getPlayerAudioStartTime = (
    state: { lastTime: number; time: number; contextTime: number },
    now: number,
    contextTime: number,
    delay: number,
) => Math.max(state.lastTime, Math.min(now, state.time + contextTime - state.contextTime - delay))

export const createPlayerAudio = (
    context: AudioContext,
    options: AudioBufferSourceOptions,
    volume: number,
    onEnded: () => void,
): PlayerAudio => {
    const source = new AudioBufferSourceNode(context, options)
    const node = new GainNode(context, { gain: volume / 100 })
    source.connect(node)
    node.connect(context.destination)

    let ended = false
    const release = () => {
        if (ended) return
        ended = true
        source.onended = null
        source.disconnect()
        node.disconnect()
        onEnded()
    }
    source.onended = release

    return {
        node,
        source,
        stop() {
            if (ended) return
            // Disconnecting the gain alone leaves scheduled and looping sources alive.
            source.stop()
            release()
        },
    }
}

export const scheduleActivePlayerAudio = (
    context: AudioContext,
    actives: Set<ActivePlayerAudio>,
    buffer: AudioBuffer,
    startBeat: number,
    endBeat: number,
    volume: number,
    whenStart: number,
    whenStop: number,
) => {
    if (whenStop <= context.currentTime) return

    for (const active of actives) {
        // Audio time advances while the main thread is paused; its ended event may
        // still be queued when playback catches up. A stopped source cannot restart.
        if (active.endTime <= context.currentTime) {
            active.stop()
            continue
        }
        if (active.endBeat < startBeat) continue

        // Overlapping shorter holds must not cut off a longer hold already playing.
        if (endBeat <= active.endBeat) return
        active.endBeat = endBeat
        active.endTime = whenStop
        active.source.stop(whenStop)
        return
    }

    const active = {
        ...createPlayerAudio(context, { buffer, loop: true }, volume, () => actives.delete(active)),
        endBeat,
        endTime: whenStop,
    }
    actives.add(active)
    active.source.start(Math.max(whenStart, context.currentTime))
    active.source.stop(whenStop)
}
