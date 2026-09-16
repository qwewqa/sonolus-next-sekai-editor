import assert from 'node:assert/strict'
import test from 'node:test'
import { integrateScrollInertia } from '../../src/editor/inertia'

test('a delayed frame cannot move a flick beyond its stopping distance', () => {
    for (const direction of [-1, 1]) {
        for (const delta of [0.1, 1, 60]) {
            const motion = integrateScrollInertia(direction * 80, delta)
            assert.equal(motion.distance, direction * 4)
            assert.equal(Math.abs(motion.velocity), 0)
        }
    }
    assert.equal(integrateScrollInertia(0, 60).distance, 0)
})

test('inertial scrolling covers the same distance across smooth and interrupted frames', () => {
    const integrate = (frames: number[]) => {
        let velocity = 800
        let distance = 0
        for (const delta of frames) {
            const motion = integrateScrollInertia(velocity, delta)
            velocity = motion.velocity
            distance += motion.distance
        }
        return { distance, velocity }
    }
    for (const frames of [Array<number>(120).fill(1 / 60), [0.1, 0.05, 3], [60]]) {
        const motion = integrate(frames)
        assert.ok(Math.abs(motion.distance - 400) < 1e-9)
        assert.equal(motion.velocity, 0)
    }
})
