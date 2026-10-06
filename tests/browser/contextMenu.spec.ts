import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const click = async (
    page: Page,
    lane: number,
    beat: number,
    button: 'left' | 'right' = 'right',
) => {
    const point = await page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), {
        lane,
        beat,
    })
    await page.mouse.click(point.x, point.y, { button })
}
const snapshot = (page: Page) => page.evaluate(() => window.editorTest.snapshot())
const runtimeErrors = new WeakMap<Page, string[]>()
const selectTwo = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        const notes = [...history.state.value.store.slides.note.values()].flat().slice(0, 2)
        history.replaceState({ ...history.state.value, selectedEntities: notes })
    })

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'selectContextMenu'
    })
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

test('context beat scaling fixes the first beat and is undoable', async ({ page }) => {
    await selectTwo(page)
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Scale Elevations', exact: true })).toHaveCount(
        0,
    )
    await menu.getByRole('menuitem', { name: 'Scale Beats', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('spinbutton', { name: 'Scale Factor', exact: true }).fill('2')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await snapshot(page)).selected.map((note) => note.beat).sort((a, b) => a - b)).toEqual([
        3, 7,
    ])
    await page.keyboard.press('z')
    expect((await snapshot(page)).selected.map((note) => note.beat).sort((a, b) => a - b)).toEqual([
        3, 5,
    ])
})

test('localized scale controls fit a narrow phone and reject invalid factors', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.evaluate(() => {
        window.editorTest.settings.locale = 'fr'
    })
    await expect.poll(() => page.evaluate(() => window.editorTest.view.w)).toBe(320)
    await selectTwo(page)
    await click(page, -3, 3)
    await page.getByRole('menuitem', { name: 'Mettre les temps à l’échelle', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const input = dialog.getByRole('spinbutton', { name: 'Facteur d’échelle', exact: true })
    await input.fill('0')
    await expect(dialog.getByRole('button', { name: 'Appliquer', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
    await page.screenshot({ path: testInfo.outputPath('phone-scale-validation.png') })
    await input.fill('1')
    await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('select with context menu is the default secondary button and others persist', async ({
    page,
}) => {
    await page.evaluate(() =>
        localStorage.removeItem('sonolus-next-sekai-editor.mouseSecondaryTool'),
    )
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.keyboard.press(',')
    const field = page
        .getByRole('dialog')
        .getByRole('combobox', { name: 'Secondary Tool', exact: true })
    await expect(field).toHaveValue('selectContextMenu')
    const stored = () =>
        page.evaluate(() => localStorage.getItem('sonolus-next-sekai-editor.mouseSecondaryTool'))
    await field.selectOption('eraser')
    expect(await stored()).toBe('"eraser"')
    await field.selectOption({ label: 'Select + Context Menu' })
    // The default is not stored, so future default changes still apply.
    expect(await stored()).toBeNull()
})

test('plain right click selects a note and deletion is undoable', async ({ page }) => {
    await page.keyboard.press('a')
    await click(page, -3, 3)
    const menu = page.getByRole('menu', { name: 'Selection Actions' })
    await expect(menu).toBeVisible()
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 3, left: -4, size: 2 }])
    expect((await snapshot(page)).notes).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await expect(menu.getByRole('menuitem', { name: /Combine into Slide/ })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(menu).toHaveCount(0)
    expect((await snapshot(page)).notes).toHaveLength(3)
    await page.keyboard.press('z')
    expect((await snapshot(page)).notes).toHaveLength(4)
    await click(page, 5, 11, 'left')
    expect((await snapshot(page)).notes).toHaveLength(5)
})

test('right clicking a selected member preserves the whole selection', async ({ page }) => {
    await selectTwo(page)
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    expect((await snapshot(page)).selected).toHaveLength(2)
    await expect(menu.getByRole('menuitem', { name: /Combine into Slide/ })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    expect((await snapshot(page)).notes).toHaveLength(2)
    await page.keyboard.press('z')
    expect((await snapshot(page)).notes).toHaveLength(4)
    await click(page, 4, 7)
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 7, left: 3, size: 2 }])
})

test('empty right clicks deselect first and only open a menu without a selection', async ({
    page,
}) => {
    await selectTwo(page)
    await page.keyboard.press('a')
    const before = await page.evaluate(() => window.editorTest.view.cursorTime)
    await click(page, -5, 11)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).selected).toEqual([])
    expect((await snapshot(page)).notes).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(before)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await click(page, -5, 11)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Edit Elevations', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
})

