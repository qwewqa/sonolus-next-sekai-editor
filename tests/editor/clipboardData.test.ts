import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClipboardData } from '../../src/clipboard/data/parse'

test('copied data with a null guide alpha, as older editors copied, pastes it as 1', () => {
    const data = (value: number | null) => ({
        lane: 0,
        beat: 1,
        entities: [
            {
                archetype: 'AnchorNote',
                data: [
                    { name: 'segmentAlpha', value },
                    { name: 'size', value: 1 },
                ],
            },
        ],
    })
    assert.deepEqual(parseClipboardData(data(null)), data(1))
})

test('clipboard anchor identity is optional and does not rewrite authored entities', () => {
    const legacy = {
        lane: 1,
        beat: 2,
        entities: [{ archetype: 'NormalTapNote', data: [{ name: 'lane', value: 1 }] }],
    }
    assert.deepEqual(parseClipboardData(legacy), legacy)
    const anchored = { ...legacy, anchor: 0 }
    assert.deepEqual(parseClipboardData(anchored), anchored)
    assert.equal(anchored.entities[0]?.data[0]?.value, 1)
    for (const anchor of [-1, 0.5, '0'])
        assert.throws(() => parseClipboardData({ ...legacy, anchor }))
    // A future/stale index is ignored by the clipboard reader, retaining usable chart data.
    assert.equal(parseClipboardData({ ...legacy, anchor: 999 }).anchor, 999)
})
