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

const canvasColors = (page: Page) =>
    page.evaluate(async () => {
        // Observe the initial restored rendering without forcing a view/state change.
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-chart')!
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        // Count saturated blue notes and purple connectors on the actual editor surface.
        let blue = 0
        let purple = 0
        for (let i = 0; i < pixels.length; i += 4) {
            const [r, g, b, a] = pixels.subarray(i, i + 4)
            if (a! < 100) continue
            if (Math.abs(r! - 153) <= 2 && Math.abs(g! - 170) <= 2 && b! >= 253) blue++
            if (Math.abs(r! - 214) <= 2 && Math.abs(g! - 115) <= 2 && Math.abs(b! - 205) <= 2)
                purple++
        }
        return { blue, purple }
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

test('closing before the autosave delay preserves colored notes, connectors and chart metadata', async ({
    page,
    context,
}) => {
    const expected = await page.evaluate(async () => {
        const { history, fixtures, settings, view } = window.editorTest
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
        settings.autoSaveDelay = 5
        settings.autoSave = true
        const base = fixtures.interaction.slides[0]![0]!
        history.resetState(
            false,
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 2, left: 1 }],
                    [
                        { ...base, beat: 1 },
                        { ...base, beat: 3 },
                    ],
                ],
            },
            0.125,
            'colored-chart',
        )
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: notes })
        editSelectedEditableEntities({ noteStyle: 'blue', connectorStyle: 'purple' })
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        Object.assign(view, { time: 0, lane: 0, cursorTime: 0, hoverTime: 0 })
        settings.previewNoteSpeed = 11.25
        settings.previewControls = 'collapsed'
        settings.defaultNotePropertiesPresets = settings.defaultNotePropertiesPresets.map(
            (preset, i) =>
                i === 0 ? { ...preset, noteStyle: 'cyan', connectorStyle: 'black' } : preset,
        )
        const s = history.state.value
        return serializeToLevelData(
            s.initialLife,
            s.isDynamicStages,
            s.bgm.offset,
            s.store,
            s.groups,
            s.stages,
        )
    })
    const beforeClose = await canvasColors(page)
    expect(beforeClose.blue).toBeGreaterThan(100)
    expect(beforeClose.purple).toBeGreaterThan(100)
    page.on('dialog', (dialog) => void dialog.accept())
    await Promise.all([page.waitForEvent('close'), page.close({ runBeforeUnload: true })])
    const reopened = await context.newPage()
    await reopened.goto('/')
    await expect
        .poll(() =>
            reopened.evaluate(async () => {
                const { state } = await import('/src/history/index.ts')
                const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
                const s = state.value
                return {
                    filename: s.filename,
                    data: serializeToLevelData(
                        s.initialLife,
                        s.isDynamicStages,
                        s.bgm.offset,
                        s.store,
                        s.groups,
                        s.stages,
                    ),
                }
            }),
        )
        .toEqual({ filename: 'colored-chart', data: expected })
    expect(
        await reopened.evaluate(async () => {
            const { settings } = await import('/src/settings.ts')
            return {
                speed: settings.previewNoteSpeed,
                controls: settings.previewControls,
                preset: settings.defaultNotePropertiesPresets[0],
            }
        }),
    ).toMatchObject({
        speed: 11.25,
        controls: 'collapsed',
        preset: { noteStyle: 'cyan', connectorStyle: 'black' },
    })
    expect(await canvasColors(reopened)).toEqual(beforeClose)
    reopened.on('dialog', (dialog) => void dialog.accept())
    await reopened.reload()
    await expect.poll(() => recovery(reopened)).toMatchObject({ filename: 'colored-chart' })
    await expect.poll(() => canvasColors(reopened)).toEqual(beforeClose)
    await reopened.close()
})

test('a failed recovery write retains the last save, explains the failure and can retry', async ({
    page,
}) => {
    await editNamedChart(page)
    await expect.poll(() => recovery(page)).toBeDefined()
    const previous = await recovery(page)
    await page.evaluate(async () => {
        const setItem = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
            if (key.endsWith('.autoSave.levelData')) {
                Storage.prototype.setItem = setItem
                throw new DOMException('Storage is full', 'QuotaExceededError')
            }
            return setItem.call(this, key, value)
        }
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities({ noteStyle: 'blue' })
    })
    await expect(
        page.getByText('Auto save could not store your latest changes.', { exact: false }),
    ).toBeVisible()
    expect(await recovery(page)).toEqual(previous)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expect.poll(() => recovery(page)).not.toEqual(previous)
})

test('hiding the page flushes pending color edits without waiting for the timer', async ({
    page,
}) => {
    await editNamedChart(page)
    await expect.poll(() => recovery(page)).toBeDefined()
    await page.evaluate(async () => {
        const { settings } = window.editorTest
        settings.autoSaveDelay = 5
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities({ noteStyle: 'cyan', connectorStyle: 'black' })
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    const saved = await recovery(page)
    expect(
        saved?.levelData.entities.some((entity) =>
            entity.data.some(
                (field) => field.name === 'style' && 'value' in field && field.value === 7,
            ),
        ),
    ).toBe(true)
})

test('charts above the former entity limit still create recoverable colored data', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history, settings, fixtures } = window.editorTest
        const source = fixtures.interaction
        const base = source.slides[0]![0]!
        settings.autoSaveDelay = 0
        settings.autoSave = true
        history.resetState(
            true,
            {
                ...source,
                slides: Array.from({ length: 10001 }, (_, i) => [
                    { ...base, beat: i, noteStyle: 'blue' },
                ]),
            },
            0,
            'large-colored-chart',
        )
    })
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const { storageGet } = await import('/src/storage.ts')
                const { parseAutoSave } = await import('/src/history/autoSave/parse.ts')
                const data = storageGet('autoSave.levelData', undefined)
                if (!data) return 0
                return parseAutoSave(data).levelData.entities.filter((entity) =>
                    entity.data.some(
                        (field) => field.name === 'style' && 'value' in field && field.value === 4,
                    ),
                ).length
            }),
        )
        .toBe(10001)
})
