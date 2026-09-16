import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        propertyPreview: typeof import('../../src/preview/edit')
    }
}

const read = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        const current = history.state.value
        const preview = window.propertyPreview.getPreviewState(current)
        const brief = (state: typeof current) =>
            state.selectedEntities.map((entity) => ({
                type: entity.type,
                beat: entity.beat,
                ...('left' in entity ? { left: entity.left, size: entity.size } : {}),
            }))
        return {
            committed: brief(current),
            preview: brief(preview),
            hasEdit: !!window.propertyPreview.previewEdit.value,
            canUndo: history.canUndo.value,
            cursorTime: window.editorTest.view.cursorTime,
        }
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const resource = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/preview/edit.ts')
        window.propertyPreview = await import(resource?.name ?? '/src/preview/edit.ts')
        const { history, store, settings } = window.editorTest
        settings.showSidebar = true
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && entity.beat === 3,
            ),
        })
        await window.editorTest.nextTick()
    })
})

test('numeric input previews every valid value and commits one undo step on blur', async ({
    page,
}) => {
    const lane = page.getByLabel('Lane', { exact: true })
    await expect(lane).toHaveValue('-4')
    for (const value of ['-3', '-2', '1.5']) {
        await lane.fill(value)
        const current = await read(page)
        expect(current.preview[0]?.left).toBe(Number(value))
        expect(current.committed[0]?.left).toBe(-4)
        expect(current.canUndo).toBe(false)
        expect(current.cursorTime).toBe(3)
    }
    await lane.press('Tab')
    expect(await read(page)).toMatchObject({
        committed: [{ left: 1.5 }],
        hasEdit: false,
        canUndo: true,
        cursorTime: 3,
    })
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await read(page)).toMatchObject({ committed: [{ left: -4 }], canUndo: false })
    await expect(lane).toHaveValue('-4')

    // Returning to the initial value is not an edit.
    await lane.fill('1')
    await lane.fill('-4')
    await lane.press('Tab')
    expect(await read(page)).toMatchObject({ hasEdit: false, canUndo: false })

    await lane.focus()
    await lane.press('ControlOrMeta+A')
    await lane.pressSequentially('-1e-2')
    await expect(lane).toHaveValue('-1e-2')
    expect((await read(page)).preview[0]?.left).toBe(-0.01)
    await lane.press('Escape')
    await expect(lane).toHaveValue('-4')
})

test('Escape, invalid values, selection changes and unmount discard property drafts', async ({
    page,
}) => {
    const size = page.getByRole('spinbutton', { name: 'Size', exact: true }).first()
    await size.fill('4')
    expect((await read(page)).preview[0]?.size).toBe(4)
    await size.press('Escape')
    await expect(size).toHaveValue('2')
    expect(await read(page)).toMatchObject({ hasEdit: false, canUndo: false })

    await size.fill('5')
    await size.fill('-1')
    expect((await read(page)).hasEdit).toBe(false)
    await size.fill('5')
    expect((await read(page)).preview[0]?.size).toBe(5)
    await size.fill('')
    await size.press('Tab')
    await expect(size).toHaveValue('2')
    expect((await read(page)).canUndo).toBe(false)

    await size.fill('6')
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && entity.beat === 5,
            ),
        })
    })
    await expect(size).toHaveValue('2')
    await size.press('Tab')
    expect(await read(page)).toMatchObject({
        committed: [{ beat: 5, size: 2 }],
        hasEdit: false,
        canUndo: false,
    })

    await size.fill('7')
    await page.evaluate(() => (window.editorTest.settings.showSidebar = false))
    await expect.poll(async () => (await read(page)).hasEdit).toBe(false)
    expect(await read(page)).toMatchObject({ hasEdit: false, canUndo: false })
})

test('moving the initial BPM onto an existing BPM previews the same replacement as commit', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history, store, fixtures, show, view } = window.editorTest
        show(fixtures.events)
        view.cursorTime = 3
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'bpm' && entity.beat === 0,
            ),
        })
    })
    const beat = page.getByLabel('Beat', { exact: true })
    await expect(beat).toHaveValue('0')
    await beat.fill('12')
    const previewBpms = await page.evaluate(() => {
        const current = window.editorTest.history.state.value
        const preview = window.propertyPreview.getPreviewState(current)
        return preview.bpms.map(({ x, s }) => ({ x, bpm: 60 / s }))
    })
    expect(previewBpms).toEqual([
        { x: 0, bpm: 120 },
        { x: 12, bpm: 120 },
    ])
    expect((await read(page)).canUndo).toBe(false)
    await beat.press('Tab')
    expect(
        await page.evaluate(() =>
            window.editorTest.history.state.value.bpms.map(({ x, s }) => ({ x, bpm: 60 / s })),
        ),
    ).toEqual(previewBpms)
    expect((await read(page)).cursorTime).toBe(3)
})

test('a time-scale beat draft replaces the destination without duplicating it', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history, store, fixtures, show } = window.editorTest
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale' && entity.beat === 4.5,
            ),
        })
    })
    const beat = page.getByLabel('Beat', { exact: true })
    await expect(beat).toHaveValue('4.5')
    await beat.fill('14.5')
    const previewTimeScales = await page.evaluate(() => {
        const preview = window.propertyPreview.getPreviewState(
            window.editorTest.history.state.value,
        )
        return [...preview.store.grid.timeScale.values()]
            .flatMap((entities) => [...entities])
            .map(({ beat, timeScale }) => ({ beat, timeScale }))
            .sort((a, b) => a.beat - b.beat)
    })
    expect(previewTimeScales).toEqual([
        { beat: 9.5, timeScale: 0 },
        { beat: 14.5, timeScale: 1 },
        { beat: 19.5, timeScale: 2 },
    ])
    await beat.press('Tab')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.grid.timeScale.values()]
                .flatMap((entities) => [...entities])
                .map(({ beat, timeScale }) => ({ beat, timeScale }))
                .sort((a, b) => a.beat - b.beat),
        ),
    ).toEqual(previewTimeScales)
})

test('property modals preview input and clear uncommitted drafts when closed', async ({ page }) => {
    await page.evaluate(async () => {
        window.editorTest.settings.showSidebar = false
        const { showModal } = await import('/src/modals/index.ts')
        const { default: modal } = await import('/src/editor/tools/note/NotePropertiesModal.vue')
        void showModal(modal, {})
    })
    const lane = page.getByLabel('Lane', { exact: true })
    await expect(lane).toHaveValue('-4')
    await lane.fill('4')
    expect(await read(page)).toMatchObject({
        committed: [{ left: -4 }],
        preview: [{ left: 4 }],
        canUndo: false,
    })
    await page.evaluate(async () => {
        const { modals } = await import('/src/modals/index.ts')
        modals.pop()?.resolve()
    })
    await expect(lane).not.toBeVisible()
    expect(await read(page)).toMatchObject({ hasEdit: false, canUndo: false })
})
