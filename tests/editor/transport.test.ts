import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope, nextTick, ref, shallowReactive, watch } from 'vue'
import { createTransport } from '../../src/editor/transport'

const fixture = (t: TestContext) => {
    type Dependencies = Parameters<typeof createTransport>[0]
    const view = shallowReactive<Dependencies['view']>({
        cursorTime: 3,
        time: 4,
        h: 600,
        scrollingY: undefined,
    })
    const settings = { playFollow: false, playFollowPosition: 25, pps: 100 }
    const clock = { now: 10, audio: undefined as number | undefined }
    const starts: { time: number; speed: number; delay?: number }[] = []
    const auditions: number[] = []
    let stopped = 0
    let auditionsStopped = 0
    let active = 0
    const notifications: (string | number)[] = []
    const flushVersion = ref(0)
    const transport = createTransport({
        audio: {
            start(time, speed, delay) {
                starts.push({ time, speed, delay })
                clock.audio = time
            },
            stop() {
                stopped++
                clock.audio = undefined
            },
            getTime: () => clock.audio,
            audition: (time) => auditions.push(time),
            stopAudition: () => auditionsStopped++,
        },
        view,
        settings,
        now: () => clock.now,
        focus: (time) => {
            view.cursorTime = time
        },
        activate: () => active++,
        queueFlush: () => flushVersion.value++,
        onPlay: () => notifications.push('play'),
        onStop: () => notifications.push('stop'),
        onSpeedChange: (speed) => notifications.push(speed),
    })
    const scope = effectScope()
    scope.run(() => {
        watch(() => view.cursorTime, transport.cursorChanged, { flush: 'sync' })
        watch(flushVersion, transport.flushAudition)
    })
    t.after(() => scope.stop())
    return {
        transport,
        view,
        settings,
        clock,
        starts,
        auditions,
        notifications,
        counts: () => ({ stopped, auditionsStopped, active }),
    }
}

test('note auditions preserve the cursor and take precedence over implicit cursor changes', async (t) => {
    const { transport, view, auditions } = fixture(t)
    transport.audition(12)
    assert.equal(view.cursorTime, 3)
    view.cursorTime = 5
    transport.audition(13)
    await nextTick()
    assert.deepEqual(auditions, [13])
    assert.equal(view.cursorTime, 5)
    view.cursorTime = 6
    await nextTick()
    assert.deepEqual(auditions, [13, 6])
})

test('steps override queued notes and later note auditions override steps', async (t) => {
    const { transport, view, auditions } = fixture(t)
    view.cursorTime = 3.123456
    transport.audition(12)
    transport.step(1)
    transport.step(10)
    await nextTick()
    assert.equal(view.cursorTime, 3.123456 + 0.001 + 0.01)
    assert.deepEqual(auditions, [view.cursorTime])
    transport.step(100)
    transport.audition(14)
    await nextTick()
    assert.deepEqual(auditions, [3.123456 + 0.001 + 0.01, 14])
})

test('clamped steps replace old audio and cancel pending notes or cursor changes', async (t) => {
    const { transport, view, auditions } = fixture(t)
    transport.audition(8)
    await nextTick()
    transport.audition(12)
    view.cursorTime = 0
    transport.step(-100)
    await nextTick()
    assert.equal(view.cursorTime, 0)
    assert.deepEqual(auditions, [8, 0])
})

test('stopping a paused transport cancels pending note and cursor auditions before they flush', async (t) => {
    const { transport, view, auditions } = fixture(t)
    transport.audition(12)
    transport.stop()
    await nextTick()
    assert.deepEqual(auditions, [])

    view.cursorTime = 5
    transport.stop()
    await nextTick()
    assert.deepEqual(auditions, [])

    // New interactions after the stop retain their normal audition behavior.
    transport.audition(14)
    await nextTick()
    assert.deepEqual(auditions, [14])
})

test('play and pause discard queued auditions and pause captures the audio clock', async (t) => {
    const { transport, view, clock, starts, auditions } = fixture(t)
    transport.audition(8)
    transport.play(view.cursorTime)
    await nextTick()
    assert.deepEqual(starts, [{ time: 3, speed: 1, delay: undefined }])
    assert.deepEqual(auditions, [])
    clock.audio = 3.123456
    view.cursorTime = 9
    transport.audition(12)
    transport.pause()
    await nextTick()
    assert.equal(view.cursorTime, 3.123456)
    assert.equal(transport.isPlaying, false)
    assert.deepEqual(auditions, [])
    transport.audition(14)
    await nextTick()
    assert.deepEqual(auditions, [14])
})

