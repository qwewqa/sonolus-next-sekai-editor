import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Delete removes the selection, as the selection menu's Delete does.

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
        const { history, fixtures, show } = window.editorTest
        show(fixtures.interaction, 3)
        const notes = [...history.state.value.store.slides.note.values()].flat().slice(0, 2)
        history.replaceState({ ...history.state.value, selectedEntities: notes })
    })
})

test.afterEach(({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const counts = (page: Page) =>
    page.evaluate(() => ({
        notes: window.editorTest.snapshot().notes.length,
        selected: window.editorTest.snapshot().selected.length,
        canUndo: window.editorTest.history.canUndo.value,
    }))

test('Delete removes the selection in one undo step', async ({ page }) => {
    expect(await counts(page)).toEqual({ notes: 4, selected: 2, canUndo: false })
    await page.keyboard.press('Delete')
    expect(await counts(page)).toEqual({ notes: 2, selected: 0, canUndo: true })
    await expect(page.locator('.notification')).toHaveText('Deleted 2 objects')
    await page.keyboard.press('z')
    await expect(page.locator('.notification')).toHaveText('Undid "Deleted 2 objects"')
    expect(await counts(page)).toEqual({ notes: 4, selected: 2, canUndo: false })
})

test('Delete does nothing without a deletable selection', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const bpm = [...store.getAllEntities()].find(
            (entity) => entity.type === 'bpm' && entity.beat === 0,
        )!
        history.replaceState({ ...history.state.value, selectedEntities: [bpm] })
    })
    await page.keyboard.press('Delete')
    expect(await counts(page)).toEqual({ notes: 4, selected: 1, canUndo: false })
})

test('Delete in a field edits the field, not the chart', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
    })
    const beat = page.getByLabel('Beat', { exact: true })
    await beat.focus()
    await beat.press('Home')
    await beat.press('Delete')
    expect(await counts(page)).toEqual({ notes: 4, selected: 2, canUndo: false })
})

test('the selection menu item is the command, with its shortcut', async ({ page }) => {
    const point = await page.evaluate(() => {
        const note = window.editorTest.history.state.value.selectedEntities[0]!
        return window.editorTest.point(
            note.type === 'note' ? note.left + note.size / 2 : 0,
            note.beat,
        )
    })
    await page.mouse.click(point.x, point.y, { button: 'right' })
    const item = page.getByRole('menu').getByRole('menuitem', { name: 'Delete', exact: true })
    await expect(item).toContainText('Delete')
    await expect(item.locator('[aria-hidden="true"]').last()).toHaveText('Delete')
    // Its key acts from the open menu too.
    await page.keyboard.press('Delete')
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await counts(page)).toEqual({ notes: 2, selected: 0, canUndo: true })
})

test('Delete is not on the default toolbar', async ({ page }) => {
    const toolbar = await page.evaluate(() => window.editorTest.settings.toolbar.flat())
    expect(toolbar).toContain('cut')
    expect(toolbar).not.toContain('deleteSelection')
})

test('Delete can be rebound in Settings', async ({ page }) => {
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    const button = dialog
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Keyboard Shortcuts' }) })
        .locator('.form-field')
        .filter({ has: page.locator('.form-field-text').getByText('Delete', { exact: true }) })
        .locator('label')
        .getByRole('button')
    await expect(button).toHaveText('Delete')
    await button.click()
    await page.keyboard.press('l')
    await expect(button).toHaveText('L')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.keyboard.press('Delete')
    expect(await counts(page)).toEqual({ notes: 4, selected: 2, canUndo: false })
    await page.keyboard.press('l')
    expect(await counts(page)).toEqual({ notes: 2, selected: 0, canUndo: true })
})

test('Delete on a panel tab closes the panel and leaves the selection', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
    })
    const tab = page.getByRole('tab', { name: 'Properties', exact: true })
    await expect(page.locator('#workspace-panel-properties')).toBeVisible()
    await tab.focus()
    await page.keyboard.press('Delete')
    await expect(page.locator('#workspace-panel-properties')).toHaveCount(0)
    expect(await counts(page)).toEqual({ notes: 4, selected: 2, canUndo: false })
})
