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
