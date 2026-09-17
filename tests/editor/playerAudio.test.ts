import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
    createPlayerAudio,
    scheduleActivePlayerAudio,
    type ActivePlayerAudio,
    type PlayerAudio,
} from '../../src/playerAudio'

const fixture = (t: TestContext) => {
    class Source {
        onended: (() => void) | null = null
        starts: number[][] = []
        stops: (number | undefined)[] = []
        disconnects = 0
        constructor(
            readonly context: AudioContext,
            readonly options: AudioBufferSourceOptions,
        ) {}
        connect() {}
        disconnect() {
            this.disconnects++
        }
        start(...args: number[]) {
            this.starts.push(args)
        }
        stop(when?: number) {
            assert.notEqual(this.starts.length, 0, 'a source cannot stop before it starts')
            this.stops.push(when)
        }
    }
    class Param {
        events: { method: 'set' | 'ramp' | 'cancel'; value?: number; time: number }[] = []
        setValueAtTime(value: number, time: number) {
            this.events.push({ method: 'set', value, time })
        }
        linearRampToValueAtTime(value: number, time: number) {
            this.events.push({ method: 'ramp', value, time })
        }
        cancelScheduledValues(time: number) {
            this.events.push({ method: 'cancel', time })
        }
    }
    class Gain {
        disconnects = 0
        gain = new Param()
        constructor(
            readonly context: AudioContext,
            readonly options: GainOptions,
        ) {}
        connect() {}
        disconnect() {
            this.disconnects++
        }
    }
    const priorSource = Object.getOwnPropertyDescriptor(globalThis, 'AudioBufferSourceNode')
    const priorGain = Object.getOwnPropertyDescriptor(globalThis, 'GainNode')
    Object.assign(globalThis, { AudioBufferSourceNode: Source, GainNode: Gain })
    t.after(() => {
        for (const [name, descriptor] of [
            ['AudioBufferSourceNode', priorSource],
            ['GainNode', priorGain],
        ] as const) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else Reflect.deleteProperty(globalThis, name)
        }
    })
    const context = Object.assign(new EventTarget(), {
        currentTime: 10,
        destination: {},
        state: 'running',
    }) as unknown as AudioContext
    const buffer = {} as AudioBuffer
    const source = (audio: PlayerAudio) => audio.source as unknown as Source
    const gain = (audio: PlayerAudio) => audio.node as unknown as Gain
    return { context, buffer, source, gain }
}

test('stopping cancels pending and long looping audio immediately and releases every connection', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    const playing = new Set<PlayerAudio>()
    for (const loop of [false, true]) {
        const audio = createPlayerAudio(context, { buffer, loop }, 75, () => playing.delete(audio))
        playing.add(audio)
        audio.start(20)
        if (loop) audio.source.stop(3600)
    }
    const original = [...playing]
    // A queued natural-end callback is harmless even when stop already released it.
    const queuedEnd = source(original[0]!).onended!
    for (const audio of playing) audio.stop()
    assert.equal(playing.size, 0)
    queuedEnd()
    for (const audio of original) {
        audio.stop()
        assert.equal(source(audio).stops.at(-1), undefined)
        assert.equal(source(audio).stops.length, source(audio).options.loop ? 2 : 1)
        assert.equal(source(audio).disconnects, 1)
        assert.equal(gain(audio).disconnects, 1)
        assert.equal(source(audio).onended, null)
    }
})

test('natural completion releases the source, gain, and owner reference exactly once', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    let current: PlayerAudio | undefined
    let releases = 0
    current = createPlayerAudio(context, { buffer, playbackRate: 2 }, 40, () => {
        releases++
        current = undefined
    })
    const audio = current
    audio.start(10, 3, 0.1)
    source(audio).onended!()
    audio.stop()
    assert.equal(current, undefined)
    assert.equal(releases, 1)
    assert.equal(source(audio).disconnects, 1)
    assert.equal(gain(audio).disconnects, 1)
    assert.deepEqual(source(audio).stops, [])
    assert.deepEqual(source(audio).starts, [[10, 3, 0.1]])
    assert.equal(source(audio).options.playbackRate, 2)
    assert.equal(gain(audio).options.gain, 0.4)
})

test('graceful replacement keeps the graph connected until its fade ends and cannot be revived', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    let releases = 0
    const audio = createPlayerAudio(context, { buffer }, 60, () => releases++)
    audio.start(10)
    audio.fadeOut()
    assert.deepEqual(source(audio).stops, [10.005])
    assert.equal(source(audio).disconnects, 0)
    assert.equal(gain(audio).disconnects, 0)
    assert.equal(releases, 0)
    const automation = [...gain(audio).gain.events]
    Object.assign(context, { currentTime: 10.002 })
    audio.fadeOut()
    audio.setVolume(100)
    audio.fadeIn()
    audio.envelope(10.002, 1)
    assert.deepEqual(source(audio).stops, [10.005])
    assert.deepEqual(gain(audio).gain.events, automation)
    const queuedEnd = source(audio).onended!
    queuedEnd()
    audio.stop()
    queuedEnd()
    assert.equal(releases, 1)
    assert.equal(source(audio).disconnects, 1)
    assert.equal(gain(audio).disconnects, 1)
})

