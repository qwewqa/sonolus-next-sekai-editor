import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    buildFolderTree,
    entriesInTreeOrder,
    flattenFolderTree,
    folderPathParts,
    insertFolderInTree,
    moveEntriesInTree,
    moveEntryInTree,
    moveFolderInTree,
    normalizeFolders,
    stepEntryInTree,
    stepFolderInTree,
    templateParts,
    ungroupInTree,
    type FolderId,
    type FolderObject,
    type FolderTreeItem,
} from '../../src/chart/folders'

type Entry = { name: string; folderId?: FolderId }

const A = 1 as FolderId
const B = 2 as FolderId

const entries = (...items: [string, FolderId?][]) =>
    new Map<string, Entry>(
        items.map(([name, folderId]) => [
            name,
            folderId === undefined ? { name } : { name, folderId },
        ]),
    )

const folders = (...items: [FolderId, string, number?][]) =>
    new Map<FolderId, FolderObject>(
        items.map(([id, name, index]) => [id, { name, index: index ?? 0 }]),
    )

/** A compact picture of a tree: `x` for entries, `[A: x y]` for folders. */
const show = (tree: readonly FolderTreeItem<string>[] | undefined) =>
    tree
        ?.map((item) =>
            item.type === 'entry' ? item.id : `[${String(item.id)}: ${item.members.join(' ')}]`,
        )
        .join(' ')

test('a folder sits at its first member and gathers the rest', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c'], ['d', A]), folders([A, 'F']))
    assert.equal(show(tree), 'a [1: b d] c')
})

test('empty folders sit at their index, in folder order on ties', () => {
    const tree = buildFolderTree(entries(['a'], ['b'], ['c']), folders([A, 'F', 1], [B, 'G', 1]))
    assert.equal(show(tree), 'a [1: ] [2: ] b c')
    assert.equal(show(buildFolderTree(entries(['a']), folders([A, 'F', Infinity]))), 'a [1: ]')
})

test('links to missing folders count as none', () => {
    const tree = buildFolderTree(entries(['a', B], ['b']), folders([A, 'F', 9]))
    assert.equal(show(tree), 'a b [1: ]')
})

test('flattening keeps members contiguous and records indices', () => {
    const source = entries(['a'], ['b', A], ['c'], ['d', A])
    const { entries: flat, folders: flatFolders } = normalizeFolders(source, folders([A, 'F']))
    assert.deepEqual([...flat.keys()], ['a', 'b', 'd', 'c'])
    assert.equal(flat.get('d')?.folderId, A)
    assert.equal(flat.get('c')?.folderId, undefined)
    assert.equal(flatFolders.get(A)?.index, 1)
    // Unchanged values keep their identity.
    assert.equal(flat.get('a'), source.get('a'))
})

test('moving an entry into, within and out of a folder', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c', A], ['d']), folders([A, 'F']))
    assert.equal(show(moveEntryInTree(tree, 'a', { folder: A })), '[1: b c a] d')
    assert.equal(show(moveEntryInTree(tree, 'a', { folder: A, before: 'c' })), '[1: b a c] d')
    assert.equal(show(moveEntryInTree(tree, 'c', {})), 'a [1: b] d c')
    assert.equal(
        show(moveEntryInTree(tree, 'c', { before: { type: 'folder', id: A } })),
        'a c [1: b] d',
    )
    assert.equal(moveEntryInTree(tree, 'b', { folder: A, before: 'c' }), undefined)
    assert.equal(moveEntryInTree(tree, 'a', { folder: B }), undefined)
})

test('moving a folder carries its members', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c', A], ['d']), folders([A, 'F']))
    assert.equal(show(moveFolderInTree(tree, A)), 'a d [1: b c]')
    assert.equal(show(moveFolderInTree(tree, A, { type: 'entry', id: 'a' })), '[1: b c] a d')
    assert.equal(moveFolderInTree(tree, A, { type: 'entry', id: 'd' }), undefined)
})

