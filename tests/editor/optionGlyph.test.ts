import assert from 'node:assert/strict'
import { test } from 'node:test'
import { h } from 'vue'
import { hasGlyphColumn } from '../../src/modals/form/optionGlyph'

test('a list shows its picture column only when every value has a known picture', () => {
    const icon = h('svg')
    assert.equal(hasGlyphColumn(undefined, ['a']), false)
    assert.equal(
        hasGlyphColumn(() => icon, ['a', 'b']),
        true,
    )
    // A value without a picture by nature keeps the column, with a blank slot.
    assert.equal(
        hasGlyphColumn((value) => (value === 'none' ? null : icon), ['none', 'up']),
        true,
    )
    // One unknown picture drops the whole column.
    assert.equal(
        hasGlyphColumn((value) => (value === 'in' ? undefined : icon), ['none', 'in']),
        false,
    )
})
