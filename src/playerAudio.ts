export type PlayerAudio = {
    node: GainNode
    source: AudioBufferSourceNode
    start: (...args: Parameters<AudioBufferSourceNode['start']>) => void
    setVolume: (volume: number, when?: number) => void
    fadeIn: (when?: number, duration?: number) => void
    envelope: (when: number, duration: number, attack?: number) => void
    fadeOut: (duration?: number) => void
    stop: () => void
}

export type ActivePlayerAudio = PlayerAudio & { endBeat: number; endTime: number }

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
    let fading = false
    let startTime: number | undefined
    let targetGain = volume / 100
    let attackEnvelope: { when: number; duration: number; decayEnd?: number } | undefined
    type GainPoint = { time: number; value: number; linear: boolean }
    const initialPoint = { time: context.currentTime, value: targetGain, linear: false }
    let points: GainPoint[] = [initialPoint]
    const addPoint = (point: GainPoint) => {
        if (point.linear) node.gain.linearRampToValueAtTime(point.value, point.time)
        else node.gain.setValueAtTime(point.value, point.time)
        points.push(point)
    }
    const holdGain = (when: number) => {
        let previous = points[0] ?? initialPoint
        let value = previous.value
        let linear = false
        for (const point of points) {
            if (point.time > when) {
                if (point.linear && previous.time < when) {
                    linear = true
                    value =
                        previous.value +
                        ((point.value - previous.value) * (when - previous.time)) /
                            (point.time - previous.time)
                }
                break
            }
            value = point.value
            linear = point.time === when && point.linear
            previous = point
        }

        // Keep our own linear envelope: cancelAndHoldAtTime is unavailable in
        // some browsers, and AudioParam.value does not describe future ramps.
        node.gain.cancelScheduledValues(when)
        points = points.filter((point) => point.time < when)
        const point = { time: when, value, linear }
        addPoint(point)
        // Only pending automation is needed after an immediate replacement.
        if (when === context.currentTime) points = [point]
        return value
    }
    const attackAt = (when: number, duration: number) => {
        holdGain(when)
        addPoint({ time: when, value: 0, linear: false })
        addPoint({ time: when + duration, value: targetGain, linear: true })
        attackEnvelope = { when, duration }
    }
    const release = () => {
        if (ended) return
        ended = true
        source.onended = null
        context.removeEventListener('statechange', stopIfSuspended)
        source.disconnect()
        node.disconnect()
        onEnded()
    }
    source.onended = release

    const stop = () => {
        if (ended) return
        // stop() before start() throws; an unstarted source only needs releasing.
        if (startTime !== undefined) source.stop()
        release()
    }
    const stopIfSuspended = () => {
        if (context.state !== 'running') stop()
    }

    return {
        node,
        source,
        start(...args) {
            if (ended || fading) return
            source.start(...args)
            startTime = Math.max(args[0] ?? 0, context.currentTime)
        },
        setVolume(volume, when = context.currentTime) {
            if (ended || fading) return
            when = Math.max(when, context.currentTime)
            targetGain = volume / 100
            // A volume change during preroll must retain the pending attack.
            if (startTime !== undefined && startTime > when && attackEnvelope) {
                const { when: attackTime, duration, decayEnd } = attackEnvelope
                if (attackTime >= when) {
                    attackAt(attackTime, duration)
                    if (decayEnd !== undefined) {
                        addPoint({ time: decayEnd, value: 0, linear: true })
                        attackEnvelope = { when: attackTime, duration, decayEnd }
                    }
                    return
                }
            }
            holdGain(when)
            addPoint({ time: when + 0.005, value: targetGain, linear: true })
        },
        fadeIn(when = context.currentTime, duration = 0.005) {
            if (ended || fading) return
            attackAt(Math.max(when, context.currentTime), Math.max(0, duration))
        },
        // Auditions keep their requested duration, with a short attack followed
        // by decay to silence. All gain automation must go through this helper.
        envelope(when, duration, attack = 0.003) {
            if (ended || fading) return
            when = Math.max(when, context.currentTime)
            duration = Math.max(0, duration)
            attackAt(when, Math.max(0, Math.min(attack, duration / 2)))
            addPoint({ time: when + duration, value: 0, linear: true })
            if (attackEnvelope) attackEnvelope.decayEnd = when + duration
        },
        fadeOut(duration = 0.005) {
            if (ended) return
            const now = context.currentTime
            if (
                context.state !== 'running' ||
                startTime === undefined ||
                startTime > now ||
                duration <= 0
            ) {
                stop()
                return
            }
            if (fading) return
            fading = true
            holdGain(now)
            addPoint({ time: now + duration, value: 0, linear: true })
            source.stop(now + duration)
            // Keep connections and ownership until the fade has rendered.
            // Suspension can happen before that deadline and must not strand it.
            context.addEventListener('statechange', stopIfSuspended)
        },
        stop,
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
    const start = Math.max(whenStart, context.currentTime)
    active.fadeIn(start)
    active.start(start)
    active.source.stop(whenStop)
}
