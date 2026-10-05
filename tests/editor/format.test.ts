import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTime } from '../../src/utils/format'

test('times format to the millisecond and carry rounding into seconds and minutes', () => {
    assert.equal(formatTime(0), '00:00.000')
    assert.equal(formatTime(1.25), '00:01.250')
    assert.equal(formatTime(0.9996), '00:01.000')
    assert.equal(formatTime(59.9996), '01:00.000')
    assert.equal(formatTime(119.9995), '02:00.000')
    assert.equal(formatTime(61.0004), '01:01.000')
    assert.equal(formatTime(754.5), '12:34.500')
})
