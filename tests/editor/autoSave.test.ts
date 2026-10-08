import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { parseAutoSave } from '../../src/history/autoSave/parse'
import { serializeAutoSave } from '../../src/history/autoSave/serialize'

test('large compressed recovery data round trips without exceeding the argument limit', () => {
    const levelData = {
        bgmOffset: 0.125,
        entities: Array.from({ length: 2000 }, () => ({
            name: randomBytes(100).toString('hex'),
            archetype: 'NormalNote',
            data: [{ name: 'style', value: 3 }],
        })),
    }
    const saved = serializeAutoSave(levelData, 'large-chart')
    assert.ok(atob(saved.levelData).length > 128 * 1024)
    assert.deepEqual(parseAutoSave(saved), { filename: 'large-chart', levelData })
})

test('a recovery with a null guide alpha, as older editors saved, restores it as 1', () => {
    const levelData = (value: number | null) => ({
        bgmOffset: 0,
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
    const saved = serializeAutoSave(levelData(null) as never, 'guide')
    assert.deepEqual(parseAutoSave(saved), { filename: 'guide', levelData: levelData(1) })
    // The unversioned format is the level data itself.
    assert.deepEqual(parseAutoSave(levelData(null)), { levelData: levelData(1) })
})
