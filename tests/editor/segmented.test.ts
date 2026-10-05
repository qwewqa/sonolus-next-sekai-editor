import assert from 'node:assert/strict'
import test from 'node:test'
import {
    choiceLayout,
    segmentedWidth,
    segmentsFit,
    selectGlyphFits,
} from '../../src/modals/form/segmented'

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

test('glyphs drop before the segments, and the segments before the select', () => {
    // Labels 70 + 43 need 149px; glyphs add 20px each.
    assert.equal(choiceLayout(189, [70, 43], false, 16, true), 'glyphs')
    assert.equal(choiceLayout(188, [70, 43], false, 16, true), 'segments')
    assert.equal(choiceLayout(149, [70, 43], false, 16, true), 'segments')
    assert.equal(choiceLayout(148, [70, 43], false, 16, true), 'select')
    // Without a glyph the segments show as before.
    assert.equal(choiceLayout(400, [70, 43], false, 16, false), 'segments')
    assert.equal(choiceLayout(0, [], false, 16, true), 'select')
})

test('a select glyph never costs a name its room', () => {
    // 66px of insets beside the longest name.
    assert.equal(selectGlyphFits(136, [70, 43], 16), true)
    assert.equal(selectGlyphFits(135, [70, 43], 16), false)
    assert.equal(selectGlyphFits(0, [], 16), false)
})
