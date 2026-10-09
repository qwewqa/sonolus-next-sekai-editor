import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateToolbar } from '../../src/editor/toolbar/migrate'

const transforms = [
    'elevation',
    'scaleWidth',
    'scaleElevation',
    'scaleBeat',
    'makeVertical',
    'combineNotes',
    'splitHold',
    'flipVertical',
    'flip',
]

test('existing default transform group gains layout toggle beside elevation', () => {
    const original = [['note'], transforms, ['select']]
    const migrated = migrateToolbar(original)
    assert.deepEqual(migrated, [['note'], ['editorLayout', ...transforms], ['select']])
    assert.equal(original[1], transforms)
    assert.equal(migrateToolbar(migrated), migrated)
})

test('custom toolbar groups and an explicitly placed layout toggle stay unchanged', () => {
    for (const original of [
        [['elevation', 'flip']],
        [['flip', 'elevation']],
        [transforms, ['editorLayout']],
        [transforms.slice(1)],
        [],
    ])
        assert.equal(migrateToolbar(original), original)
})

test('after the one-time migration a removed layout toggle stays removed', () => {
    const customized = [['note'], transforms, ['select']]
    assert.equal(migrateToolbar(customized, false), customized)
})

test('older elevation migration also adds layout toggle to its resulting default group', () => {
    const migrated = migrateToolbar([
        transforms.slice(1),
        ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut', 'elevation'],
    ])
    assert.deepEqual(migrated[0], ['editorLayout', ...transforms])
    assert.equal(migrateToolbar(migrated), migrated)
})
