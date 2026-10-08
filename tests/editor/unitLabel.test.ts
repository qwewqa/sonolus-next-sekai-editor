import assert from 'node:assert/strict'
import test from 'node:test'
import { splitUnit, withoutUnit } from '../../src/utils/unitLabel'

test('a unit after a space is held whole, the space staying a break', () => {
    assert.deepEqual(splitUnit('Skip (beats)'), { text: 'Skip ', nowrap: '(beats)' })
    assert.deepEqual(splitUnit('オフセット (ミリ秒)'), {
        text: 'オフセット ',
        nowrap: '(ミリ秒)',
    })
})

test('a unit with no space before it keeps the character before it', () => {
    assert.deepEqual(splitUnit('水平捲動上限（軌道）'), {
        text: '水平捲動上',
        nowrap: '限（軌道）',
    })
    assert.deepEqual(splitUnit('背景音乐音量（%）'), { text: '背景音乐音', nowrap: '量（%）' })
})

test('labels without a trailing parenthetical are left whole', () => {
    assert.deepEqual(splitUnit('Lane'), { text: 'Lane', nowrap: '' })
    assert.deepEqual(splitUnit('Select (all) notes'), { text: 'Select (all) notes', nowrap: '' })
})

test('the unit drops from a label', () => {
    assert.equal(withoutUnit('Skip (beats)'), 'Skip')
    assert.equal(withoutUnit('Offset (ms)'), 'Offset')
    assert.equal(withoutUnit('略过（节拍）'), '略过')
    assert.equal(withoutUnit('Lane'), 'Lane')
})
