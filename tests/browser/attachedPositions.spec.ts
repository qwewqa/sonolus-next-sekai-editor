import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                bpms: [{ beat: 0, bpm: 60 }],
                slides: [
                    [
                        { ...base, beat: 0, left: -4, size: 2, isAttached: false },
                        { ...base, beat: 2, left: 0, size: 2, isAttached: true },
                        { ...base, beat: 4, left: 4, size: 2, isAttached: false },
                    ],
                ],
            },
            1,
        )
    })
})

const attachedCenter = () => {
    const note = [...window.editorTest.history.state.value.store.slides.note.values()]
        .flat()
        .find((entity) => entity.isAttached)!
    return note.left + note.size / 2
}

test('BPM edits move attached notes to their time fraction, and undo moves them back', async ({
    page,
}) => {
    expect(await page.evaluate(attachedCenter)).toBe(1)
    await page.evaluate(async () => {
        const { history } = window.editorTest
        const { createTransaction } = await import('/src/state/transaction.ts')
        const { addBpm } = await import('/src/state/mutations/bpm.ts')
        const transaction = createTransaction(history.state.value)
        addBpm(transaction, { beat: 1, bpm: 120 })
        history.pushState(() => 'add bpm', transaction.commit([]))
    })
    // 60 BPM, then 120 BPM from beat 1: beat 2 is 1.5 s into a 2.5 s slide.
    expect(await page.evaluate(attachedCenter)).toBeCloseTo(1.8, 12)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await page.evaluate(attachedCenter)).toBe(1)
})

test('edits without BPM changes keep attached note objects', async ({ page }) => {
    expect(
        await page.evaluate(async () => {
            const { history } = window.editorTest
            const { createTransaction } = await import('/src/state/transaction.ts')
            const find = () =>
                [...window.editorTest.history.state.value.store.slides.note.values()]
                    .flat()
                    .find((entity) => entity.isAttached)
            const before = find()
            history.pushState(() => 'noop', createTransaction(history.state.value).commit([]))
            return find() === before
        }),
    ).toBe(true)
})

test('BPM edits after a slide leave its attached notes alone', async ({ page }) => {
    expect(
        await page.evaluate(async () => {
            const { history } = window.editorTest
            const { createTransaction } = await import('/src/state/transaction.ts')
            const { addBpm } = await import('/src/state/mutations/bpm.ts')
            const find = () =>
                [...window.editorTest.history.state.value.store.slides.note.values()]
                    .flat()
                    .find((entity) => entity.isAttached)
            const before = find()
            const transaction = createTransaction(history.state.value)
            addBpm(transaction, { beat: 10, bpm: 120 })
            history.pushState(() => 'add bpm', transaction.commit([]))
            return find() === before
        }),
    ).toBe(true)
})

for (const command of ['copy', 'cut'] as const)
    test(`${command} keeps a slide with an attached note without selecting its BPM`, async ({
        page,
        context,
    }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        const result = await page.evaluate(async (command) => {
            const { history, appImport } = window.editorTest
            const notes = [...history.state.value.store.slides.note.values()].flat()
            history.replaceState({ ...history.state.value, selectedEntities: notes })
            const commands = await appImport<typeof import('../../src/editor/commands')>(
                '/src/editor/commands/index.ts',
            )
            const { clipboardEntry } =
                await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
            await commands.commands[command].execute()
            const slide = clipboardEntry.value?.data?.chart.slides[0] ?? []
            return {
                copied: slide.map((note) => [note.beat, note.isAttached]),
                left: [...history.state.value.store.slides.note.values()].flat().length,
            }
        }, command)
        expect(result).toEqual({
            copied: [
                [0, false],
                [2, true],
                [4, false],
            ],
            left: command === 'cut' ? 0 : 3,
        })
    })
