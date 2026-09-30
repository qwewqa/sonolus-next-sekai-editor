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
