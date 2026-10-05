import assert from 'node:assert/strict'
import test from 'node:test'
import { segmentedWidth, segmentsFit } from '../../src/modals/form/segmented'

test('segments need every label plus padding, the unset segment and the track', () => {
    // 70 + 43 labels, 16px padding each, 4px track.
    assert.equal(segmentedWidth([70, 43], false, 16), 149)
    // The unset segment adds 2rem.
    assert.equal(segmentedWidth([70, 43], true, 16), 181)
    assert.equal(segmentedWidth([70, 43], false, 20), 158)
})

test('segments show only when no label would be cut off', () => {
    assert.equal(segmentsFit(149, [70, 43], false, 16), true)
    assert.equal(segmentsFit(148, [70, 43], false, 16), false)
    assert.equal(segmentsFit(170, [70, 43], true, 16), false)
    // A hidden control has no width yet and keeps the select.
    assert.equal(segmentsFit(0, [], false, 16), false)
})
