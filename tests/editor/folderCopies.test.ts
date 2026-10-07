import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    copyName,
    entriesInTreeOrder,
    insertCopiesInTree,
    type FolderId,
    type FolderTreeItem,
} from '../../src/chart/folders'

const template = '{0} ({1})'
const f = (id: number) => id as FolderId

test('copy names take the lowest free number and bump an existing one', () => {
    const taken = new Set(['Lead', 'Lead (2)', 'Lead (4)', 'Verse'])
    assert.equal(copyName('Lead', taken, template), 'Lead (3)')
    assert.equal(copyName('Lead (2)', taken, template), 'Lead (3)')
    assert.equal(copyName('Lead (4)', taken, template), 'Lead (3)')
    assert.equal(copyName('Verse', taken, template), 'Verse (2)')
    // Names that only look numbered keep their text.
    assert.equal(copyName('(2)', new Set(['(2)']), template), '(2) (2)')
    assert.equal(copyName('A (x)', new Set(), template), 'A (x) (2)')
    assert.equal(copyName('Lead (2) (2)', new Set(['Lead (2) (2)']), template), 'Lead (2) (3)')
})

test('numbered names continue the sequence as Add does', () => {
    const taken = new Set(['Default', '#1', '#7', '#x'])
    assert.equal(copyName('#1', taken, template), '#8')
    assert.equal(copyName('#7', new Set(['#7']), template), '#8')
})

test('copy names follow the template, wherever it puts the number', () => {
    assert.equal(copyName('Lead', new Set(), '{0}（{1}）'), 'Lead（2）')
    assert.equal(copyName('Lead（2）', new Set(['Lead（2）']), '{0}（{1}）'), 'Lead（3）')
    assert.equal(copyName('Lead', new Set(), 'Copy {1} of {0}'), 'Copy 2 of Lead')
    assert.equal(
        copyName('Copy 2 of Lead', new Set(['Copy 2 of Lead']), 'Copy {1} of {0}'),
        'Copy 3 of Lead',
    )
    // Regex characters in the template are literal.
    assert.equal(copyName('A.b', new Set(), '{0}.[{1}]'), 'A.b.[2]')
    assert.equal(copyName('A.b.[2]', new Set(['A.b.[2]']), '{0}.[{1}]'), 'A.b.[3]')
})

const tree: FolderTreeItem<number>[] = [
    { type: 'entry', id: 1 },
    { type: 'folder', id: f(10), members: [2, 3, 4] },
    { type: 'entry', id: 5 },
    { type: 'folder', id: f(11), members: [] },
]

test('copies sit right after their sources, in the same folder', () => {
    const next = insertCopiesInTree(
        tree,
        new Map([
            [1, 101],
            [4, 104],
            [2, 102],
            [5, 105],
        ]),
    )
    assert.deepEqual(next, [
        { type: 'entry', id: 1 },
        { type: 'entry', id: 101 },
        { type: 'folder', id: f(10), members: [2, 102, 3, 4, 104] },
        { type: 'entry', id: 5 },
        { type: 'entry', id: 105 },
        { type: 'folder', id: f(11), members: [] },
    ])
    // The source tree is untouched.
    assert.deepEqual(entriesInTreeOrder(tree), [1, 2, 3, 4, 5])
})

test('a folder copy follows its folder, holding its members’ copies in order', () => {
    const next = insertCopiesInTree(
        tree,
        new Map([
            [3, 103],
            [2, 102],
            [4, 104],
        ]),
        new Map([[f(10), f(12)]]),
    )
    assert.deepEqual(next, [
        { type: 'entry', id: 1 },
        { type: 'folder', id: f(10), members: [2, 3, 4] },
        { type: 'folder', id: f(12), members: [102, 103, 104] },
        { type: 'entry', id: 5 },
        { type: 'folder', id: f(11), members: [] },
    ])

    const empty = insertCopiesInTree(tree, new Map(), new Map([[f(11), f(13)]]))
    assert.deepEqual(empty.slice(-2), [
        { type: 'folder', id: f(11), members: [] },
        { type: 'folder', id: f(13), members: [] },
    ])

    // Several folders and loose entries in one step.
    const both = insertCopiesInTree(
        tree,
        new Map([
            [2, 102],
            [3, 103],
            [4, 104],
            [5, 105],
        ]),
        new Map([
            [f(10), f(12)],
            [f(11), f(13)],
        ]),
    )
    assert.deepEqual(both, [
        { type: 'entry', id: 1 },
        { type: 'folder', id: f(10), members: [2, 3, 4] },
        { type: 'folder', id: f(12), members: [102, 103, 104] },
        { type: 'entry', id: 5 },
        { type: 'entry', id: 105 },
        { type: 'folder', id: f(11), members: [] },
        { type: 'folder', id: f(13), members: [] },
    ])
})
