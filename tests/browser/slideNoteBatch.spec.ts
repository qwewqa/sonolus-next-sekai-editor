import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('mixed note edits remain visible before commit and preserve equal-beat order', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { addNote, replaceNote, removeNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            slides: [[4, 4, 8].map((beat, left) => ({ ...base, beat, left }))],
        })
        const source = history.state.value
        const [id, original] = [...source.store.slides.note][0]!
        const before = [...original]
        const sourceSnapshot = JSON.stringify(original)
        const tx = createTransaction(source, { autoAddGroup: false })
        const replacement = replaceNote(tx, original[0]!, { ...original[0]!, left: -1 })[0]!
        const firstRead = tx.store.slides.note.get(id)!
        const firstReadCorrect = firstRead[0] === replacement && firstRead[1] === original[1]
        const final = replaceNote(tx, replacement, { ...replacement, left: -2 })[0]!
        const added = addNote(tx, id, { ...base, beat: 4, left: 3 })[0]!
        const replacedAdded = replaceNote(tx, added, { ...added, left: 4 })[0]!
        removeNote(tx, replacedAdded)
        removeNote(tx, original[2]!)
        const survivor = addNote(tx, id, { ...base, beat: 4, left: 5 })[0]!
        const expected = [final, original[1]!, survivor]
        const finalRead = tx.store.slides.note.get(id)!
        const committed = tx.commit([final, survivor])
        const notes = committed.store.slides.note.get(id)!
        const indexed = [...committed.store.grid.note.values()].flatMap((bucket) => [...bucket])
        return {
            firstReadCorrect,
            firstReadUnchanged: firstRead[0] === replacement && firstRead.length === 3,
            finalReadCorrect:
                finalRead.length === expected.length &&
                finalRead.every((note, index) => note === expected[index]),
            order: notes.map((note) => [note.beat, note.left]),
            identities: notes.every((note, index) => note === expected[index]),
            selected:
                committed.selectedEntities[0] === final &&
                committed.selectedEntities[1] === survivor,
            gridCorrect:
                indexed.length === notes.length && notes.every((note) => indexed.includes(note)),
            sourceUnchanged:
                source.store.slides.note.get(id) === original &&
                original.every((note, index) => note === before[index]) &&
                JSON.stringify(original) === sourceSnapshot,
        }
    })
    expect(result).toEqual({
        firstReadCorrect: true,
        firstReadUnchanged: true,
        finalReadCorrect: true,
        order: [
            [4, -2],
            [4, 1],
            [4, 5],
        ],
        identities: true,
        selected: true,
        gridCorrect: true,
        sourceUnchanged: true,
    })
})

