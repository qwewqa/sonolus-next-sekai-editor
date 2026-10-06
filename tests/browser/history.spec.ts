import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { parseAutoSave } from '../../src/history/autoSave/parse'
import { installEditorFixture } from './editorFixture'
import legacyColors from './fixtures/legacy-colors.json' with { type: 'json' }

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

// Fixture generated with the unmodified serializers from de281ff, before the
// two color fields were unified. It includes every guide color, normal/fake
// active and damage connectors, camera motion, masks, elevation and time scales.
for (const format of ['compressed', 'unversioned'] as const) {
    test(`upgrading a ${format} recovery preserves the old chart and its colors`, async ({
        page,
    }) => {
        const { levelData } = parseAutoSave(legacyColors.autoSave)
        // Upgrades write default meters (5aef4e8); legacy NONE stays NONE.
        const upgraded = structuredClone(levelData)
        for (const entity of upgraded.entities) {
            if (entity.archetype === '#BPM_CHANGE' && !entity.data.some((d) => d.name === 'meter'))
                entity.data.push({ name: 'meter', value: 4 })
        }
        expect(upgraded).not.toEqual(levelData)
        expect(
            levelData.entities.some((entity) =>
                entity.data.some(
                    (d) => d.name === '#TIMESCALE_EASE' && 'value' in d && d.value === 0,
                ),
            ),
        ).toBe(true)
        await page.evaluate(
            (save) => {
                localStorage.setItem(
                    'sonolus-next-sekai-editor.autoSave.levelData',
                    JSON.stringify(save),
                )
            },
            format === 'compressed' ? legacyColors.autoSave : levelData,
        )
        await page.reload()
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const { state } = await import('/src/history/index.ts')
                    const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
                    const s = state.value
                    return serializeToLevelData(
                        s.initialLife,
                        s.isDynamicStages,
                        s.bgm.offset,
                        s.store,
                        s.groups,
                        s.stages,
                    )
                }),
            )
            .toEqual(upgraded)
        expect(
            await page.evaluate(async () => {
                const { state } = await import('/src/history/index.ts')
                return [...state.value.store.slides.note.values()]
                    .slice(0, 8)
                    .map(([head]) => head!.connectorStyle)
            }),
        ).toEqual(['neutral', 'red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'black'])
    })
}

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

test('tab recovery preserves default guide color without adding it to exported levels', async ({
    page,
    context,
}) => {
    await page.evaluate(() => {
        const { history, fixtures, settings } = window.editorTest
        settings.autoSave = true
        settings.autoSaveDelay = 5
        const base = { ...fixtures.interaction.slides[0]![0]!, connectorType: 'guide' as const }
        history.resetState(
            true,
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 1 },
                        { ...base, beat: 2, connectorStyle: 'green' },
                    ],
                    // Unnamed standalone notes are moved before named slides on import.
                    [{ ...base, beat: 3, connectorStyle: 'blue' }],
                    [{ ...base, beat: 4 }],
                    [
                        { ...base, beat: 5, connectorStyle: 'green' },
                        { ...base, beat: 6 },
                    ],
                ],
            },
            0,
            'guide-colors',
        )
    })
    page.on('dialog', (dialog) => void dialog.accept())
    await Promise.all([page.waitForEvent('close'), page.close({ runBeforeUnload: true })])
    const reopened = await context.newPage()
    await reopened.goto('/')
    await expect
        .poll(() =>
            reopened.evaluate(async () => {
                const { state } = await import('/src/history/index.ts')
                return [...state.value.store.slides.note.values()]
                    .flat()
                    .sort((a, b) => a.beat - b.beat)
                    .map(({ beat, connectorStyle }) => ({ beat, connectorStyle }))
            }),
        )
        .toEqual([
            { beat: 1, connectorStyle: 'default' },
            { beat: 2, connectorStyle: 'green' },
            { beat: 3, connectorStyle: 'blue' },
            { beat: 4, connectorStyle: 'default' },
            { beat: 5, connectorStyle: 'green' },
            { beat: 6, connectorStyle: 'default' },
        ])
    const exported = await reopened.evaluate(async () => {
        const { state } = await import('/src/history/index.ts')
        const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
        const s = state.value
        return serializeToLevelData(
            s.initialLife,
            s.isDynamicStages,
            s.bgm.offset,
            s.store,
            s.groups,
            s.stages,
        )
    })
    const kinds = exported.entities.flatMap((entity) =>
        entity.data
            .filter(({ name }) => name === 'segmentKind')
            .map((data) => ('value' in data ? data.value : undefined)),
    )
    expect(kinds.sort()).toEqual([103, 103, 103, 103, 103, 104])
    expect(exported).not.toHaveProperty('defaultGuideColors')
    expect((await recovery(reopened))!.defaultGuideColors).toHaveLength(3)
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

