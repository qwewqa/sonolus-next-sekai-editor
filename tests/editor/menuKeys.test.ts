import assert from 'node:assert/strict'
import { test } from 'node:test'
import { menuKeyIndex } from '../../src/utils/menuKeys'

test('menu arrows stop at the ends rather than wrapping', () => {
    assert.equal(menuKeyIndex('ArrowDown', 2, 3), 2)
    assert.equal(menuKeyIndex('ArrowUp', 0, 3), 0)
    assert.equal(menuKeyIndex('ArrowDown', 0, 3), 1)
    assert.equal(menuKeyIndex('ArrowUp', -1, 3), 2)
    assert.equal(menuKeyIndex('ArrowDown', -1, 3), 0)
    assert.equal(menuKeyIndex('Home', 2, 3), 0)
    assert.equal(menuKeyIndex('End', 0, 3), 2)
    assert.equal(menuKeyIndex('ArrowDown', -1, 0), undefined)
    assert.equal(menuKeyIndex('Tab', 0, 3), undefined)
})
