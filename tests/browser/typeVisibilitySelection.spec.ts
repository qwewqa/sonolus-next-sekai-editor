import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Objects of a hidden type leave the selection, as objects in hidden groups and stages do.

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show(fixtures.events, 2.5)
    })
    await settle(page)
})

test.afterEach(({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const marquee = async (page: Page) => {
    const start = await point(page, -10, 0.3)
    const end = await point(page, 9.5, 9.9)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)
}

/** Counts by type, of the selection or of the chart. */
const types = (page: Page, of: 'selected' | 'chart') =>
    page.evaluate((of) => {
        const { history, store } = window.editorTest
        const entities =
            of === 'selected' ? history.state.value.selectedEntities : [...store.getAllEntities()]
        const counts: Record<string, number> = {}
        for (const { type } of entities) {
            if (type.endsWith('Connection') || type === 'connector') continue
            counts[type] = (counts[type] ?? 0) + 1
        }
        return counts
    }, of)

const all = {
    bpm: 2,
    timeScale: 4,
    cameraEventJoint: 4,
    stageMaskEventJoint: 4,
    stagePivotEventJoint: 4,
    stageStyleEventJoint: 4,
    stageTransformEventJoint: 4,
    note: 2,
}
const marqueed = {
    bpm: 1,
    timeScale: 2,
    cameraEventJoint: 2,
    stageMaskEventJoint: 2,
    stagePivotEventJoint: 2,
    stageStyleEventJoint: 2,
    stageTransformEventJoint: 2,
    note: 2,
}
const withoutNotes = { ...all, note: undefined }
const unmarqueed = { ...marqueed, bpm: 2, note: undefined }

const canUndo = (page: Page) => page.evaluate(() => window.editorTest.history.canUndo.value)

test('Delete after hiding types erases only the objects still shown', async ({ page }) => {
    await marquee(page)
    expect(await types(page, 'selected')).toEqual(marqueed)
    // Only notes are shown now.
    await page.keyboard.press('/')
    expect(await types(page, 'selected')).toEqual({ note: 2 })
    expect(await canUndo(page)).toBe(false)
    await page.keyboard.press('Delete')
    await expect(page.locator('.notification')).toHaveText('Deleted 2 objects')
    expect(await types(page, 'chart')).toEqual(withoutNotes)
})

test('Cut and Properties see only the objects still shown', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
    })
    const headings = page.locator(
        '#workspace-panel-properties #properties-section-selection .properties-block-header h3',
    )
    await marquee(page)
    await expect(headings.first()).toHaveText('Notes 2')
    await expect(headings).not.toHaveCount(1)
    await page.keyboard.press('/')
    await expect(headings).toHaveText(['Notes 2'])
    await page.keyboard.press('x')
    await expect(page.locator('.notification')).toHaveText('Cut 2 objects')
    expect(await types(page, 'chart')).toEqual(withoutNotes)
})

test('marquee and click select only shown types', async ({ page }) => {
    await page.keyboard.press('/')
    await marquee(page)
    expect(await types(page, 'selected')).toEqual({ note: 2 })
    // The camera joint at beat 2 is hidden.
    const camera = await page.evaluate(() => {
        const joint = [...window.editorTest.store.getAllEntities()].find(
            (entity) => entity.type === 'cameraEventJoint' && entity.beat === 2,
        )!
        return window.editorTest.point(joint.type === 'cameraEventJoint' ? joint.cameraLeft : 0, 2)
    })
    await page.mouse.click(camera.x, camera.y)
    await settle(page)
    expect(await types(page, 'selected')).toEqual({})
})

test('undo and redo cannot bring a hidden type back into the selection', async ({ page }) => {
    await marquee(page)
    await page.keyboard.press('Delete')
    await expect(page.locator('.notification')).toHaveText('Deleted 14 objects')
    await page.keyboard.press('/')
    await page.keyboard.press('z')
    await settle(page)
    expect(await types(page, 'chart')).toEqual(all)
    expect(await types(page, 'selected')).toEqual({ note: 2 })
    await page.keyboard.press('y')
    await settle(page)
    expect(await types(page, 'chart')).toEqual(unmarqueed)
    expect(await types(page, 'selected')).toEqual({})
    await page.keyboard.press('z')
    await settle(page)
    expect(await types(page, 'selected')).toEqual({ note: 2 })
})

test('hiding a type during a drag cancels the move', async ({ page }) => {
    await marquee(page)
    const start = await point(page, 0, 4)
    const end = await point(page, 0, 5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await settle(page)
    await page.keyboard.press('/')
    await page.mouse.up()
    await settle(page)
    expect(await canUndo(page)).toBe(false)
    expect(await types(page, 'selected')).toEqual({ note: 2 })
    expect(
        await page.evaluate(() =>
            window.editorTest
                .snapshot()
                .notes.map((note) => note.beat)
                .sort(),
        ),
    ).toEqual([4, 8])
})
