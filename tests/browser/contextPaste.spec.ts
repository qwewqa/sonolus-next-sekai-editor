import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const exercisePaste = async (mode: 'fallback' | 'system' | 'empty' | 'changed' | 'viewport') => {
    const moduleUrls = new Map(
        performance
            .getEntriesByType('resource')
            .map((entry) => [new URL(entry.name).pathname, entry.name]),
    )
    const appImport = <T>(pathname: string): Promise<T> =>
        import(moduleUrls.get(pathname) ?? pathname)
    const { pasteAtContextPosition } = await appImport<
        typeof import('../../src/editor/contextMenuPaste')
    >('/src/editor/contextMenuPaste.ts')
    const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
        '/src/editor/commands/copy/index.ts',
    )
    const clipboard =
        await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
    const { toolName } = await appImport<typeof import('../../src/editor/tools')>(
        '/src/editor/tools/index.ts',
    )
    const { history, fixtures, show, point, view, settings } = window.editorTest
    show(fixtures.interaction, 3)
    const originalNotes = [...history.state.value.store.slides.note.values()].flat()
    history.replaceState({ ...history.state.value, selectedEntities: originalNotes.slice(0, 2) })
    Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => undefined,
    })
    copy.execute()
    const copiedText = clipboard.clipboardEntry.value?.text ?? ''
    if (mode !== 'fallback') clipboard.clipboardEntries.value.splice(0)
    Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: async () => {
            if (mode === 'system') return copiedText
            if (mode === 'viewport') {
                await new Promise((resolve) => setTimeout(resolve, 20))
                view.time = 12
                view.lane = 5
                view.division = 1
                settings.width = 12
                settings.pps = 240
                return copiedText
            }
            if (mode === 'changed') {
                show(fixtures.interaction, 3)
                return copiedText
            }
            throw new DOMException('Clipboard denied', 'NotAllowedError')
        },
    })
    toolName.value = 'note'
    const target = point(2, 8.13)
    const pasted = await pasteAtContextPosition(target.x, target.y, { ctrl: false, shift: false })
    const snapshot = window.editorTest.snapshot()
    const undoAvailable = history.canUndo.value
    history.undoState()
    return {
        pasted,
        tool: toolName.value,
        snapshot,
        undoAvailable,
        afterUndo: window.editorTest.snapshot(),
        canUndoAgain: history.canUndo.value,
    }
}

for (const mode of ['fallback', 'system', 'viewport'] as const) {
    test(`context paste uses ${mode} clipboard, preserves offsets and tool, and undoes once`, async ({
        page,
    }) => {
        const result = await page.evaluate(exercisePaste, mode)
        expect(result.pasted).toBe(true)
        expect(result.tool).toBe('note')
        expect(result.snapshot.notes).toHaveLength(6)
        expect(result.snapshot.selected).toEqual([
            { type: 'note', beat: 8.25, left: 1, size: 2 },
            { type: 'note', beat: 10.25, left: 5, size: 2 },
        ])
        expect(result.snapshot.creating).toEqual([])
        expect(result.undoAvailable).toBe(true)
        expect(result.afterUndo.notes).toHaveLength(4)
        expect(result.canUndoAgain).toBe(false)
    })
}

test('unavailable clipboard leaves the chart, tool, and history unchanged', async ({ page }) => {
    const result = await page.evaluate(exercisePaste, 'empty' as const)
    expect(result.pasted).toBe(false)
    expect(result.tool).toBe('note')
    expect(result.snapshot.notes).toHaveLength(4)
    expect(result.snapshot.selected).toHaveLength(2)
    expect(result.undoAvailable).toBe(false)
})

test('context paste does not apply to a chart replaced while reading the clipboard', async ({
    page,
}) => {
    const result = await page.evaluate(exercisePaste, 'changed' as const)
    expect(result.pasted).toBe(false)
    expect(result.snapshot.notes).toHaveLength(4)
    expect(result.snapshot.selected).toHaveLength(0)
    expect(result.undoAvailable).toBe(false)
})

test('menu Paste uses the right-click position and leaves the current tool active', async ({
    page,
}) => {
    const target = await page.evaluate(async () => {
        const moduleUrls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(moduleUrls.get(pathname) ?? pathname)
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { toolName } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        const { history, fixtures, show, settings, point } = window.editorTest
        show(fixtures.interaction, 3)
        const note = [...history.state.value.store.slides.note.values()].flat()[0]
        if (!note) throw new Error('Missing fixture note')
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => {
                throw new DOMException('Clipboard denied', 'NotAllowedError')
            },
        })
        copy.execute()
        toolName.value = 'note'
        settings.mouseSecondaryTool = 'selectContextMenu'
        return point(2, 8.13)
    })
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual([])
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect
        .poll(() => page.evaluate(() => window.editorTest.snapshot().selected))
        .toEqual([{ type: 'note', beat: 8.25, left: 1, size: 2 }])
    expect(await page.evaluate(() => window.editorTest.snapshot().notes.length)).toBe(5)
    expect(
        await page.evaluate(async () => {
            const entry = performance
                .getEntriesByType('resource')
                .find((entry) => new URL(entry.name).pathname === '/src/editor/tools/index.ts')
            const { toolName } = (await import(
                entry?.name ?? '/src/editor/tools/index.ts'
            )) as typeof import('../../src/editor/tools')
            return toolName.value
        }),
    ).toBe('note')
})
