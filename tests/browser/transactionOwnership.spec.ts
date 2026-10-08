import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('dense guide edits own crowded buckets while retaining source state and undo history', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { replaceNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            slides: Array.from({ length: 24 }, () => [
                { ...base, beat: 4, left: -4, connectorType: 'guide', noteType: 'anchor' },
                { ...base, beat: 6, isAttached: true, noteType: 'anchor' },
                { ...base, beat: 8, left: 4, connectorType: 'guide', noteType: 'anchor' },
            ]),
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()]
        const originalNotes = notes.map((array) => [...array])
        const originalBuckets = Object.entries(source.store.grid).flatMap(([type, map]) =>
            [...map].map(([key, bucket]) => ({ type, key, bucket, contents: [...bucket] })),
        )
        const tx = createTransaction(source, { autoAddGroup: false })
        const selection = [replaceNote(tx, notes[0]![0]!, { ...notes[0]![0]!, left: -3 })[0]!]
        const firstWrittenBucket = tx.store.grid.note.get(4)
        for (const array of notes.slice(1))
            selection.push(replaceNote(tx, array[0]!, { ...array[0]!, left: -3 })[0]!)
        const bucketReused = firstWrittenBucket === tx.store.grid.note.get(4)
        const committed = tx.commit(selection)
        const sourceUnchanged =
            originalBuckets.every(({ type, key, bucket, contents }) => {
                const map = source.store.grid[type as keyof typeof source.store.grid]
                return (
                    map.get(key) === bucket &&
                    [...bucket].length === contents.length &&
                    [...bucket].every((entity, index) => entity === contents[index])
                )
            }) &&
            [...source.store.slides.note.values()].every(
                (array, i) =>
                    array === notes[i] &&
                    array.every((entity, j) => entity === originalNotes[i]![j]),
            )
        const heads = (state: typeof source) =>
            [...state.store.slides.note.values()].map((array) => array[0]!.left)
        const attached = (state: typeof source) =>
            [...state.store.slides.note.values()].map((array) => array[1]!.left)
        const connectorsIndexed = [...committed.store.slides.connector.values()]
            .flat()
            .every((connector) => {
                for (
                    let key = Math.floor(connector.head.beat);
                    key <= Math.floor(connector.tail.beat);
                    key++
                )
                    if (!committed.store.grid.connector.get(key)?.has(connector)) return false
                return true
            })
        history.pushState(() => 'dense guide edit', committed)
        history.undoState()
        const undoHeads = heads(history.state.value)
        history.redoState()
        return {
            bucketReused,
            sourceUnchanged,
            connectorsIndexed,
            heads: heads(committed),
            attached: attached(committed),
            undoHeads,
            redoHeads: heads(history.state.value),
        }
    })
    expect(result.bucketReused).toBe(true)
    expect(result.sourceUnchanged).toBe(true)
    expect(result.connectorsIndexed).toBe(true)
    expect(result.heads).toEqual(Array(24).fill(-3))
    expect(result.attached).toEqual(Array(24).fill(0.5))
    expect(result.undoHeads).toEqual(Array(24).fill(-4))
    expect(result.redoHeads).toEqual(Array(24).fill(-3))
})