test('modified right clicks and right drags select without opening a menu', async ({ page }) => {
    await click(page, -3, 3, 'left')
    await page.keyboard.down('Control')
    await click(page, 1, 5)
    await page.keyboard.up('Control')
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).selected).toHaveLength(2)
    const start = await page.evaluate(() => window.editorTest.point(-3, 3))
    const end = await page.evaluate(() => window.editorTest.point(-2, 4))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(end.x, end.y, { steps: 10 })
    await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
    await page.mouse.up({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).selected.map((note) => note.beat).sort((a, b) => a - b)).toEqual([
        4, 6,
    ])
})

test('the menu stays in the viewport and supports keyboard navigation and dismissal', async ({
    page,
}) => {
    await selectTwo(page)
    const bounds = await page.locator('canvas.editor-chart').boundingBox()
    if (!bounds) throw new Error('Missing canvas')
    await page.mouse.click(bounds.x + bounds.width - 10, bounds.y + bounds.height - 10, {
        button: 'right',
    })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).selected).toEqual([])
    await page.mouse.click(bounds.x + bounds.width - 10, bounds.y + bounds.height - 10, {
        button: 'right',
    })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const rect = await menu.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(1600)
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(1000)
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem', { name: 'Edit Elevations', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect((await snapshot(page)).selected).toHaveLength(0)
    await selectTwo(page)
    await click(page, -3, 3)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    expect((await snapshot(page)).notes).toHaveLength(2)
})

test('the original secondary tool options retain their behavior', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'select'
    })
    await click(page, -3, 3)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).selected).toHaveLength(1)
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'eraser'
    })
    await click(page, -3, 3)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).notes).toHaveLength(3)
})

test('the initial BPM only offers applicable clipboard actions', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const bpm = [...store.getAllEntities()].find(
            (entity) => entity.type === 'bpm' && entity.beat === 0,
        )
        if (!bpm) throw new Error('Missing initial BPM')
        history.replaceState({ ...history.state.value, selectedEntities: [bpm] })
        window.editorTest.view.time = 1
    })
    await click(page, 6.5, 0)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
    await expect(
        menu.getByRole('menuitem', { name: /Flip|Delete|Cut|Combine into Slide/ }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('select slide notes expands to siblings while preserving other selected notes', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [...fixtures.interaction.slides[0]!, ...fixtures.interaction.slides[1]!],
                    ...fixtures.interaction.slides.slice(2),
                ],
            },
            3,
        )
        const selected = [...history.state.value.store.slides.note.values()]
            .flat()
            .filter((note) => note.beat === 3 || note.beat === 7)
        history.replaceState({ ...history.state.value, selectedEntities: selected })
    })
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitem', { name: 'Select Slide Notes', exact: true }).click()
    expect(
        (await snapshot(page)).selected.map((entity) => entity.beat).sort((a, b) => a - b),
    ).toEqual([3, 5, 7])
    expect((await snapshot(page)).notes).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await click(page, -3, 3)
    await expect(
        menu.getByRole('menuitem', { name: 'Select Slide Notes', exact: true }),
    ).toHaveCount(0)
})

test('filtered notes are not selected by a context click', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.view.visibilities.note = false
    })
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    expect((await snapshot(page)).selected).toEqual([])
    await expect(menu.getByRole('menuitem', { name: /Delete|Cut|Combine into Slide/ })).toHaveCount(
        0,
    )
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
        window.editorTest.view.visibilities.note = true
    })
    await click(page, -3, 3)
    expect((await snapshot(page)).selected).toHaveLength(1)
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible()
})

