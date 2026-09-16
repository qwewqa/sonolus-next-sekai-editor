import assert from 'node:assert/strict'
import test from 'node:test'
import {
    LAYER_ACTIVE_SLIDE_CONNECTOR_TOP,
    LAYER_GUIDE_CONNECTOR_OVER,
    LAYER_GUIDE_CONNECTOR_UNDER,
    LAYER_NOTE_BODY,
    LAYER_STAGE,
    getZ,
    getZAlt,
    setLayerTime,
} from '../../src/preview/engine/layer'

const compare = (left: readonly number[], right: readonly number[]) => {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0)
        if (difference) return difference
    }
    return 0
}

test('elevated stages cover lower notes while fixed connector layers remain outside', () => {
    const note = getZ(LAYER_NOTE_BODY, 2, 0, 0, false, 0)
    const lowStage = getZAlt(LAYER_STAGE, 1, 0)
    const elevatedStage = getZAlt(LAYER_STAGE, 1, 1)

    assert.ok(compare(lowStage, note) < 0)
    assert.ok(compare(elevatedStage, note) > 0)
    assert.ok(compare(getZ(LAYER_GUIDE_CONNECTOR_UNDER, 2, 0, 0, false, 100), lowStage) < 0)
    assert.ok(compare(getZ(LAYER_GUIDE_CONNECTOR_OVER, 2, 0, 0, false, -100), elevatedStage) > 0)
})

test('coincident elevation layers use elapsed target time in the engine order', () => {
    setLayerTime(5)
    try {
        assert.deepEqual(getZ(LAYER_NOTE_BODY, 4, -2), [16, 0.02, 1, 2])
        assert.deepEqual(getZ(LAYER_ACTIVE_SLIDE_CONNECTOR_TOP, 4, 2, 0, true, 0.05), [
            16,
            0.05 - 0.03,
            -1,
            2.05,
        ])
        assert.deepEqual(getZAlt(LAYER_STAGE, 23, 2), [16, 1.91, 23, 0])
    } finally {
        setLayerTime(0)
    }
})