test('reused and forked transactions keep published maps, attached notes and BPMs immutable', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { replaceNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const { addBpm } = await appImport<typeof import('../../src/state/mutations/bpm')>(
            '/src/state/mutations/bpm.ts',
        )
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            slides: [
                [
                    { ...base, beat: 4, left: -4 },
                    { ...base, beat: 6, isAttached: true },
                    { ...base, beat: 8, left: 4 },
                ],
            ],
        })
        const source = history.state.value
        const [id, originalNotes] = [...source.store.slides.note][0]!
        const snapshot = (state: typeof source) =>
            JSON.stringify({
                grid: Object.entries(state.store.grid).map(([type, map]) => [
                    type,
                    [...map].map(([key, bucket]) => [key, [...bucket]]),
                ]),
                slides: Object.entries(state.store.slides).map(([type, map]) => [type, [...map]]),
                bpms: state.bpms,
                selected: state.selectedEntities,
            })
        const sourceBefore = snapshot(source)
        const tx = createTransaction(source, { autoAddGroup: false })
        const fork = createTransaction(source, { autoAddGroup: false })
        const selection = replaceNote(tx, originalNotes[0]!, { ...originalNotes[0]!, left: -2 })
        selection.push(originalNotes[1]!)
        const first = tx.commit(selection)
        const firstBefore = snapshot(first)
        addBpm(tx, { beat: 5, bpm: 60 })
        const second = tx.commit(first.selectedEntities)
        const secondBefore = snapshot(second)
        const head = second.store.slides.note.get(id)![0]!
        const third = tx.commit(replaceNote(tx, head, { ...head, left: -1 }))
        const forked = fork.commit(
            replaceNote(fork, originalNotes[0]!, { ...originalNotes[0]!, left: -5 }),
        )
        return {
            sourceUnchanged: snapshot(source) === sourceBefore,
            firstUnchanged: snapshot(first) === firstBefore,
            secondUnchanged: snapshot(second) === secondBefore,
            noteMapsDistinct:
                first.store.slides.note !== second.store.slides.note &&
                second.store.slides.note !== third.store.slides.note,
            gridMapsDistinct:
                first.store.grid.note !== second.store.grid.note &&
                second.store.grid.note !== third.store.grid.note,
            heads: [source, first, second, third, forked].map(
                (state) => state.store.slides.note.get(id)![0]!.left,
            ),
            attachments: [first, second, third].map(
                (state) => state.store.slides.note.get(id)![1]!.left,
            ),
            bpmCounts: [source, first, second, third, forked].map((state) => state.bpms.length),
        }
    })
    expect(result.attachments[0]).toBeCloseTo(1, 12)
    expect(result.attachments[1]).toBeCloseTo(4 / 7, 12)
    expect(result.attachments[2]).toBeCloseTo(8 / 7, 12)
    expect({ ...result, attachments: undefined }).toEqual({
        sourceUnchanged: true,
        firstUnchanged: true,
        secondUnchanged: true,
        noteMapsDistinct: true,
        gridMapsDistinct: true,
        heads: [-4, -2, -2, -1, -5],
        attachments: undefined,
        bpmCounts: [1, 1, 2, 2, 1],
    })
})

test('failed stale-note edits leave pending draft notes and grid contents unchanged', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { replaceNote, removeNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const source = history.state.value
        const note = [...source.store.slides.note.values()][0]![0]!
        const tx = createTransaction(source, { autoAddGroup: false })
        const replacement = replaceNote(tx, note, { ...note, left: note.left + 1 })[0]!
        const before = tx.store.grid.note.get(Math.floor(note.beat))!
        const contents = [...before]
        const errors: string[] = []
        for (const operation of [
            () => replaceNote(tx, note, { ...note, left: note.left + 2 }),
            () => removeNote(tx, note),
        ]) {
            try {
                operation()
            } catch (error) {
                errors.push(String(error))
            }
        }
        const after = tx.store.grid.note.get(Math.floor(note.beat))!
        const committed = tx.commit([replacement])
        return {
            errors: errors.length,
            unchangedBucket:
                before === after &&
                [...after].length === contents.length &&
                [...after].every((entity, i) => entity === contents[i]),
            sourceKept: source.store.grid.note.get(Math.floor(note.beat))!.has(note),
            replacementKept: committed.store.slides.note.get(note.slideId)![0] === replacement,
        }
    })
    expect(result).toEqual({
        errors: 2,
        unchangedBucket: true,
        sourceKept: true,
        replacementKept: true,
    })
})