test('undoing dynamic stages leaves the event tools, whose events it could not save', async ({
    page,
}) => {
    const command = page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        history.resetState(false)
        const { cameraEvent } = await appImport<
            typeof import('../../src/editor/commands/events/camera')
        >('/src/editor/commands/events/camera/index.ts')
        await cameraEvent.execute()
    })
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await command
    const tool = () =>
        page.evaluate(async () => {
            const { toolName } = await window.editorTest.appImport<
                typeof import('../../src/editor/tools/state')
            >('/src/editor/tools/state.ts')
            return toolName.value
        })
    expect(await tool()).toBe('cameraEvent')

    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorTest.history.state.value.isDynamicStages)).toBe(
        false,
    )
    await expect.poll(tool).toBe('select')
    const { x, y } = await page.evaluate(() => window.editorTest.point(0, 6))
    await page.mouse.click(x, y)
    expect(
        await page.evaluate(
            () =>
                [...window.editorTest.store.getAllEntities()].filter(
                    (entity) => entity.type === 'cameraEventJoint',
                ).length,
        ),
    ).toBe(0)
})

// A level from a newer build: a time scale ease this build does not know.
const futureLevel = {
    bgmOffset: 0,
    entities: [
        { archetype: 'Initialization', data: [] },
        {
            archetype: '#BPM_CHANGE',
            data: [
                { name: '#BEAT', value: 0 },
                { name: '#BPM', value: 120 },
            ],
        },
        { name: 'g', archetype: '#TIMESCALE_GROUP', data: [] },
        {
            archetype: '#TIMESCALE_CHANGE',
            data: [
                { name: '#TIMESCALE_GROUP', ref: 'g' },
                { name: '#BEAT', value: 1 },
                { name: '#TIMESCALE', value: 2 },
                { name: '#TIMESCALE_SKIP', value: 0 },
                { name: '#TIMESCALE_EASE', value: 99 },
            ],
        },
    ],
}

for (const { label, stored, file } of [
    {
        label: 'from a newer version',
        stored: JSON.stringify({
            version: 1,
            filename: 'future-chart',
            levelData: gzipSync(JSON.stringify(futureLevel)).toString('base64'),
        }),
        // The level file it wraps, as Save writes it.
        file: { name: 'future-chart', gzip: true },
    },
    {
        label: 'stored incompletely',
        stored: JSON.stringify(futureLevel).slice(0, 120),
        file: { name: 'Recovery.txt', gzip: false },
    },
]) {
    test(`an unreadable recovery ${label} is set aside, explained and downloadable`, async ({
        page,
    }) => {
        await page.evaluate((stored) => {
            localStorage.setItem('sonolus-next-sekai-editor.autoSave.levelData', stored)
        }, stored)
        await page.reload()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toContainText('could not be restored')
        await expect(dialog).toContainText('your new changes will not replace it')
        await expect(dialog).not.toContainText('Error')
        const stores = () =>
            page.evaluate(() => ({
                recovery: localStorage.getItem('sonolus-next-sekai-editor.autoSave.levelData'),
                aside: localStorage.getItem('sonolus-next-sekai-editor.autoSave.unreadable'),
            }))
        expect(await stores()).toEqual({ recovery: null, aside: stored })

        // A later edit writes its own recovery and leaves the set-aside one alone.
        await dialog.getByRole('button', { name: 'OK' }).click()
        await expect(dialog).toHaveCount(0)
        await page.evaluate(installEditorFixture)
        await editNamedChart(page)
        await expect.poll(async () => (await stores()).recovery).not.toBeNull()
        expect((await stores()).aside).toBe(stored)

        // Offered again on the next start. Browsers never confirm a download saved,
        // so downloading keeps the stored copy; only Discard removes it.
        await page.reload()
        await expect(dialog).toContainText('is still set aside')
        await expect(dialog).toContainText('until you discard it')
        const downloading = page.waitForEvent('download')
        await dialog.getByRole('button', { name: 'Download' }).click()
        const download = await downloading
        expect(download.suggestedFilename()).toBe(file.name)
        const bytes = readFileSync((await download.path())!)
        if (file.gzip) expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(futureLevel)
        else expect(bytes.toString()).toBe(stored)
        await expect(dialog.getByRole('status')).toHaveText(
            'A copy was downloaded. The chart is still kept until you discard it.',
        )
        expect((await stores()).aside).toBe(stored)
        await dialog.getByRole('button', { name: 'OK' }).click()
        await expect(dialog).toHaveCount(0)
        expect((await stores()).aside).toBe(stored)

        await page.reload()
        await dialog.getByRole('button', { name: 'Download' }).click()
        await dialog.getByRole('button', { name: 'Discard' }).click()
        await expect(dialog).toHaveCount(0)
        expect((await stores()).aside).toBeNull()
    })
}

