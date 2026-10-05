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
    await expect(shown(page).and(page.getByTitle('Undo', { exact: true }))).toHaveAttribute(
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
