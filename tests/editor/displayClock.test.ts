import assert from 'node:assert/strict'
import test from 'node:test'
import { createDisplayClock } from '../../src/displayClock'

const close = (actual: number, expected: number, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`)

test('the display clock runs on wall time between uneven audio blocks', () => {
    const clock = createDisplayClock()
    close(clock.read(1, 100, true), 1)
    // Blocks of 20 and 10.7 ms arrive against 16.7 ms frames.
    close(clock.read(1.02, 100.0167, true), 1.0167, 0.002)
    close(clock.read(1.0307, 100.0334, true), 1.0334, 0.002)
    close(clock.read(1.0507, 100.0501, true), 1.0501, 0.002)
})

test('the display clock eases toward a drifting audio clock', () => {
    const clock = createDisplayClock()
    clock.read(0, 0, true)
    // Audio runs 1% slow; the display follows it within a few milliseconds.
    let shown = 0
    for (let frame = 1; frame <= 600; frame++) {
        const now = frame / 60
        shown = clock.read(now * 0.99, now, true)
    }
    close(shown, 10 * 0.99, 0.005)
})

test('the display clock starts over past 25 ms and never moves back', () => {
    const clock = createDisplayClock()
    clock.read(2, 50, true)
    clock.read(2.016, 50.016, true)
    // The audio clock stalls; the display runs on for less than 25 ms...
    close(clock.read(2.016, 50.03, true), 2.03, 0.002)
    // ...then waits for it without moving back.
    close(clock.read(2.016, 50.2, true), 2.03, 0.002)
    close(clock.read(2.016, 50.3, true), 2.03, 0.002)
    // It jumps ahead with the audio clock after a long stall.
    close(clock.read(2.5, 50.4, true), 2.5)
})

test('a suspended audio clock is shown as it stands', () => {
    const clock = createDisplayClock()
    clock.read(3, 10, true)
    close(clock.read(3.01, 10.5, false), 3.01)
    close(clock.read(3.01, 11, false), 3.01)
    // Resuming continues from the audio clock.
    close(clock.read(3.01, 12, true), 3.01)
})

test('reset forgets the previous playback', () => {
    const clock = createDisplayClock()
    clock.read(5, 10, true)
    clock.read(5.02, 10.02, true)
    clock.reset()
    close(clock.read(1, 11, true), 1)
})
