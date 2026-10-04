import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateToolbar } from '../../src/editor/toolbar/migrate'
import { constrainLaneObject } from '../../src/state/operations/laneLimits'

test('unlimited and already-contained objects preserve identity and unrelated properties', () => {
    const note = { left: 4, size: 2, beat: 3, elevation: 5 }
    assert.equal(constrainLaneObject(note, 0), note)
    assert.equal(constrainLaneObject(note, 6), note)
    assert.deepEqual(constrainLaneObject({ ...note, left: 9 }, 6), { ...note, left: 4 })
    assert.deepEqual(constrainLaneObject({ ...note, left: -9 }, 6), { ...note, left: -6 })
})

test('resize limits preserve the fixed edge and respect fractional minimum widths', () => {
    assert.deepEqual(constrainLaneObject({ left: 2, size: 8 }, 6, true, 0.125), {
        left: 2,
        size: 4,
    })
    assert.deepEqual(constrainLaneObject({ left: -9, size: 11 }, 6, true, 0.125), {
        left: -6,
        size: 8,
    })
    assert.deepEqual(constrainLaneObject({ left: 9, size: 2 }, 6, true, 0.125), {
        left: 5.875,
        size: 0.125,
    })
    assert.deepEqual(constrainLaneObject({ left: 9, size: 0 }, 6), { left: 6, size: 0 })
})

test('oversized spans fit the range while cameras retain a valid minimum width', () => {
    assert.deepEqual(constrainLaneObject({ left: -8, size: 16 }, 6), { left: -6, size: 12 })
    assert.deepEqual(constrainLaneObject({ maskLeft: 3, maskSize: 20 }, 6), {
        maskLeft: -6,
        maskSize: 12,
    })
    assert.deepEqual(constrainLaneObject({ cameraLeft: 8, cameraSize: 12 }, 2), {
        cameraLeft: -3,
        cameraSize: 6,
    })
    assert.deepEqual(constrainLaneObject({ cameraLeft: 8, cameraSize: 12 }, 6), {
        cameraLeft: -6,
        cameraSize: 12,
    })
})

test('point events use their horizontal editing coordinate without changing other axes', () => {
    assert.deepEqual(constrainLaneObject({ pivotLane: -8, yOffset: 4 }, 2.5), {
        pivotLane: -2.5,
        yOffset: 4,
    })
    assert.deepEqual(constrainLaneObject({ xTranslation: 8, elevation: 4 }, 2.5), {
        xTranslation: 2.5,
        elevation: 4,
    })
    assert.deepEqual(constrainLaneObject({ editorLane: 8, beat: 4 }, 2.5), {
        editorLane: 2.5,
        beat: 4,
    })
    const bpm = { beat: 4, bpm: 120, meter: 4 }
    assert.equal(constrainLaneObject(bpm, 6), bpm)
})

test('former default toolbar moves elevation to transforms and inserts lane limits after divisions', () => {
    const groups = [
        [
            'increaseNoteSize',
            'decreaseNoteSize',
            'brush',
            'eraser',
            'deselect',
            'elevation',
            'select',
        ],
        ['laneDivisionCustom', 'laneDivision1'],
        ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut'],
        ['scaleWidth', 'flip'],
    ]
    const migrated = migrateToolbar(groups)
    assert.equal(groups[0]?.includes('elevation'), true)
    assert.deepEqual(migrated[0], [
        'increaseNoteSize',
        'decreaseNoteSize',
        'brush',
        'eraser',
        'deselect',
        'select',
    ])
    assert.deepEqual(migrated[2], ['laneLimitCustom', 'laneLimitSix', 'laneLimitNone'])
    assert.deepEqual(migrated[4], ['elevation', 'scaleWidth', 'flip'])
    assert.equal(migrated[3]?.includes('elevation'), false)
    assert.equal(migrateToolbar(migrated), migrated)
    const custom = [['elevation', 'select']]
    assert.equal(migrateToolbar(custom), custom)
})

test('previous default view group moves elevation to transforms without duplicating lane controls', () => {
    const groups = [
        ['scaleWidth', 'scaleElevation', 'flip'],
        ['laneLimitCustom', 'laneLimitSix', 'laneLimitNone'],
        ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut', 'elevation'],
    ]
    const migrated = migrateToolbar(groups)
    assert.deepEqual(migrated[0], ['elevation', 'scaleWidth', 'scaleElevation', 'flip'])
    assert.deepEqual(migrated[2], ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut'])
    assert.equal(migrated.length, groups.length)
    assert.equal(migrateToolbar(migrated), migrated)
})