test('clicking outside or resizing dismisses the menu without changing chart data', async ({
    page,
}) => {
    await selectTwo(page)
    await click(page, -3, 3)
    await expect(page.getByRole('menu')).toBeVisible()
    const bounds = await page.locator('canvas.editor-chart').boundingBox()
    if (!bounds) throw new Error('Missing canvas')
    await page.mouse.click(bounds.x + 10, bounds.y + 10)
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).notes).toHaveLength(4)
    await click(page, -3, 3)
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).notes).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('visible command shortcuts act once while the menu has focus', async ({ page }) => {
    await selectTwo(page)
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(
        menu.getByRole('menuitem', { name: 'Flip Horizontally', exact: true }),
    ).toContainText('u')
    await page.keyboard.press('u')
    await expect(menu).toHaveCount(0)
    expect(
        (await snapshot(page)).selected.map((entity) => entity.left).sort((a, b) => a! - b!),
    ).toEqual([-2, 2])
    await page.keyboard.press('z')
    expect(
        (await snapshot(page)).selected.map((entity) => entity.left).sort((a, b) => a! - b!),
    ).toEqual([-4, 0])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('menu shortcuts answer with Ctrl and to chord bindings, showing the chord', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, flip: 'Mod+Shift+h' }
    })
    await selectTwo(page)
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(
        menu.getByRole('menuitem', { name: 'Flip Horizontally', exact: true }),
    ).toContainText('Ctrl+Shift+H')
    // The bare key no longer flips; the chord does.
    await page.keyboard.press('h')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Control+Shift+H')
    await expect(menu).toHaveCount(0)
    const lefts = async () =>
        (await snapshot(page)).selected.map((entity) => entity.left).sort((a, b) => a! - b!)
    expect(await lefts()).toEqual([-2, 2])

    // Plain keys still answer with Ctrl held, as Ctrl+Z does on the canvas.
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, flip: 'u' }
    })
    await page.keyboard.press('z')
    await selectTwo(page)
    await click(page, -3, 3)
    await expect(menu).toBeVisible()
    await page.keyboard.press('Control+u')
    await expect(menu).toHaveCount(0)
    expect(await lefts()).toEqual([-2, 2])
})

test('changing view zoom or scrolling dismisses an open menu', async ({ page }) => {
    await click(page, -3, 3)
    await expect(page.getByRole('menu')).toBeVisible()
    await page.evaluate(() => {
        window.editorTest.settings.width = 24
    })
    await expect(page.getByRole('menu')).toHaveCount(0)
    await click(page, -3, 3)
    await expect(page.getByRole('menu')).toBeVisible()
    await page.evaluate(() => {
        window.editorTest.view.time += 0.5
    })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await snapshot(page)).notes).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('menus fit desktop and narrow viewports with readable selection actions', async ({
    page,
}, testInfo) => {
    await click(page, -3, 3)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('desktop-note-menu.png') })
    await page.keyboard.press('Escape')
    await selectTwo(page)
    await click(page, -3, 3)
    await expect(menu.getByRole('menuitem', { name: /Combine into Slide/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('desktop-multiple-notes-menu.png') })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 600 })
    await page.evaluate(() => {
        window.editorTest.view.time = 3.8
    })
    await expect.poll(() => page.evaluate(() => window.editorTest.view.w)).toBe(390)
    await click(page, 1, 5)
    await expect(menu).toBeVisible()
    expect((await snapshot(page)).selected).toHaveLength(2)
    const rect = await menu.boundingBox()
    if (!rect) throw new Error('Missing menu')
    expect(rect.x).toBeGreaterThanOrEqual(4)
    expect(rect.y).toBeGreaterThanOrEqual(4)
    expect(rect.x + rect.width).toBeLessThanOrEqual(386)
    expect(rect.y + rect.height).toBeLessThanOrEqual(596)
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('narrow-menu.png') })
})
