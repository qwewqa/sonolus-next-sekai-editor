import assert from 'node:assert/strict'
import test from 'node:test'
import { inverseAffine } from '../../src/editor/composedPointer'

test('a note and selected stage controls receive one inverse raw translation', () => {
    // Moving a note, its pivot, and its horizontal translation adds the same
    // raw delta three times to its composed position.
    const delta = inverseAffine(10, { input: 0, output: 4 }, { input: 1, output: 7 })
    assert.equal(delta, 2)
    assert.equal(4 + 3 * delta!, 10)
})

test('scaling a note with its pivot inverts the common factor about a nonzero baseline', () => {
    // Note [0, 2] and pivot 4 compose to a right edge at 6. Both scale together.
    const factor = inverseAffine(8, { input: 1, output: 6 }, { input: 2, output: 12 })
    assert.equal(factor, 4 / 3)
    assert.equal(6 * factor!, 8)
})

test('partial and overshooting stage weights support fractional and negative responses', () => {
    assert.equal(inverseAffine(5, { input: 0, output: 2 }, { input: 1, output: 3.5 }), 2)
    assert.equal(inverseAffine(3, { input: 0, output: 2 }, { input: 1, output: 1.5 }), -2)
    assert.equal(inverseAffine(5, { input: 1, output: 2 }, { input: 0.5, output: 1.25 }), 3)
})

test('returning to the original pointer preserves its exact raw parameter', () => {
    const original = 1 / 3
    assert.equal(
        inverseAffine(7, { input: original, output: 7 }, { input: 1, output: 7 }),
        original,
    )
    assert.equal(
        inverseAffine(7, { input: original, output: 7 }, { input: NaN, output: NaN }),
        original,
    )
})

test('singular or indistinguishable responses do not produce enormous pointer edits', () => {
    assert.equal(inverseAffine(8, { input: 0, output: 7 }, { input: 1, output: 7 }), undefined)
    assert.equal(inverseAffine(8, { input: 0, output: 7 }, { input: 0, output: 8 }), undefined)
    assert.equal(
        inverseAffine(8, { input: 0, output: 7 }, { input: 1, output: 7 + Number.EPSILON * 8 }),
        undefined,
    )
    assert.equal(
        inverseAffine(1e12 + 1, { input: 0, output: 1e12 }, { input: 1, output: 1e12 + 0.0001 }),
        undefined,
    )
    // A small but resolvable response remains usable.
    assert.equal(
        inverseAffine(1e12 + 0.25, { input: 0, output: 1e12 }, { input: 1, output: 1e12 + 0.125 }),
        2,
    )
})

test('nonfinite inputs and overflowing inverses have no result', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
        assert.equal(
            inverseAffine(invalid, { input: 0, output: 0 }, { input: 1, output: 1 }),
            undefined,
        )
        assert.equal(
            inverseAffine(1, { input: invalid, output: 0 }, { input: 1, output: 1 }),
            undefined,
        )
        assert.equal(
            inverseAffine(1, { input: 0, output: invalid }, { input: 1, output: 1 }),
            undefined,
        )
        assert.equal(
            inverseAffine(1, { input: 0, output: 0 }, { input: invalid, output: 1 }),
            undefined,
        )
        assert.equal(
            inverseAffine(1, { input: 0, output: 0 }, { input: 1, output: invalid }),
            undefined,
        )
    }
    assert.equal(
        inverseAffine(1e308, { input: 0, output: 0 }, { input: 1e308, output: 1 }),
        undefined,
    )
})
