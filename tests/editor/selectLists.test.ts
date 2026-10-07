import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepOption } from '../../src/modals/form/selectLists'

// A Mixed placeholder and an unknown value, both hidden, then six options; the fourth disabled.
const options = ['mixed', 'unknown', 'a', 'b', 'c', 'off', 'd', 'e']
const choosable = (index: number) => index >= 2 && options[index] !== 'off'
const step = (selected: string, key: string) => {
    const index = stepOption(options.length, options.indexOf(selected), key, choosable)
    return index === undefined ? undefined : options[index]
}

test('closed arrows step to the next or previous choosable option and stop at the ends', () => {
    assert.equal(step('a', 'ArrowDown'), 'b')
    assert.equal(step('a', 'ArrowRight'), 'b')
    assert.equal(step('c', 'ArrowDown'), 'd')
    assert.equal(step('d', 'ArrowUp'), 'c')
    assert.equal(step('d', 'ArrowLeft'), 'c')
    assert.equal(step('e', 'ArrowDown'), undefined)
    assert.equal(step('a', 'ArrowUp'), undefined)
})

test('a hidden placeholder steps forward to the first option, and nothing comes before it', () => {
    assert.equal(step('mixed', 'ArrowDown'), 'a')
    assert.equal(step('mixed', 'ArrowUp'), undefined)
    assert.equal(step('unknown', 'ArrowDown'), 'a')
})

test('Home and End go to the ends; page keys move three, as a closed system select does', () => {
    assert.equal(step('c', 'Home'), 'a')
    assert.equal(step('a', 'End'), 'e')
    assert.equal(step('mixed', 'PageDown'), 'b')
    assert.equal(step('a', 'PageDown'), 'd')
    assert.equal(step('d', 'PageDown'), 'e')
    assert.equal(step('e', 'PageUp'), 'c')
    assert.equal(step('b', 'PageUp'), 'a')
})

test('other keys leave stepping to the browser', () => {
    assert.equal(step('a', 'Enter'), undefined)
    assert.equal(step('a', 'x'), undefined)
})
