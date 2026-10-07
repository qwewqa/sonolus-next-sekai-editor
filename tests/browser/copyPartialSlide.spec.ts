import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

type Options = { command: 'copy' | 'cut'; selection: 'head' | 'tail' | 'whole' }

/**
 * An Out Quad slide with ticks at beats 1 and 2: copies or cuts the head and
 * ticks, the ticks and tail, or the whole slide, pastes 8 beats later, then undoes.
 */
const exercise = async ({ command, selection }: Options) => {
    const { show, fixtures, history, appImport } = window.editorTest
    const clipboard =
        await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
    const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
        '/src/editor/tools/paste/index.ts',
    )
    const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
        '/src/editor/commands/copy/index.ts',
    )
    const { cut } = await appImport<typeof import('../../src/editor/commands/cut')>(
        '/src/editor/commands/cut/index.ts',
    )
    Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => undefined,
    })

    const base = fixtures.interaction.slides[0]![0]!
    show({
        ...fixtures.interaction,
        slides: [
            [
                { ...base, beat: 0, left: -4, size: 2, connectorEase: 'outQuad' },
                { ...base, beat: 1, isAttached: true },
                { ...base, beat: 2, isAttached: true },
                { ...base, beat: 4, left: 4, size: 2 },
            ],
        ],
    })
    const notes = () =>
        [...history.state.value.store.slides.note.values()]
            .flat()
            .sort((a, b) => a.beat - b.beat)
            .map(({ beat, left, size, isAttached }) => ({ beat, left, size, isAttached }))
    const entities = () => [...history.state.value.store.slides.note.values()].flat()
    const original = notes()
    const originalEntities = entities()
    const slide = [...history.state.value.store.slides.note.values()][0]!
    history.replaceState({
        ...history.state.value,
        selectedEntities:
            selection === 'whole'
                ? [...slide]
                : selection === 'head'
                  ? slide.slice(0, 3)
                  : slide.slice(1),
    })

    ;(command === 'copy' ? copy : cut).execute()
    const afterCommand = notes()
    const afterCommandEntities = entities()
    const data = clipboard.clipboardEntry.value!.data!
    await pasteAtPosition(data.lane, 8, { ctrl: false, shift: false })
    const pasted = notes()
        .filter((note) => note.beat >= 8)
        .map((note) => ({ ...note, beat: note.beat - 8 }))

    history.undoState()
    const afterPasteUndo = notes()
    const pasteUndoExact = entities().every((note, i) => note === afterCommandEntities[i])
    if (command === 'cut') history.undoState()
    const restoredEntities = entities()
    return {
        original,
        afterCommand,
        pasted,
        afterPasteUndo,
        pasteUndoExact,
        restored: notes(),
        restoredExact:
            restoredEntities.length === originalEntities.length &&
            restoredEntities.every((note, i) => note === originalEntities[i]),
    }
}

type Note = { beat: number; left: number; size: number; isAttached: boolean }

const expectNotes = (actual: Note[], expected: Note[]) => {
    expect(actual.map((note) => note.beat)).toEqual(expected.map((note) => note.beat))
    for (const [i, note] of expected.entries()) {
        expect(actual[i]!.left).toBeCloseTo(note.left, 6)
        expect(actual[i]!.size).toBeCloseTo(note.size, 6)
    }
    expect(actual.map((note) => note.isAttached)).toEqual(expected.map((note) => note.isAttached))
}

// Out Quad from lane -4 to 4: the ticks at beats 1 and 2 are drawn at left -0.5 and 2.
const original = [
    { beat: 0, left: -4, size: 2, isAttached: false },
    { beat: 1, left: -0.5, size: 2, isAttached: true },
    { beat: 2, left: 2, size: 2, isAttached: true },
    { beat: 4, left: 4, size: 2, isAttached: false },
]

// The beat 2 tick ends the copy where it was drawn; the beat 1 tick stays attached between it and the head.
const headCopy = [
    { beat: 0, left: -4, size: 2, isAttached: false },
    { beat: 1, left: 0.5, size: 2, isAttached: true },
    { beat: 2, left: 2, size: 2, isAttached: false },
]

for (const command of ['copy', 'cut'] as const) {
    test(`${command === 'copy' ? 'copying' : 'cutting'} a slide head and its ticks without the tail keeps the ticks attached`, async ({
        page,
    }) => {
        const result = await page.evaluate(exercise, { command, selection: 'head' } as const)
        expectNotes(result.original, original)
        expectNotes(result.afterCommand, command === 'copy' ? original : original.slice(3))
        expectNotes(result.pasted, headCopy)
        expect(result.pasteUndoExact).toBe(true)
        expect(result.restoredExact).toBe(true)
    })
}

test('copying ticks and the tail without the head keeps the inner tick attached', async ({
    page,
}) => {
    const result = await page.evaluate(exercise, { command: 'copy', selection: 'tail' } as const)
    // The beat 1 tick starts the copy where it was drawn, now with its own linear ease.
    expectNotes(result.pasted, [
        { beat: 1, left: -0.5, size: 2, isAttached: false },
        { beat: 2, left: 1, size: 2, isAttached: true },
        { beat: 4, left: 4, size: 2, isAttached: false },
    ])
    expect(result.pasteUndoExact).toBe(true)
    expect(result.restoredExact).toBe(true)
})

test('copying a whole slide keeps its ticks attached', async ({ page }) => {
    const result = await page.evaluate(exercise, { command: 'copy', selection: 'whole' } as const)
    expectNotes(result.pasted, original)
    expect(result.pasteUndoExact).toBe(true)
    expect(result.restoredExact).toBe(true)
})
