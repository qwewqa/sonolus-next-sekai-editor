import assert from 'node:assert/strict'
import test from 'node:test'
import { shownBeatRanges, spacedTimes } from '../../src/playerSections'

const change = (beat: number, hideNotes: boolean) => ({ beat, hideNotes })

test('hold sounds pause while their group hides notes', () => {
    assert.deepEqual(shownBeatRanges([], 2, 6), [[2, 6]])
    assert.deepEqual(shownBeatRanges([change(3, true), change(5, false)], 2, 6), [
        [2, 3],
        [5, 6],
    ])
    // The last change at or before the start sets the initial state.
    assert.deepEqual(shownBeatRanges([change(1, true), change(2, false)], 2, 6), [[2, 6]])
    assert.deepEqual(shownBeatRanges([change(2, true), change(4, false)], 2, 6), [[4, 6]])
    // A change at the end is ignored.
    assert.deepEqual(shownBeatRanges([change(6, true)], 2, 6), [[2, 6]])
    assert.deepEqual(shownBeatRanges([change(0, true)], 2, 6), [])
})

test('repeated plays of one clip within the spacing are dropped', () => {
    assert.deepEqual(spacedTimes([1, 1.01, 1.03, 2], 0.02), [1, 1.03, 2])
    assert.deepEqual(spacedTimes([1.01, 1.5], 0.02, 1), [1.5])
})
