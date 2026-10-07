import assert from 'node:assert/strict'
import test from 'node:test'
import { nameColorOn } from '../../src/editor/canvas/nameColors'

test('a name over light and dark fills at once keeps its colour', () => {
    assert.equal(nameColorOn('#f6f', ['#dafdf1', '#222222']), '#f6f')
    assert.equal(nameColorOn('#0aa', ['#222222', '#dafdf1']), '#0aa')
    // Light fills alone still darken it.
    assert.equal(nameColorOn('#f6f', ['#dafdf1', '#aabfff']), '#808')
})

test('a fill is light where black reads better than white on it', () => {
    // Black and white read equally at a luminance of 0.179, between these greys.
    assert.equal(nameColorOn('#f6f', ['#757575']), '#f6f')
    assert.equal(nameColorOn('#0aa', ['#757575']), '#0aa')
    assert.equal(nameColorOn('#f6f', ['#767676']), '#202')
    assert.equal(nameColorOn('#0aa', ['#767676']), '#022')
})