test('stepping crosses folder edges one step at a time', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c', A], ['d']), folders([A, 'F']))
    // A loose entry steps into an expanded folder at the near end.
    assert.equal(show(stepEntryInTree(tree, 'a', 1)), '[1: a b c] d')
    assert.equal(show(stepEntryInTree(tree, 'd', -1)), 'a [1: b c d]')
    // Members swap inside, and leave at either edge.
    assert.equal(show(stepEntryInTree(tree, 'b', 1)), 'a [1: c b] d')
    assert.equal(show(stepEntryInTree(tree, 'b', -1)), 'a b [1: c] d')
    assert.equal(show(stepEntryInTree(tree, 'c', 1)), 'a [1: b] c d')
    // Collapsed folders are stepped over whole.
    assert.equal(show(stepEntryInTree(tree, 'a', 1, () => false)), '[1: b c] a d')
    // The ends.
    assert.equal(stepEntryInTree(tree, 'a', -1), undefined)
    assert.equal(stepEntryInTree(tree, 'd', 1), undefined)
})

test('folders step past their top-level neighbors', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c']), folders([A, 'F']))
    assert.equal(show(stepFolderInTree(tree, A, -1)), '[1: b] a c')
    assert.equal(show(stepFolderInTree(tree, A, 1)), 'a c [1: b]')
    assert.equal(stepFolderInTree(stepFolderInTree(tree, A, 1)!, A, 1), undefined)
})

test('ungrouping leaves members in place; new folders insert empty', () => {
    const tree = buildFolderTree(entries(['a'], ['b', A], ['c', A], ['d']), folders([A, 'F']))
    assert.equal(show(ungroupInTree(tree, A)), 'a b c d')
    assert.equal(
        show(insertFolderInTree(tree, B, { type: 'entry', id: 'd' })),
        'a [1: b c] [2: ] d',
    )
    const flat = flattenFolderTree(
        insertFolderInTree(tree, B, { type: 'entry', id: 'd' }),
        entries(['a'], ['b', A], ['c', A], ['d']),
        folders([A, 'F'], [B, 'G']),
    )
    assert.equal(flat.folders.get(B)?.index, 3)
    assert.deepEqual([...flat.folders.keys()], [A, B])
})

test('a target name leads with its folder as parts, wrapped by its template', () => {
    const entries = new Map<number, Entry>([
        [1, { name: 'Lead', folderId: A }],
        [2, { name: 'Bridge' }],
    ])
    const folders = new Map<FolderId, FolderObject>([[A, { name: 'Verse', index: 0 }]])

    assert.deepEqual(
        templateParts('{0} Group', [folderPathParts(entries, folders, 1, '{0} › {1}')]),
        [
            { text: 'Verse', role: 'folder' },
            { text: ' › ' },
            { text: 'Lead', role: 'name' },
            { text: ' Group' },
        ],
    )
    // Loose entries show just their name; a leading template keeps its text first.
    assert.deepEqual(
        templateParts('groupe {0}', [folderPathParts(entries, folders, 2, '{0} › {1}')]),
        [{ text: 'groupe ' }, { text: 'Bridge', role: 'name' }],
    )
    assert.deepEqual(folderPathParts(entries, folders, 3, '{0} › {1}'), [])
})

test('several entries move into a folder in tree order, as one change', () => {
    const tree = buildFolderTree(
        entries(['a'], ['b', A], ['c'], ['d', B], ['e', B]),
        folders([A, 'F'], [B, 'G']),
    )
    assert.deepEqual(entriesInTreeOrder(tree), ['a', 'b', 'c', 'd', 'e'])
    assert.equal(show(moveEntriesInTree(tree, new Set(['e', 'a', 'd']), A)), '[1: b a d e] c [2: ]')
    assert.equal(show(moveEntriesInTree(tree, new Set(['b']), A)), undefined)
    assert.equal(show(moveEntriesInTree(tree, new Set(['a']), 9 as FolderId)), undefined)
})

test('several entries leave their folders to just below each', () => {
    const tree = buildFolderTree(
        entries(['a'], ['b', A], ['c', A], ['d'], ['e', B]),
        folders([A, 'F'], [B, 'G']),
    )
    assert.equal(
        show(moveEntriesInTree(tree, new Set(['a', 'b', 'e']), undefined)),
        'a [1: c] b d [2: ] e',
    )
    assert.equal(show(moveEntriesInTree(tree, new Set(['a', 'd']), undefined)), undefined)
})
