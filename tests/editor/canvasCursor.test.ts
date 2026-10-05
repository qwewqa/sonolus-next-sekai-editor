import assert from 'node:assert/strict'
import test from 'node:test'
import { dragCursor, type CanvasCursor } from '../../src/editor/controls/cursor'
import { isNoteResizeStart, isRangeResizeStart, isSelectResize } from '../../src/editor/tools/edges'
import { getOnlyEntityType } from '../../src/editor/tools/entityType'
import type { Entity } from '../../src/state/entities'

test('note resize bands are half a lane wide at each interaction edge', () => {
    for (const [size, half] of [
        [0.5, 0.25],
        [1, 0.25],
        [1.5, 0.25],
        [3, 1],
    ] as const) {
        const note = { left: 2, size }
        const center = 2 + size / 2
        assert.equal(isNoteResizeStart(note, center), false, `size ${size} center`)
        assert.equal(isNoteResizeStart(note, center - half), true, `size ${size} left edge`)
        assert.equal(isNoteResizeStart(note, center + half), true, `size ${size} right edge`)
        assert.equal(isNoteResizeStart(note, center - half + 0.01), false)
        assert.equal(isNoteResizeStart(note, center + half - 0.01), false)
    }
})

test('range resize matches the camera and mask tools and select is its exact complement', () => {
    const left = 3
    const size = 6
    const toolMoves = (lane: number) => lane > left + 0.5 && lane < left + size - 0.5
    const selectResizes = (lane: number) => lane <= left + 0.5 || lane >= left + size - 0.5
    for (const lane of [0, 3, 3.5, 3.51, 6, 8.49, 8.5, 9, 12]) {
        assert.equal(isRangeResizeStart(left, size, lane), !toolMoves(lane), `lane ${lane}`)
        assert.equal(isRangeResizeStart(left, size, lane), selectResizes(lane), `lane ${lane}`)
    }
})

test('select resizes only when every moving object shares the focus type', () => {
    const note = { type: 'note', left: 0, size: 3 } as Entity
    const camera = { type: 'cameraEventJoint', cameraLeft: 0, cameraSize: 6 } as Entity
    const mask = { type: 'stageMaskEventJoint', maskLeft: 0, maskSize: 6 } as Entity
    const bpm = { type: 'bpm' } as Entity

    for (const [entities, focus, lane, expected] of [
        [[note], note, 0, true],
        [[note], note, 1.5, false],
        [[note, note], note, 3, true],
        [[note, bpm], note, 0, false],
        [[camera], camera, 0.5, true],
        [[camera], camera, 3, false],
        [[camera, note], camera, 0, false],
        [[mask], mask, 6, true],
        [[mask], mask, 3, false],
        [[bpm], bpm, 0, false],
    ] as const) {
        assert.equal(
            isSelectResize(getOnlyEntityType(entities), focus, lane),
            expected,
            `${entities.map((entity) => entity.type).join('+')} at ${lane}`,
        )
    }
})

test('drag cursors keep move for moves and show crosshair for box gestures', () => {
    const cases: [CanvasCursor, string][] = [
        ['move', 'move'],
        ['default', 'crosshair'],
        ['pointer', 'crosshair'],
        ['crosshair', 'crosshair'],
        ['ew-resize', 'ew-resize'],
        ['ns-resize', 'ns-resize'],
        ['copy', 'copy'],
    ]
    for (const [hover, drag] of cases) assert.equal(dragCursor(hover), drag)
})
