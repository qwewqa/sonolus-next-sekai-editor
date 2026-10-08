import assert from 'node:assert/strict'
import test from 'node:test'
import { ImportRefusal } from '../../src/chart/refusal'
import { parseSus } from '../../src/sus/parse'

const header = [
    '#TITLE "Parser regression"',
    '#REQUEST "ticks_per_beat 480"',
    '#WAVEOFFSET 1.25',
    '#00002:4',
    '#BPM01:120',
    '#00008:01',
]

// SUS v2.7 sections 3 (channel y) and 4 permit case-insensitive channels and
// separate ticks_per_beat / enable_priority requests:
// https://gist.github.com/kb10uy/c171c175ba913dc40a73c6ce69da9859
test('unrelated SUS requests preserve tick resolution and other metadata', () => {
    const baseline = parseSus([...header, '#00112:11'])
    const actual = parseSus([
        '#REQUEST "enable_priority false"',
        ...header,
        '#REQUEST "enable_priority true"',
        '#00112:11',
    ])

    assert.deepEqual(actual, baseline)
    assert.equal(actual.offset, -1.25)
    assert.equal(actual.ticksPerBeat, 480)
    assert.equal(actual.tapNotes[0]?.tick, 1920)
})

test('the last tick-resolution request still takes effect', () => {
    const actual = parseSus([
        ...header,
        '#REQUEST "ticks_per_beat 960"',
        '#REQUEST "enable_priority true"',
        '#00112:11',
    ])

    assert.equal(actual.ticksPerBeat, 960)
    assert.equal(actual.tapNotes[0]?.tick, 3840)
})

test('SUS bar lengths preserve the meter and zero-based tick positions', () => {
    const actual = parseSus([...header, '#00202:3', '#00402:2.5', '#00412:11'])
    assert.deepEqual(actual.meterChanges, [
        { tick: 0, meter: 4 },
        { tick: 3840, meter: 3 },
        { tick: 6720, meter: 2.5 },
    ])
    assert.equal(actual.tapNotes[0]!.tick, 6720)
})

test('SUS rejects nonpositive and nonfinite meters', () => {
    for (const value of ['0', '-1', 'Infinity', 'NaN']) {
        assert.throws(
            () => parseSus([...header, `#00202:${value}`]),
            (error) => error instanceof ImportRefusal && error.reason === 'meter',
        )
    }
})

test('mixed-case SUS channels connect notes without merging stream types', () => {
    const actual = parseSus([
        ...header,
        '#00032a:11000000',
        '#00132A:00210000',
        '#00092A:11000000',
        '#00192a:00210000',
    ])

    assert.deepEqual(actual.slides, [
        {
            type: 3,
            notes: [
                { tick: 0, lane: 2, width: 1, type: 1 },
                { tick: 2400, lane: 2, width: 1, type: 2 },
            ],
        },
        {
            type: 9,
            notes: [
                { tick: 0, lane: 2, width: 1, type: 1 },
                { tick: 2400, lane: 2, width: 1, type: 2 },
            ],
        },
    ])
})