test('same-beat BPM replacement retains bucket order through a second commit', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, history, show } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { replaceBpm } = await appImport<typeof import('../../src/state/mutations/bpm')>(
            '/src/state/mutations/bpm.ts',
        )
        show({
            ...fixtures.interaction,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 90 },
                { beat: 4, bpm: 180 },
            ],
            slides: [],
        })
        const source = history.state.value
        const [a, b] = [...source.store.grid.bpm.get(4)!]
        const tx = createTransaction(source, { autoAddGroup: false })
        const replacement = replaceBpm(tx, a!, { ...a!, bpm: 100 })[0]!
        const first = tx.commit([])
        replaceBpm(tx, b!, { ...b!, bpm: 200 })
        const second = tx.commit([])
        return {
            source: [...source.store.grid.bpm.get(4)!].map((entity) => entity.bpm),
            first: [...first.store.grid.bpm.get(4)!].map((entity) => entity.bpm),
            second: [...second.store.grid.bpm.get(4)!].map((entity) => entity.bpm),
            firstIdentityKept: [...second.store.grid.bpm.get(4)!][0] === replacement,
        }
    })
    expect(result).toEqual({
        source: [90, 180],
        first: [100, 180],
        second: [100, 200],
        firstIdentityKept: true,
    })
})

test('retained note Maps expose staged edits and preserve committed native snapshots', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { replaceNote, removeNote } = await appImport<
            typeof import('../../src/state/mutations/slides/note')
        >('/src/state/mutations/slides/note.ts')
        const source = history.state.value
        const arrays = [...source.store.slides.note.values()]
        const [a, b, c] = arrays.map((notes) => notes[0]!)
        const tx = createTransaction(source, { autoAddGroup: false })
        const retained = tx.store.slides.note
        const iterator = retained.values()
        replaceNote(tx, a!, { ...a!, left: -10 })
        const retainedRead = retained.get(a!.slideId)![0]!.left
        const initialSize = retained.size
        const firstIteratorRead = iterator.next().value![0]!.left
        const replacement = replaceNote(tx, b!, { ...b!, left: -20 })[0]!
        removeNote(tx, c!)
        const secondIteratorRead = iterator.next().value![0]!.left
        const sizeAfterRemoval = retained.size
        const visited: number[] = []
        let callbackMapKept = true
        retained.forEach((notes, id, callbackMap) => {
            callbackMapKept &&= callbackMap === retained
            visited.push(notes[0]!.left)
            if (id === a!.slideId) replaceNote(tx, replacement, { ...replacement, left: -30 })
        })
        const first = tx.commit([])
        const nativeNotes = Map.prototype.get.call(
            first.store.slides.note,
            a!.slideId,
        ) as (typeof arrays)[number]
        const firstWasNative = first.store.slides.note !== retained && nativeNotes[0]!.left === -10
        replaceNote(tx, nativeNotes[0]!, { ...nativeNotes[0]!, left: -40 })
        const retainedSnapshotRead = retained.get(a!.slideId)![0]!.left
        const second = tx.commit([])
        return {
            retainedRead,
            initialSize,
            firstIteratorRead,
            secondIteratorRead,
            sizeAfterRemoval,
            callbackMapKept,
            visited,
            firstWasNative,
            retainedSnapshotRead,
            firstSnapshotRead: first.store.slides.note.get(a!.slideId)![0]!.left,
            secondSnapshotRead: second.store.slides.note.get(a!.slideId)![0]!.left,
            sourceKept:
                source.store.slides.note.get(a!.slideId)![0] === a &&
                source.store.slides.note.has(c!.slideId),
        }
    })
    expect(result).toEqual({
        retainedRead: -10,
        initialSize: 4,
        firstIteratorRead: -10,
        secondIteratorRead: -20,
        sizeAfterRemoval: 3,
        callbackMapKept: true,
        visited: [-10, -30, -2],
        firstWasNative: true,
        retainedSnapshotRead: -10,
        firstSnapshotRead: -10,
        secondSnapshotRead: -40,
        sourceKept: true,
    })
})
