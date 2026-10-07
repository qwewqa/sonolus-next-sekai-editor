import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

type Options = { command: 'copy' | 'cut'; selection: 'partial' | 'whole' }

/**
 * An Out Quad slide with ticks at beats 1 and 2: copies or cuts the head and
 * ticks (or the whole slide), pastes 8 beats later, then undoes.
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
    const original = notes()
    const slide = [...history.state.value.store.slides.note.values()][0]!
    history.replaceState({
        ...history.state.value,
        selectedEntities: selection === 'whole' ? [...slide] : slide.slice(0, 3),
    })

    ;(command === 'copy' ? copy : cut).execute()
    const afterCommand = notes()
    const data = clipboard.clipboardEntry.value!.data!
    await pasteAtPosition(data.lane, 8, { ctrl: false, shift: false })
    const pasted = notes()
        .filter((note) => note.beat >= 8)
        .map((note) => ({ ...note, beat: note.beat - 8 }))

    history.undoState()
    const afterPasteUndo = notes()
    if (command === 'cut') history.undoState()
    return { original, afterCommand, pasted, afterPasteUndo, restored: notes() }
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

const detached = (notes: Note[]) => notes.map((note) => ({ ...note, isAttached: false }))

test('copying a slide head and its ticks without the tail pastes the ticks where they were drawn', async ({
    page,
}) => {
    const result = await page.evaluate(exercise, { command: 'copy', selection: 'partial' } as const)
    // Out Quad from lane -4 to 4: the tick at beat 1 is drawn at left -0.5.
    expect(result.original[1]!.left).toBeCloseTo(-0.5, 6)
    expectNotes(result.afterCommand, result.original)
    expectNotes(result.pasted, detached(result.original.slice(0, 3)))
    expectNotes(result.afterPasteUndo, result.original)
})

test('cutting a slide head and its ticks without the tail pastes the ticks where they were drawn', async ({
    page,
}) => {
    const result = await page.evaluate(exercise, { command: 'cut', selection: 'partial' } as const)
    expectNotes(result.afterCommand, result.original.slice(3))
    expectNotes(result.pasted, detached(result.original.slice(0, 3)))
    expectNotes(result.afterPasteUndo, result.original.slice(3))
    expectNotes(result.restored, result.original)
})

test('copying a whole slide keeps its ticks attached', async ({ page }) => {
    const result = await page.evaluate(exercise, { command: 'copy', selection: 'whole' } as const)
    expect(result.original.map((note) => note.isAttached)).toEqual([false, true, true, false])
    expectNotes(result.pasted, result.original)
    expectNotes(result.afterPasteUndo, result.original)
})