test('stepping during playback preserves the displayed position while speed changes use audio time', async (t) => {
    const { transport, view, clock, starts, auditions, counts } = fixture(t)
    transport.play(3)
    clock.audio = 4.25
    transport.changeSpeed(-1)
    assert.deepEqual(starts.at(-1), { time: 4.25, speed: 0.75, delay: 0 })
    assert.equal(view.cursorTime, 3)
    transport.step(10)
    await nextTick()
    assert.equal(transport.isPlaying, false)
    assert.equal(counts().stopped, 1)
    assert.equal(view.cursorTime, 3.01)
    assert.deepEqual(auditions, [3.01])
})

test('stop returns to the original play position after speed changes', async (t) => {
    const { transport, view, clock, notifications } = fixture(t)
    transport.play(3)
    clock.audio = 8
    transport.update()
    transport.changeSpeed(1)
    transport.stop(true)
    await nextTick()
    assert.equal(view.cursorTime, 3)
    assert.deepEqual(notifications, ['play', 1.5, 'stop'])
})

test('scrubbing cancels pending audio and auditions exactly once at release', async (t) => {
    const { transport, view, auditions, counts } = fixture(t)
    transport.step(10)
    transport.beginScrub()
    transport.scrubTo(4)
    await nextTick()
    assert.deepEqual(auditions, [])
    assert.equal(counts().auditionsStopped, 1)
    transport.audition(18)
    transport.scrubTo(4.250456)
    transport.endScrub()
    transport.endScrub()
    transport.scrubTo(20)
    await nextTick()
    assert.equal(view.cursorTime, 4.250456)
    assert.deepEqual(auditions, [4.250456])
})

test('cancelled scrub releases no audio and later note interactions still audition', async (t) => {
    const { transport, view, auditions } = fixture(t)
    transport.play(3)
    transport.beginScrub()
    transport.scrubTo(-1)
    transport.audition(18)
    transport.endScrub(false)
    await nextTick()
    assert.equal(view.cursorTime, 0)
    assert.equal(transport.isPlaying, false)
    assert.deepEqual(auditions, [])
    transport.audition(9)
    await nextTick()
    assert.deepEqual(auditions, [9])
})

test('play and exact steps take over a scrub without a release audition', async (t) => {
    const { transport, view, auditions, starts } = fixture(t)
    transport.beginScrub()
    transport.scrubTo(4.123456)
    transport.play(view.cursorTime)
    transport.scrubTo(20)
    assert.deepEqual(starts, [{ time: 4.123456, speed: 1, delay: undefined }])
    transport.beginScrub()
    transport.scrubTo(5.123456)
    transport.step(-1)
    transport.endScrub()
    await nextTick()
    assert.equal(view.cursorTime, 5.123456 - 0.001)
    assert.deepEqual(auditions, [view.cursorTime])
})

test('smooth follow retargets using the clock and cancels only its own scroll', (t) => {
    const { transport, view, settings, clock } = fixture(t)
    settings.playFollow = true
    transport.step(100)
    assert.deepEqual(view.scrollingY, {
        type: 'ease',
        from: { time: 10, viewTime: 4 },
        to: { time: 10.25, viewTime: 4.6 },
    })
    clock.now = 10.1
    view.time = 4.2
    transport.step(100)
    assert.deepEqual(view.scrollingY, {
        type: 'ease',
        from: { time: 10.1, viewTime: 4.2 },
        to: { time: 10.35, viewTime: 4.7 },
    })
    transport.cancelFollow()
    assert.equal(view.scrollingY, undefined)
    transport.step(100)
    const editorScroll = { type: 'inertia', value: 240 } as const
    view.scrollingY = editorScroll
    transport.cancelFollow()
    assert.equal(view.scrollingY, editorScroll)
})

test('locked scrub follows immediately and invalid input preserves state', async (t) => {
    const { transport, view, settings, auditions } = fixture(t)
    settings.playFollow = true
    transport.beginScrub('locked')
    assert.equal(view.time, 4.5)
    transport.scrubTo(5)
    assert.equal(view.time, 6.5)
    assert.equal(view.scrollingY, undefined)
    transport.scrubTo(NaN)
    transport.step(Infinity)
    transport.endScrub()
    await nextTick()
    assert.equal(view.cursorTime, 5)
    assert.deepEqual(auditions, [5])
})
