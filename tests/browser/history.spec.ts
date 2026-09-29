import { expect, test, type Page } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        performance.setResourceTimingBufferSize(5000)
        const prefix = 'sonolus-next-sekai-editor.'
        localStorage.setItem(`${prefix}showPreview`, 'false')
        localStorage.setItem(`${prefix}showSidebar`, 'false')
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        // Set this once so reloading preserves the app's normal persisted preference.
        window.editorTest.settings.autoSave = false
    })
})

const recovery = (page: Page) =>
    page.evaluate(async () => {
        const { storageGet } = await import('/src/storage.ts')
        const { parseAutoSave } = await import('/src/history/autoSave/parse.ts')
        const data = storageGet('autoSave.levelData', undefined)
        return data ? parseAutoSave(data) : undefined
    })

const editNamedChart = (page: Page) =>
    page.evaluate(async () => {
        const { history, fixtures, store, settings } = window.editorTest
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        history.resetState(false, fixtures.interaction, 0, 'named-chart')
        settings.autoSaveDelay = 0
        settings.autoSave = true
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        editSelectedEditableEntities({ size: 3 })
    })

test('chart filename survives speculative edits, committed edits, undo and redo', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { history, fixtures, store } = window.editorTest
        const { createEditedEntitiesState } = await import('/src/state/operations/edit.ts')
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        const { filename } = await import('/src/history/filename.ts')
        history.resetState(false, fixtures.interaction, 0, 'named-chart')
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        const source = history.state.value
        const speculative = createEditedEntitiesState(source, [note], { size: 3 })
        const snapshot = () => ({
            filename: filename.value,
            size: [...store.getAllEntities()]
                .filter((entity) => entity.type === 'note')
                .find((entity) => entity.beat === 3)!.size,
        })
        editSelectedEditableEntities({ size: 3 })
        const committed = snapshot()
        history.undoState()
        const undone = snapshot()
        const sourceRestored = history.state.value === source
        history.redoState()
        return {
            speculativeFilename: speculative.filename,
            sourceFilename: source.filename,
            sourceRestored,
            committed,
            undone,
            redone: snapshot(),
        }
    })
    expect(result).toEqual({
        speculativeFilename: 'named-chart',
        sourceFilename: 'named-chart',
        sourceRestored: true,
        committed: { filename: 'named-chart', size: 3 },
        undone: { filename: 'named-chart', size: 2 },
        redone: { filename: 'named-chart', size: 3 },
    })
})

test('undo to clean clears recovery, redo recreates it, and a clean reset clears it', async ({
    page,
}) => {
    await editNamedChart(page)
    await expect.poll(() => recovery(page)).toMatchObject({ filename: 'named-chart' })

    await page.evaluate(() => window.editorTest.history.undoState())
    await expect.poll(() => recovery(page)).toBeUndefined()
    await page.evaluate(() => window.editorTest.history.redoState())
    await expect.poll(() => recovery(page)).toMatchObject({ filename: 'named-chart' })

    await page.evaluate(() => {
        const { history, fixtures } = window.editorTest
        history.resetState(false, fixtures.notes, 0, 'replacement-chart')
    })
    await expect.poll(() => recovery(page)).toBeUndefined()
})

test('restored autosave retains its filename and warns before close until reset clean', async ({
    page,
}) => {
    await editNamedChart(page)
    await expect.poll(() => recovery(page)).toMatchObject({ filename: 'named-chart' })
    page.on('dialog', (dialog) => void dialog.accept())
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    expect(
        await page.evaluate(async () => {
            const { settings } = await import('/src/settings.ts')
            return settings.autoSave
        }),
    ).toBe(true)
    const snapshot = () =>
        page.evaluate(async () => {
            const { state, isDirty, canUndo } = await import('/src/history/index.ts')
            const { getAllEntities } = await import('/src/history/store.ts')
            const event = new Event('beforeunload', { cancelable: true })
            window.dispatchEvent(event)
            return {
                filename: state.value.filename,
                size: [...getAllEntities()]
                    .filter((entity) => entity.type === 'note')
                    .find((entity) => entity.beat === 3)?.size,
                dirty: isDirty.value,
                canUndo: canUndo.value,
                protected: event.defaultPrevented,
            }
        })
    await expect.poll(snapshot).toEqual({
        filename: 'named-chart',
        size: 3,
        dirty: true,
        canUndo: false,
        protected: true,
    })
    await page.evaluate(async () => {
        const { resetState } = await import('/src/history/index.ts')
        resetState(false)
    })
    expect(await snapshot()).toEqual({
        filename: undefined,
        size: undefined,
        dirty: false,
        canUndo: false,
        protected: false,
    })
    await expect.poll(() => recovery(page)).toBeUndefined()
})