const unreadableStores = (page: Page) =>
    page.evaluate(() => ({
        recovery: localStorage.getItem('sonolus-next-sekai-editor.autoSave.levelData'),
        aside: localStorage.getItem('sonolus-next-sekai-editor.autoSave.unreadable'),
    }))

test('discarding a set-aside recovery removes it', async ({ page }) => {
    await page.evaluate(() => {
        localStorage.setItem('sonolus-next-sekai-editor.autoSave.unreadable', '{"damaged')
    })
    await page.reload()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('is still set aside')
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await unreadableStores(page)).toEqual({ recovery: null, aside: null })
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(dialog).toHaveCount(0)
})

test('a second unreadable recovery waits behind the set-aside one', async ({ page }) => {
    const earlier = '{"earlier'
    const later = '{"later'
    await page.evaluate(
        ({ earlier, later }) => {
            localStorage.setItem('sonolus-next-sekai-editor.autoSave.unreadable', earlier)
            localStorage.setItem('sonolus-next-sekai-editor.autoSave.levelData', later)
        },
        { earlier, later },
    )
    await page.reload()
    const dialog = page.getByRole('dialog')
    // The earlier one first, kept.
    await expect(dialog).toContainText('is still set aside')
    await dialog.getByRole('button', { name: 'OK' }).click()
    // Then the later one, which stays in place without replacing it.
    await expect(dialog).toContainText('could not be restored')
    await expect(dialog).toContainText('An earlier chart that could not be restored')
    expect(await unreadableStores(page)).toEqual({ recovery: later, aside: earlier })
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(dialog).toHaveCount(0)

    // Auto save is paused, so an edit leaves both alone.
    await page.evaluate(installEditorFixture)
    await editNamedChart(page)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(200)
    expect(await unreadableStores(page)).toEqual({ recovery: later, aside: earlier })

    // Discarding the earlier one makes room: the later one is set aside.
    await page.reload()
    await expect(dialog).toContainText('is still set aside')
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(dialog).toContainText('It has been set aside')
    expect(await unreadableStores(page)).toEqual({ recovery: null, aside: later })
})

test('an unreadable recovery that cannot be set aside pauses auto save instead', async ({
    page,
}) => {
    const stored = JSON.stringify(futureLevel)
    await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
            if (key.endsWith('autoSave.unreadable'))
                throw new DOMException('Storage is full', 'QuotaExceededError')
            setItem.call(this, key, value)
        }
    })
    await page.evaluate((stored) => {
        localStorage.setItem('sonolus-next-sekai-editor.autoSave.levelData', stored)
    }, stored)
    await page.reload()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Auto save is paused in this tab')
    await dialog.getByRole('button', { name: 'OK' }).click()

    await page.evaluate(installEditorFixture)
    await editNamedChart(page)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(200)
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.autoSave.levelData'),
        ),
    ).toBe(stored)
})

for (const dialog of ['properties', 'bgm'] as const)
    test(`confirming the ${dialog} dialog unchanged adds no history entry`, async ({ page }) => {
        await page.evaluate(() => {
            const { history, fixtures } = window.editorTest
            history.resetState(false, fixtures.interaction, 0.0041, 'clean-chart')
        })
        const command = page.evaluate(async (dialog) => {
            const { commands } = await window.editorTest.appImport<
                typeof import('../../src/editor/commands')
            >('/src/editor/commands/index.ts')
            await commands[dialog].execute()
        }, dialog)
        await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
        await command
        await expect(page.getByRole('dialog')).toHaveCount(0)
        // Let the dialog's result reach the command before checking for an entry.
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))
        expect(
            await page.evaluate(() => ({
                canUndo: window.editorTest.history.canUndo.value,
                isDirty: window.editorTest.history.isDirty.value,
            })),
        ).toEqual({ canUndo: false, isDirty: false })
    })
