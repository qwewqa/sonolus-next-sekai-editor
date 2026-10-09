import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    attachedDragElevation,
    inverseAttachedElevation,
    type AttachedElevationDrag,
} from '../../src/editor/elevation/drag'

const base: AttachedElevationDrag = {
    head: 0,
    tail: 4,
    note: 1,
    headStage: 0,
    tailStage: 4,
    headMoves: false,
    tailMoves: false,
}
const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('attached elevation drag inverts stage offsets and clamps at both endpoints', () => {
    close(inverseAttachedElevation(base, 4), 1)
    close(inverseAttachedElevation(base, 100), 3)
    close(inverseAttachedElevation(base, -100), -1)
    close(inverseAttachedElevation(base, 2, 2), 0)
})

for (const headMoves of [false, true]) {
    for (const tailMoves of [false, true]) {
        for (const reverse of [false, true]) {
            test(`attached drag follows a shared edit: head=${headMoves}, tail=${tailMoves}, reverse=${reverse}`, () => {
                const drag = {
                    ...base,
                    ...(reverse ? { head: 4, tail: 0, note: 3, tailStage: -4 } : {}),
                    headMoves,
                    tailMoves,
                }
                for (const delta of [-0.25, 0.25, 0.5]) {
                    const displayed = attachedDragElevation(drag, delta)
                    close(inverseAttachedElevation(drag, displayed, delta), delta)
                }
            })
        }
    }
}

test('flat and degenerate responses retain the original raw elevation', () => {
    close(inverseAttachedElevation({ ...base, tailStage: -4 }, 2), 0)
    close(inverseAttachedElevation({ ...base, tail: 0 }, 2.5), 0)
    close(inverseAttachedElevation({ ...base, tail: 0.0000001 }, 2.5), 0)
    close(inverseAttachedElevation({ ...base, tail: 0, headMoves: true, tailMoves: true }, 4), 2)
})

test('co-selected endpoint response keeps the nearest of multiple valid roots', () => {
    const drag = { ...base, headMoves: true, tailStage: -4 }
    const first = inverseAttachedElevation(drag, 0.5)
    const second = inverseAttachedElevation(drag, 0.5, 3)
    close(attachedDragElevation(drag, first), 0.5)
    close(attachedDragElevation(drag, second), 0.5)
    assert.ok(first < 2 && second > 2)
})

test('selected endpoints can open and reverse the raw elevation span', () => {
    for (const drag of [
        { ...base, head: 0, tail: 0, note: 0, tailStage: 0, headMoves: true },
        { ...base, head: 0, tail: 1, note: 0.5, tailStage: 0, headMoves: true },
    ]) {
        const delta = inverseAttachedElevation(drag, 2)
        close(delta, 2)
        close(attachedDragElevation(drag, delta), 2)
    }
})

test('unreachable pointer positions consider the strict midpoint band', () => {
    const drag = { ...base, tailStage: -4, headMoves: true }
    for (const target of [2.1, 2.6]) {
        const delta = inverseAttachedElevation(drag, target)
        assert.ok(
            Math.abs(attachedDragElevation(drag, delta) - target) < Math.abs(2 - target) + 1e-8,
        )
    }
})

test('affine scaling coefficients include moving stage elevations', () => {
    const drag = {
        ...base,
        headMoves: -0.5,
        tailMoves: 2,
        noteMoves: 0.25,
        headStageMoves: 1.5,
        tailStageMoves: -0.25,
    }
    for (const delta of [-1, -0.25, 0.25, 1, 4]) {
        const target = attachedDragElevation(drag, delta)
        close(attachedDragElevation(drag, inverseAttachedElevation(drag, target, delta)), target)
    }
})

test('unreachable affine targets consider the outer side of the midpoint threshold', () => {
    const drag = {
        head: -7.5,
        tail: 2.25,
        note: 7.75,
        headStage: -0.25,
        tailStage: 6.5,
        headMoves: 1.125,
        tailMoves: 0.8125,
        noteMoves: 0.8125,
        headStageMoves: -1.1875,
        tailStageMoves: -1,
    }
    const delta = inverseAttachedElevation(drag, 1.5)
    assert.ok(Math.abs(attachedDragElevation(drag, delta) - 1.5) < 1.400001)
})

test('out-of-range authored elevation can reenter the visible span and return unchanged', () => {
    const drag = { ...base, note: -1 }
    close(inverseAttachedElevation(drag, 2), 2)
    close(inverseAttachedElevation(drag, 0, 2), 0)
})
