import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { history, fixtures, settings } = window.editorTest
        history.resetState(false, structuredClone(fixtures.notes), 0, 'toolbar.json')
        settings.showPreview = false
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, eraser: 'g', select: 'f' }
    })
})

const toolbar = (page: Page) => page.locator('[data-editor-toolbar]')
// Each group's shown tool, outside any open flyout.
const shown = (page: Page) => toolbar(page).locator(':scope > div > div > button')

const pressedTitles = (page: Page) =>
    shown(page).evaluateAll((buttons) =>
        buttons
            .filter((button) => button.getAttribute('aria-pressed') === 'true')
            .map((button) => button.getAttribute('title')),
    )

const run = (page: Page, name: string) =>
    page.evaluate(async (name) => {
        const { commands } = await import('/src/editor/commands/index.ts')
        await commands[name as keyof typeof commands].execute()
        await window.editorTest.nextTick()
    }, name)

test('the toolbar shows the tool in use as pressed', async ({ page }) => {
    await expect.poll(() => pressedTitles(page)).toEqual(['Select'])
    const select = shown(page).and(page.getByTitle('Select', { exact: true }))
    await expect(select).toHaveAttribute('aria-pressed', 'true')
    await expect(select).toHaveClass(/bg-accent/)
    // Plain actions are not toggles; modes not in use are.
    for (const title of ['Undo', 'Open', 'Help'])
        await expect(shown(page).and(page.getByTitle(title, { exact: true }))).not.toHaveAttribute(
            'aria-pressed',
        )
    await expect(shown(page).and(page.getByTitle('Event', { exact: true }))).toHaveAttribute(
        'aria-pressed',
        'false',
    )

    // A shortcut switches tools; the group shows the tool now in use.
    await page.keyboard.press('g')
    await expect.poll(() => pressedTitles(page)).toEqual(['Eraser'])
    await expect(shown(page).and(page.getByTitle('Select', { exact: true }))).toHaveCount(0)
    await page.keyboard.press('f')
    await expect.poll(() => pressedTitles(page)).toEqual(['Select'])

    // The elevation editor is a mode beside the tool.
    await run(page, 'elevation')
    await expect
        .poll(() => pressedTitles(page))
        .toEqual(expect.arrayContaining(['Elevation Editor']))
    await run(page, 'elevation')
    await expect.poll(() => pressedTitles(page)).toEqual(['Select'])
})

test('note presets are pressed only for the preset in use', async ({ page }) => {
    await run(page, 'note2')
    await expect.poll(() => pressedTitles(page)).toEqual(['Note'])

    // The flyout lists the generic note tool and the preset in use as pressed.
    await shown(page)
        .and(page.getByTitle('Note', { exact: true }))
        .hover()
    const flyout = toolbar(page).locator(':scope > div > div > div button')
    await expect(flyout.first()).toBeVisible()
    await expect
        .poll(() =>
            flyout.evaluateAll((buttons) =>
                buttons
                    .filter((button) => button.getAttribute('aria-pressed') === 'true')
                    .map((button) => button.getAttribute('title')),
            ),
        )
        .toEqual(['Note #3', 'Note'])
})

test('toolbar settings show tools without a pressed state', async ({ page }) => {
    await run(page, 'settings')
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByTitle('Select', { exact: true }).first()).toBeVisible()
    await expect(dialog.locator('[aria-pressed]')).toHaveCount(0)
})

test('groups with flyouts say so and name the open one', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['undo'], ['redo', 'select']]
    })
    const single = shown(page).and(page.getByTitle('Undo', { exact: true }))
    const group = shown(page).and(page.getByTitle('Select', { exact: true }))
    await expect(single).not.toHaveAttribute('aria-haspopup')
    await expect(single).not.toHaveAttribute('aria-expanded')
    await expect(group).toHaveAttribute('aria-haspopup', 'true')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(group).not.toHaveAttribute('aria-controls')

    await group.focus()
    await page.keyboard.press('Enter')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    const id = await group.getAttribute('aria-controls')
    await expect(page.locator(`[id="${id}"]`).getByTitle('Redo', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(group).not.toHaveAttribute('aria-controls')
})

test('choosing a flyout member by keyboard keeps focus on the group', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['eraser', 'select']]
    })
    const group = shown(page).and(page.getByTitle('Select', { exact: true }))
    await group.focus()
    await page.keyboard.press('Enter')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await expect(toolbar(page).locator(':scope > div > div > div button').first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(group).toHaveCount(0)
    await expect(shown(page).and(page.getByTitle('Eraser', { exact: true }))).toBeFocused()
})

test('a tool dialog keeps the members chosen in each group', async ({ page }) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.propertiesPosition = 'disabled'
        settings.toolbar = [['redo', 'undo'], ['note']]
    })
    const undo = shown(page).and(page.getByTitle('Undo', { exact: true }))
    await undo.hover()
    await toolbar(page).getByTitle('Redo', { exact: true }).click()
    await expect(shown(page).and(page.getByTitle('Redo', { exact: true }))).toBeVisible()

    await run(page, 'note')
    // Run again, the tool opens its settings dialog, which stays open.
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.note.execute()
    })
    await expect(page.locator('.editor-tool-modal')).toBeVisible()
    await expect(toolbar(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.editor-tool-modal')).toHaveCount(0)
    await expect(shown(page).and(page.getByTitle('Redo', { exact: true }))).toBeVisible()

    // A new layout starts from each group's default.
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['redo', 'undo'], ['select']]
    })
    await expect(undo).toBeVisible()
})
