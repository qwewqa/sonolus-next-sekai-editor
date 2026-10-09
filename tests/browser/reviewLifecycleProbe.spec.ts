import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { show, fixtures, settings, appImport } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        settings.showPreview = false
        settings.showSidebar = false
        settings.elevationEditorSideBySide = 'disallow'
        const elevation = await appImport<typeof import('../../src/editor/elevation/state')>(
            '/src/editor/elevation/state.ts',
        )
        elevation.openElevationEditor(3)
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
})

for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
    test(`review: composition Escape retains Elevation ${JSON.stringify(composing)}`, async ({
        page,
    }) => {
        const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
        await beat.focus()
        await beat.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', ...composing })
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await expect(beat).toBeFocused()
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        await page.keyboard.press('Escape')
        await expect(page.locator('.elevation-canvas')).toHaveCount(0)
    })
}

test('review: first IME Escape keeps uncommitted Beat text', async ({ page }) => {
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('9')
    await beat.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 229 })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await expect(beat).toHaveValue('9')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('review: closing Elevation with Select during a drag cancels recognizer and history', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { switchToolTo } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools')
        >('/src/editor/tools/index.ts')
        switchToolTo('select')
    })
    const local = await page.evaluate(async () => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const row = elevationLayout.value.rows[0]!
        return { x: row.x, y: row.y }
    })
    const box = (await page.locator('.elevation-canvas').boundingBox())!
    await page.mouse.move(box.x + local.x, box.y + local.y)
    await page.mouse.down()
    await page.mouse.move(box.x + local.x + 50, box.y + local.y - 40, { steps: 4 })
    expect(
        await page.evaluate(async () => {
            const { isDragging } = await window.editorTest.appImport<
                typeof import('../../src/editor/controls/gestures/recognizers/drag')
            >('/src/editor/controls/gestures/recognizers/drag.ts')
            return !!isDragging.value
        }),
    ).toBe(true)
    await page.evaluate(async () => {
        const { closeElevationEditor } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        closeElevationEditor()
    })
    await expect(page.locator('.elevation-canvas')).toHaveCount(0)
    expect(
        await page.evaluate(async () => {
            const { isDragging } = await window.editorTest.appImport<
                typeof import('../../src/editor/controls/gestures/recognizers/drag')
            >('/src/editor/controls/gestures/recognizers/drag.ts')
            return !!isDragging.value
        }),
    ).toBe(false)
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('review: Escape during split resize preserves the Elevation selection', async ({ page }) => {
    await page.evaluate(() => {
        const { settings, history } = window.editorTest
        settings.elevationEditorSideBySide = 'allow'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()]
                .flat()
                .slice(0, 1),
        })
    })
    const selected = () => page.evaluate(() => window.editorTest.snapshot().selected)
    const initial = await selected()
    expect(initial).toHaveLength(1)
    const width = await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.focus()
    const divider = page.getByRole('separator', { name: 'Resize Elevation Editor', exact: true })
    const box = (await divider.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 4 })
    await expect(beat).toBeFocused()
    await beat.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 229 })
    await expect(divider).toHaveClass(/is-dragging/)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)).toBe(width)
    expect(await selected()).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await page.keyboard.press('Escape')
    expect(await selected()).toEqual([])
    await page.mouse.up()
})

test('review: IME Escape keeps a note drag active, ordinary Escape cancels once', async ({
    page,
}) => {
    const local = await page.evaluate(async () => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const row = elevationLayout.value.rows[0]!
        return { x: row.x, y: row.y }
    })
    const box = (await page.locator('.elevation-canvas').boundingBox())!
    await page.mouse.move(box.x + local.x, box.y + local.y)
    await page.mouse.down()
    await page.mouse.move(box.x + local.x + 50, box.y + local.y - 40, { steps: 4 })
    const dragging = () =>
        page.evaluate(async () => {
            const { isDragging } = await window.editorTest.appImport<
                typeof import('../../src/editor/controls/gestures/recognizers/drag')
            >('/src/editor/controls/gestures/recognizers/drag.ts')
            return !!isDragging.value
        })
    expect(await dragging()).toBe(true)
    await page
        .locator('body')
        .dispatchEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 229 })
    expect(await dragging()).toBe(true)
    await page.keyboard.press('Escape')
    expect(await dragging()).toBe(false)
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
