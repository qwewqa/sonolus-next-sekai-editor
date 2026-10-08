import assert from 'node:assert/strict'
import test from 'node:test'
import { safeUnlerp, safeUnlerpClamped } from '../../src/utils/math'

test('safe unlerps take a fixed fraction for spans under 1e-6, as the engine does', () => {
    assert.equal(safeUnlerp(2, 2, 2), 0.5)
    assert.equal(safeUnlerp(2, 2 + 1e-7, 3), 0.5)
    assert.equal(safeUnlerp(2, 2, 2, 0), 0)
    assert.equal(safeUnlerp(2, 4, 5), 1.5)
    assert.equal(safeUnlerpClamped(2, 2, 2), 0.5)
    assert.equal(
        safeUnlerpClamped(2.9333333333333336, 2.9333333333333336, 2.9333333333333336, 1),
        1,
    )
    assert.equal(safeUnlerpClamped(2, 4, 3), 0.5)
    assert.equal(safeUnlerpClamped(2, 4, 5), 1)
    assert.equal(safeUnlerpClamped(2, 4, 1), 0)
})
