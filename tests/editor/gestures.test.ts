import assert from 'node:assert/strict'
import test from 'node:test'
import { gesture } from '../../src/editor/controls/gestures/gesture'
import { getOnlyEntityType } from '../../src/editor/tools/entityType'
import type { Entity } from '../../src/state/entities'

const pointer = (id: number) => ({ id, x: 0, y: 0, modifiers: { ctrl: false, shift: false } })

test('cancelling a pending gesture does not recognize a tap, and the next gesture works', () => {
    let taps = 0
    const resets: (boolean | undefined)[] = []
    const input = gesture({
        count: 1,
        recognize([, p]) {
            if (p.isActive) return false
            taps++
            return true
        },
        reset(cancelled) {
            resets.push(cancelled)
        },
    })
    input.start([pointer(1)])
    input.cancel()
    assert.equal(input.pointerCount, 0)
    assert.equal(taps, 0)
    assert.deepEqual(resets, [true])
    input.end([pointer(1)])
    assert.equal(taps, 0)
    input.start([pointer(2)])
    input.end([pointer(2)])
    assert.equal(taps, 1)
})

test('cancelling an active gesture resets it without delivering an ending update', () => {
    let updates = 0
    let cancelled = false
    const input = gesture({
        count: 1,
        recognize: () => true,
        update() {
            updates++
        },
        reset(value) {
            cancelled = value === true
        },
    })
    input.start([pointer(1)])
    input.move([pointer(1)])
    input.move([pointer(1)])
    assert.equal(updates, 1)
    input.cancel()
    assert.equal(updates, 1)
    assert.equal(cancelled, true)
    assert.equal(input.pointerCount, 0)
})

test('selection classification handles homogeneous, mixed and empty selections without mutation', () => {
    const note = { type: 'note' } as Entity
    const bpm = { type: 'bpm' } as Entity
    const notes = Object.freeze(Array<Entity>(6000).fill(note))
    assert.equal(getOnlyEntityType(notes), 'note')
    assert.equal(getOnlyEntityType([note, bpm]), undefined)
    assert.equal(getOnlyEntityType([]), undefined)
})
