import assert from 'node:assert/strict'
import test from 'node:test'
import { getNotesAtBeat } from '../../src/editor/elevation/candidates'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const source = (beat: number): NoteEntity => ({ beat }) as NoteEntity

test('beat grid candidates include both sides of fractional bucket boundaries only within tolerance', () => {
    const before = source(4 - 1e-9)
    const exact = source(4)
    const after = source(4 + 1e-9)
    const distant = source(4.0001)
    const grid = new Map([
        [3, new Set([before])],
        [4, new Set([exact, after, distant])],
    ])
    assert.deepEqual(new Set(getNotesAtBeat(grid, 4)), new Set([before, exact, after]))
    assert.deepEqual(new Set(getNotesAtBeat(grid, before.beat)), new Set([before, exact, after]))
    const fractional = source(1 / 3)
    grid.set(0, new Set([fractional]))
    assert.deepEqual(getNotesAtBeat(grid, 1 / 3 + 1e-12), [fractional])
    assert.deepEqual(getNotesAtBeat(grid, Number.NaN), [])
    assert.deepEqual(getNotesAtBeat(grid, Infinity), [])
    assert.deepEqual(getNotesAtBeat(grid, -Infinity), [])
    assert.deepEqual(getNotesAtBeat(grid, 1e20), [])
})

test('beat grid candidates deduplicate shared bucket entries and handle negative boundaries', () => {
    const shared = source(0)
    const negative = source(-1e-9)
    const grid = new Map([
        [-1, new Set([shared, negative])],
        [0, new Set([shared])],
    ])
    assert.deepEqual(getNotesAtBeat(grid, 0), [shared, negative])
})
