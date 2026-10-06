import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maskedConnectorExtentsByLimits } from '../../src/preview/engine/connector'
import {
    interpolateVisualMasks,
    maskedNoteExtents,
    passedHeadMask,
} from '../../src/preview/engine/mask'

// Engine v2.15.1: crossed mask limits collapse to their midpoint (e01839a, c828653).

test('an interpolated mask whose right edge passes its left collapses to the midpoint', () => {
    const head = { enabled: true, left: -2, right: 2, stageIndex: 1 }
    const tail = { enabled: true, left: 4, right: -4, stageIndex: 1 }
    // At 3/4 the limits are left 2.5, right -2.5.
    assert.deepEqual(interpolateVisualMasks(head, tail, 0.75), {
        enabled: true,
        left: 0,
        right: 0,
        stageIndex: 1,
    })
    // Uncrossed limits interpolate as before.
    assert.deepEqual(interpolateVisualMasks(head, tail, 0.25), {
        enabled: true,
        left: -0.5,
        right: 0.5,
        stageIndex: 1,
    })
})

test('a note masked by crossed limits keeps its tip at their midpoint', () => {
    const mask = { enabled: true, left: 3, right: 1 }
    assert.deepEqual(maskedNoteExtents(0, 1, mask), { lane: 2, size: 0 })
    assert.deepEqual(maskedNoteExtents(5, 1, mask), { lane: 2, size: 0 })
    // A disabled mask leaves the note alone.
    assert.deepEqual(maskedNoteExtents(0, 1, { ...mask, enabled: false }), { lane: 0, size: 1 })
    // Sizes floor at 0 first, as masked_note_extents_by_limits does.
    assert.deepEqual(maskedNoteExtents(0, -1, { ...mask, enabled: false }), { lane: 0, size: 0 })
    assert.deepEqual(maskedNoteExtents(0, -1, mask), { lane: 2, size: 0 })
})

test('a connector masked by crossed limits keeps its tip at their midpoint', () => {
    for (const lane of [-5, 2, 5]) {
        const { lane: renderLane, size, maskedSize } = maskedConnectorExtentsByLimits(lane, 1, 3, 1)
        assert.equal(renderLane, 2)
        assert.equal(size, 0)
        assert.equal(maskedSize, 0)
    }
    // Uncrossed limits clamp as before.
    assert.deepEqual(maskedConnectorExtentsByLimits(0, 1, -0.5, 4), {
        lane: 0.25,
        size: 0.75,
        maskedSize: 0.75,
    })
})

test("a passed head's mask lerps without collapsing, as the engine's connector does", () => {
    const head = { enabled: true, left: -2, right: 2, stageIndex: 1 }
    const tail = { enabled: true, left: 4, right: -4, stageIndex: 2 }
    // Crossed limits stay crossed; each drawn segment collapses its own.
    assert.deepEqual(passedHeadMask(head, tail, 0.75), {
        enabled: true,
        left: 2.5,
        right: -2.5,
        stageIndex: 1,
    })
    // Without both masks, the head keeps its own.
    assert.deepEqual(passedHeadMask(head, { ...tail, enabled: false }, 0.75), head)
})