test('large replacement and forward deletion batches retain source state and live selections', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { addNote, replaceNote, removeNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            slides: [
                Array.from({ length: 3000 }, (_, index) => ({
                    ...base,
                    beat: Math.floor(index / 2) / 4,
                    elevation: index,
                    noteType: 'anchor',
                    connectorType: 'guide',
                })),
            ],
        })
        const source = history.state.value
        const [id, original] = [...source.store.slides.note][0]!
        const before = [...original]
        const sourceSnapshot = JSON.stringify(original)
        const buckets = Object.entries(source.store.grid).flatMap(([type, map]) =>
            [...map].map(([key, bucket]) => ({ type, key, bucket, contents: [...bucket] })),
        )
        const tx = createTransaction(source, { autoAddGroup: false })
        const replacements = original.map(
            (note) => replaceNote(tx, note, { ...note, left: note.left + 0.5 })[0]!,
        )
        const removed = replacements.filter((_, index) => index % 2 === 0)
        for (const note of removed) removeNote(tx, note)
        const added = removed.map((note) => addNote(tx, id, { ...note, left: note.left + 0.5 })[0]!)
        // The surviving second endpoint precedes the re-added first endpoint at each tie.
        const expected = [...replacements.filter((_, index) => index % 2 === 1), ...added].sort(
            (a, b) => a.beat - b.beat,
        )
        const committed = tx.commit(expected)
        const notes = committed.store.slides.note.get(id)!
        const noteSet = new Set(notes)
        const indexed = [...committed.store.grid.note.values()].flatMap((bucket) => [...bucket])
        return {
            count: notes.length,
            order: notes.every((note, index) => note === expected[index]),
            selected:
                committed.selectedEntities.length === notes.length &&
                committed.selectedEntities.every((note, index) => note === notes[index]),
            gridCorrect:
                indexed.length === notes.length &&
                indexed.every((note) => noteSet.has(note)) &&
                notes.every((note) =>
                    committed.store.grid.note.get(Math.floor(note.beat))?.has(note),
                ),
            removedAbsent: removed.every(
                (note) =>
                    !noteSet.has(note) &&
                    !committed.store.grid.note.get(Math.floor(note.beat))?.has(note),
            ),
            sourceUnchanged:
                source.store.slides.note.get(id) === original &&
                original.every((note, index) => note === before[index]) &&
                JSON.stringify(original) === sourceSnapshot &&
                buckets.every(({ type, key, bucket, contents }) => {
                    const map = source.store.grid[type as keyof typeof source.store.grid]
                    return (
                        map.get(key) === bucket &&
                        bucket.size === contents.length &&
                        [...bucket].every((entity, index) => entity === contents[index])
                    )
                }),
        }
    })
    expect(result).toEqual({
        count: 3000,
        order: true,
        selected: true,
        gridCorrect: true,
        removedAbsent: true,
        sourceUnchanged: true,
    })
})

test('recreated slides keep map order and canonical attached identities remain editable', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { addNote, replaceNote, removeNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            slides: [
                [
                    { ...base, beat: 4, left: -4 },
                    { ...base, beat: 6, isAttached: true },
                    { ...base, beat: 8, left: 4 },
                ],
                [{ ...base, beat: 12 }],
            ],
        })
        const source = history.state.value
        const entries = [...source.store.slides.note]
        const [id, original] = entries[0]!
        const [otherId, unrelated] = entries[1]!
        const before = [...original]
        const sourceSnapshot = JSON.stringify(original)
        const tx = createTransaction(source, { autoAddGroup: false })
        for (const note of original) removeNote(tx, note)
        const deleted = !tx.store.slides.note.has(id)
        addNote(tx, id, { ...original[0]!, left: -2 })
        const staged = addNote(tx, id, { ...original[1]!, left: -4 })[0]!
        addNote(tx, id, original[2]!)
        const first = tx.commit([staged])
        const published = first.store.slides.note.get(id)!
        const canonical = published[1]!
        const firstSnapshot = JSON.stringify(published)
        const edited = replaceNote(tx, canonical, { ...canonical, isCritical: true })[0]!
        const second = tx.commit([edited])
        const updated = second.store.slides.note.get(id)!
        return {
            deleted,
            mapOrder: [...first.store.slides.note.keys()].every(
                (key, index) => key === [otherId, id][index],
            ),
            canonicalized:
                canonical !== staged &&
                canonical.left === 1 &&
                first.selectedEntities[0] === canonical,
            editable:
                updated[1] === edited &&
                edited.isCritical &&
                second.selectedEntities[0] === edited &&
                second.store.grid.note.get(6)?.has(edited),
            publishedUnchanged:
                first.store.slides.note.get(id) === published &&
                JSON.stringify(published) === firstSnapshot &&
                first.selectedEntities[0] === canonical,
            sourceUnchanged:
                source.store.slides.note.get(id) === original &&
                original.every((note, index) => note === before[index]) &&
                JSON.stringify(original) === sourceSnapshot,
            unrelatedShared:
                first.store.slides.note.get(otherId) === unrelated &&
                second.store.slides.note.get(otherId) === unrelated,
        }
    })
    expect(result).toEqual({
        deleted: true,
        mapOrder: true,
        canonicalized: true,
        editable: true,
        publishedUnchanged: true,
        sourceUnchanged: true,
        unrelatedShared: true,
    })
})
