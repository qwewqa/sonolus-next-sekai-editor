import assert from 'node:assert/strict'
import test from 'node:test'
import { errorMessage } from '../../src/utils/error'

test('errors show their message without the "Error: " prefix', () => {
    assert.equal(
        errorMessage(new Error('Invalid level: zero or negative BPM')),
        'Invalid level: zero or negative BPM',
    )
    assert.equal(
        errorMessage(new RangeError('Invalid spectrum sample rate')),
        'Invalid spectrum sample rate',
    )
    assert.equal(
        errorMessage(new DOMException('Decoding failed', 'EncodingError')),
        'Decoding failed',
    )
})

test('errors without a message and thrown non-errors still show text', () => {
    assert.equal(errorMessage(new TypeError()), 'TypeError')
    assert.equal(errorMessage('Failed to load'), 'Failed to load')
    assert.equal(errorMessage(42), '42')
})
