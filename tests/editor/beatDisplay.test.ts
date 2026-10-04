import assert from 'node:assert/strict'
import test from 'node:test'
import {
    formatBeatPosition,
    fromDisplayedBeat,
    toDisplayedBeat,
} from '../../src/editor/beatDisplay'
import { toBpmEntity } from '../../src/state/entities/bpm'
import {
    beatToMeasure,
    beatToTime,
    calculateBpms,
    getMeasureBeats,
    toBpmIntegral,
} from '../../src/state/integrals/bpms'

const bpms = calculateBpms([toBpmIntegral({ beat: 0, bpm: 120 })])

test('displayed beat conversion leaves zero-based chart positions and fractional offsets intact', () => {
    for (const chartBeat of [0, 0.25, 4, 1024.125]) {
        assert.equal(toDisplayedBeat(chartBeat), chartBeat + 1)
        assert.equal(fromDisplayedBeat(toDisplayedBeat(chartBeat)), chartBeat)
    }
    assert.equal(fromDisplayedBeat(1), 0)
})

test('legacy BPM changes default to four beats per measure', () => {
    assert.equal(toBpmEntity({ beat: 0, bpm: 120 }).meter, 4)
    assert.equal(bpms[0]!.meter, 4)
    assert.deepEqual(beatToMeasure(bpms, 0), { measure: 1, beat: 1 })
    assert.deepEqual(beatToMeasure(bpms, 4), { measure: 2, beat: 1 })
})

test('beat, measure and combined labels match the one-based display examples', () => {
    assert.deepEqual(
        [0, 1, 2, 3, 4].map((beat) => formatBeatPosition(bpms, beat, 'beat')),
        ['1', '2', '3', '4', '5'],
    )
    assert.deepEqual(
        [0, 1, 2, 3, 4].map((beat) => formatBeatPosition(bpms, beat, 'measure')),
        ['1.1', '1.2', '1.3', '1.4', '2.1'],
    )
    assert.deepEqual(
        [0, 1, 4].map((beat) => formatBeatPosition(bpms, beat, 'both')),
        ['1.1 (1)', '1.2 (2)', '2.1 (5)'],
    )
    assert.equal(formatBeatPosition(bpms, 0.25, 'beat', true), '1.250')
})

test('every BPM change starts a new measure even when its meter or tempo is unchanged', () => {
    const changes = calculateBpms(
        [
            { beat: 0, bpm: 120, meter: 4 },
            { beat: 2, bpm: 120, meter: 4 },
            { beat: 6, bpm: 90, meter: 3 },
            { beat: 8, bpm: 90, meter: 3 },
        ].map(toBpmIntegral),
    )
    assert.deepEqual(beatToMeasure(changes, 1), { measure: 1, beat: 2 })
    assert.deepEqual(beatToMeasure(changes, 2), { measure: 2, beat: 1 })
    assert.deepEqual(beatToMeasure(changes, 5), { measure: 2, beat: 4 })
    assert.deepEqual(beatToMeasure(changes, 6), { measure: 3, beat: 1 })
    assert.deepEqual(beatToMeasure(changes, 8), { measure: 4, beat: 1 })
    assert.deepEqual(beatToMeasure(changes, 11), { measure: 5, beat: 1 })
})

test('fractional BPM boundaries do not add a spurious measure through floating point error', () => {
    const changes = calculateBpms(
        [
            { beat: 0, bpm: 120 },
            { beat: 1 / 3, bpm: 90, meter: 3 },
            { beat: 1 / 3 + 3, bpm: 60, meter: 3 },
        ].map(toBpmIntegral),
    )
    assert.deepEqual(beatToMeasure(changes, 1 / 3 + 3), { measure: 3, beat: 1 })
    assert.deepEqual(beatToMeasure(changes, 1 / 3 + 6), { measure: 4, beat: 1 })
})

test('meter edits change labels without changing chart timing', () => {
    const changes = [
        { beat: 0, bpm: 120 },
        { beat: 8, bpm: 90 },
    ]
    const original = calculateBpms(changes.map(toBpmIntegral))
    const edited = calculateBpms(changes.map((change) => toBpmIntegral({ ...change, meter: 3 })))
    for (const beat of [0, 1, 7.5, 8, 12])
        assert.equal(beatToTime(edited, beat), beatToTime(original, beat))
    assert.deepEqual(beatToMeasure(edited, 8), { measure: 4, beat: 1 })
})

test('rebuilding BPM integrals recalculates measures instead of accumulating stale offsets', () => {
    const original = calculateBpms(
        [
            { beat: 0, bpm: 120 },
            { beat: 2, bpm: 90 },
        ].map(toBpmIntegral),
    )
    const moved = calculateBpms(
        original.map((integral) => (integral.x === 2 ? { ...integral, x: 4 } : integral)),
    )
    assert.deepEqual(beatToMeasure(moved, 4), { measure: 2, beat: 1 })
    const removed = calculateBpms(moved.filter((integral) => integral.x !== 4))
    assert.deepEqual(beatToMeasure(removed, 4), { measure: 2, beat: 1 })
    assert.deepEqual(beatToMeasure(original, 3), { measure: 2, beat: 2 })
})

test('measure grid includes off-grid BPM changes, respects the viewport and bounds dense work', () => {
    const changes = calculateBpms(
        [
            { beat: 0, bpm: 120 },
            { beat: 2.125, bpm: 90, meter: 3 },
        ].map(toBpmIntegral),
    )
    assert.deepEqual(getMeasureBeats(changes, 0, 10), [0, 2.125, 5.125, 8.125])
    assert.deepEqual(getMeasureBeats(changes, 3, 8), [5.125])
    assert.deepEqual(getMeasureBeats(changes, 2.125, 5.125), [2.125, 5.125])
    assert.deepEqual(getMeasureBeats(changes, 0, 10000), [])
    const distant = calculateBpms([toBpmIntegral({ beat: 0, bpm: 120 })])
    assert.deepEqual(getMeasureBeats(distant, 1000000, 1000004), [1000000, 1000004])
})
