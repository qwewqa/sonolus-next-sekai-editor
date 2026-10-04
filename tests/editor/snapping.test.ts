import assert from 'node:assert/strict'
import test from 'node:test'
import { snappedOffset } from '../../src/editor/snapping'

test('relative snapping preserves an off-grid anchor and rounds only the drag distance', () => {
    assert.equal(snappedOffset(1.3, 1.71, 0.15, 4, 'relative'), 0.5)
    assert.equal(snappedOffset(1.3, 0.89, 0.15, 4, 'relative'), -0.5)
})

test('absolute snapping aligns the object position while preserving the pointer grab offset', () => {
    assert.ok(Math.abs(snappedOffset(1.3, 1.71, 0.15, 4, 'absolute') - 0.35) < 1e-12)
    assert.ok(Math.abs(snappedOffset(1.3, 0.89, 0.15, 4, 'absolute') + 0.4) < 1e-12)
})

test('the default whole-lane relative snapping keeps existing drag behavior', () => {
    assert.equal(snappedOffset(-2.2, -1.8, -3.25, 1, 'relative'), 0)
    assert.equal(snappedOffset(-2.2, -1.6, -3.25, 1, 'relative'), 1)
})
