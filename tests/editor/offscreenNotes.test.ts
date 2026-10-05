import assert from 'node:assert/strict'
import test from 'node:test'
import {
    combineSelection,
    groupOffscreenNotes,
    hitOffscreenGroup,
    offscreenBadgeHitWidth,
    type OffscreenNotePosition,
} from '../../src/editor/offscreenNotes'

const note = (left: number, right: number, y = 100): OffscreenNotePosition<string> => ({
    left,
    right,
    y,
    highlighted: false,
    opacity: 1,
})

test('only fully horizontal offscreen notes in the visible vertical range get indicators', () => {
    const groups = groupOffscreenNotes(
        [
            note(-10, -1),
            note(301, 310),
            note(-5, 5),
            note(295, 305),
            note(-5, 0),
            note(300, 300),
            note(-10, -1, -1),
            note(301, 310, 401),
            note(NaN, -1),
        ],
        300,
        0,
        400,
    )
    assert.deepEqual(
        groups.map(({ side, count }) => [side, count]),
        [
            ['left', 1],
            ['right', 1],
        ],
    )
})

test('nearby offscreen notes aggregate counts and selection without overlapping badges', () => {
    const groups = groupOffscreenNotes(
        [
            ...Array.from({ length: 500 }, () => note(-30, -10, 100)),
            { ...note(-5, -1, 101), highlighted: true, opacity: 0.25 },
            note(310, 320, 100),
            note(-5, -1, 160),
        ],
        300,
        80,
        400,
    )
    assert.equal(groups[0]?.count, 501)
    assert.equal(groups[0]?.highlighted, true)
    assert.equal(groups[0]?.opacity, 1)
    assert.equal(groups[1]?.count, 1)
    assert.ok(Math.abs(groups[0]!.y - groups[2]!.y) >= 28)
    assert.deepEqual(groupOffscreenNotes([note(-5, -1)], 0, 0, 400), [])
    assert.deepEqual(groupOffscreenNotes([note(-5, -1)], 300, 80, 90), [])
})

test('badges collect only their selectable notes', () => {
    const groups = groupOffscreenNotes(
        [
            { ...note(-10, -1, 100), target: 'a' },
            { ...note(-10, -1, 101), opacity: 0.25 },
            { ...note(-10, -1, 102), target: 'b' },
            { ...note(310, 320, 100), opacity: 0.25 },
        ],
        300,
        0,
        400,
    )
    assert.deepEqual(
        groups.map(({ side, count, targets }) => [side, count, targets]),
        [
            ['left', 3, ['a', 'b']],
            ['right', 1, []],
        ],
    )
})

test('badge hit areas cover their slot band out from the edge', () => {
    const groups = groupOffscreenNotes(
        [
            { ...note(-10, -1, 100), target: 'left' },
            { ...note(-10, -1, 160), target: 'lower' },
            ...Array.from({ length: 1000 }, () => ({ ...note(310, 320, 100), target: 'right' })),
            note(310, 320, 300),
        ],
        300,
        0,
        400,
    )
    const left = groups.find((group) => group.targets[0] === 'left')!
    const right = groups.find((group) => group.targets[0] === 'right')!
    assert.equal(hitOffscreenGroup(groups, 2, left.y, 300), left)
    assert.equal(
        hitOffscreenGroup(groups, offscreenBadgeHitWidth(1), left.y + left.spacing / 2 - 0.01, 300),
        left,
    )
    assert.equal(hitOffscreenGroup(groups, offscreenBadgeHitWidth(1) + 1, left.y, 300), undefined)
    assert.equal(hitOffscreenGroup(groups, -1, left.y, 300), undefined)
    assert.notEqual(hitOffscreenGroup(groups, 2, left.y + left.spacing / 2 + 1, 300), left)
    // Wider counts get a wider reach.
    assert.equal(offscreenBadgeHitWidth(1000), 68)
    assert.equal(hitOffscreenGroup(groups, 300 - 68, right.y, 300), right)
    assert.equal(hitOffscreenGroup(groups, 301, right.y, 300), undefined)
    // Badges without selectable notes are not hit.
    assert.equal(hitOffscreenGroup(groups, 298, 300, 300), undefined)
})

test('ctrl toggles badge notes into or out of the selection', () => {
    assert.deepEqual(combineSelection(['a', 'b'], ['c'], false), ['c'])
    assert.deepEqual(combineSelection(['a', 'b'], ['b', 'c'], true), ['a', 'b', 'c'])
    assert.deepEqual(combineSelection(['a', 'b', 'c'], ['b', 'c'], true), ['a'])
    assert.deepEqual(combineSelection(['a'], [], true), ['a'])
})