test('unstarted, future and suspended audio cancels immediately without waiting for audio time', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    let releases = 0
    const unstarted = createPlayerAudio(context, { buffer }, 50, () => releases++)
    unstarted.fadeOut()
    unstarted.start(10)
    assert.deepEqual(source(unstarted).starts, [])
    assert.deepEqual(source(unstarted).stops, [])

    const future = createPlayerAudio(context, { buffer }, 50, () => releases++)
    future.start(20)
    future.fadeOut()
    assert.deepEqual(source(future).stops, [undefined])

    for (const state of ['suspended', 'interrupted', 'closed']) {
        const audio = createPlayerAudio(context, { buffer }, 50, () => releases++)
        audio.start(10)
        Object.assign(context, { state })
        audio.fadeOut()
        assert.deepEqual(source(audio).stops, [undefined])
        assert.equal(gain(audio).disconnects, 1)
        Object.assign(context, { state: 'running' })
    }
    assert.equal(releases, 5)
})

test('immediate stop can cancel a pending graceful fade and releases only once', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    let releases = 0
    const audio = createPlayerAudio(context, { buffer, loop: true }, 50, () => releases++)
    audio.start(10)
    audio.fadeOut()
    const queuedEnd = source(audio).onended!
    audio.stop()
    queuedEnd()
    assert.deepEqual(source(audio).stops, [10.005, undefined])
    assert.equal(releases, 1)
    assert.equal(gain(audio).disconnects, 1)
})

test('suspension during a graceful fade releases the source instead of stranding its owner', (t) => {
    const { context, buffer, source, gain } = fixture(t)
    let releases = 0
    const audio = createPlayerAudio(context, { buffer, loop: true }, 50, () => releases++)
    audio.start(10)
    audio.fadeOut()
    Object.assign(context, { currentTime: 10.001, state: 'suspended' })
    context.dispatchEvent(new Event('statechange'))
    context.dispatchEvent(new Event('statechange'))
    assert.deepEqual(source(audio).stops, [10.005, undefined])
    assert.equal(releases, 1)
    assert.equal(gain(audio).disconnects, 1)
})

test('changing volume during preroll preserves the scheduled attack through mute and unmute', (t) => {
    const { context, buffer, gain } = fixture(t)
    const audio = createPlayerAudio(context, { buffer }, 80, () => {})
    audio.fadeIn(11)
    audio.start(11)
    audio.setVolume(0)
    audio.setVolume(60)
    assert.deepEqual(gain(audio).gain.events.slice(-2), [
        { method: 'set', time: 11, value: 0 },
        { method: 'ramp', time: 11.005, value: 0.6 },
    ])
})

test('fallback interruption holds the interpolated gain during attack, decay and a volume ramp', (t) => {
    const { context, buffer, gain } = fixture(t)
    for (const [elapsed, expected] of [
        [0.002, 0.4],
        [0.052, 0.4],
    ]) {
        Object.assign(context, { currentTime: 10 })
        const audio = createPlayerAudio(context, { buffer }, 80, () => {})
        audio.envelope(10, 0.1, 0.004)
        audio.start(10)
        Object.assign(context, { currentTime: 10 + elapsed! })
        audio.fadeOut()
        const held = gain(audio).gain.events.at(-2)!
        assert.ok(Math.abs(held.value! - expected!) < 1e-10)
        assert.equal(gain(audio).gain.events.at(-1)!.value, 0)
    }

    Object.assign(context, { currentTime: 20 })
    const audio = createPlayerAudio(context, { buffer }, 20, () => {})
    audio.setVolume(100)
    Object.assign(context, { currentTime: 20.0025 })
    audio.setVolume(0)
    assert.ok(Math.abs(gain(audio).gain.events.at(-2)!.value! - 0.6) < 1e-10)
})

test('recovery skips expired holds, resumes spanning holds, and preserves their latest end', (t) => {
    const { context, buffer, source } = fixture(t)
    const actives = new Set<ActivePlayerAudio>()
    const schedule = (start: number, end: number, whenStart: number, whenStop: number) =>
        scheduleActivePlayerAudio(context, actives, buffer, start, end, 50, whenStart, whenStop)
    schedule(0, 4, 2, 8)
    assert.equal(actives.size, 0)
    schedule(0, 20, 2, 30)
    const active = [...actives][0]!
    assert.deepEqual(source(active).starts, [[10]])
    assert.deepEqual(source(active).stops, [30])

    schedule(5, 10, 12, 20)
    assert.equal(actives.size, 1)
    assert.equal(active.endBeat, 20)
    assert.deepEqual(source(active).stops, [30])
    schedule(20, 25, 30, 35)
    assert.equal(active.endBeat, 25)
    assert.deepEqual(source(active).stops, [30, 35])
    schedule(26, 30, 36, 40)
    assert.equal(actives.size, 2)
    assert.deepEqual(source([...actives][1]!).starts, [[36]])
    for (const audio of actives) audio.stop()
    assert.equal(actives.size, 0)
})

test('a stopped hold awaiting its ended event is replaced when playback resumes', (t) => {
    const { context, buffer, source } = fixture(t)
    const actives = new Set<ActivePlayerAudio>()
    scheduleActivePlayerAudio(context, actives, buffer, 0, 10, 50, 10, 12)
    const expired = [...actives][0]!
    const queuedEnd = source(expired).onended!
    Object.assign(context, { currentTime: 15 })
    scheduleActivePlayerAudio(context, actives, buffer, 10, 20, 50, 12, 20)
    assert.equal(actives.size, 1)
    const resumed = [...actives][0]!
    assert.notEqual(resumed, expired)
    assert.deepEqual(source(resumed).starts, [[15]])
    assert.deepEqual(source(resumed).stops, [20])
    assert.equal(source(expired).disconnects, 1)
    queuedEnd()
    assert.equal(actives.size, 1)
})
