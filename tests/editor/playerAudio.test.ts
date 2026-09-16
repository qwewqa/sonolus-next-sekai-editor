import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
    createPlayerAudio,
    getPlayerAudioStartTime,
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
            this.stops.push(when)
        }
    }
    class Gain {
        disconnects = 0
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
    const context = { currentTime: 10, destination: {} } as AudioContext
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
        audio.source.start(20)
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
    audio.source.start(10, 3, 0.1)
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

test('frame recovery limits catch-up to the audio lead at slow and fast playback speeds', () => {
    const state = { lastTime: 101, time: 100, contextTime: 5 }
    const now = 160
    const contextTime = 65
    const delay = 0.2
    const from = getPlayerAudioStartTime(state, now, contextTime, delay)
    for (const speed of [0.5, 1, 2]) {
        const chartFrom = (from - state.time) * speed + 7
        const chartNow = (now - state.time) * speed + 7
        const scheduleTime = (chartTime: number) =>
            (chartTime - 7) / speed + state.contextTime + delay
        assert.ok(Math.abs(scheduleTime(chartFrom) - contextTime) < 1e-10)
        assert.ok(Math.abs(scheduleTime(chartNow) - contextTime - delay) < 1e-10)
        assert.ok(scheduleTime(chartFrom - speed) < contextTime)
        assert.ok(chartNow - chartFrom < speed * 0.201)
    }
    assert.equal(
        getPlayerAudioStartTime({ ...state, lastTime: 159.99 }, now, contextTime, delay),
        159.99,
    )
    // A clock discrepancy must not move the scan boundary into a future frame.
    assert.equal(getPlayerAudioStartTime(state, now, contextTime + 5, delay), now)
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
