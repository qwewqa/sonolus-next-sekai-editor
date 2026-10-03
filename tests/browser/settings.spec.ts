import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.keyboard.press(',')
    await expect(page.getByRole('dialog')).toBeVisible()
})

test('shortcut capture preserves the old binding until replaced or cleared', async ({ page }) => {
    const dialog = page.getByRole('dialog')
    const save = dialog
        .locator('label')
        .filter({ has: page.getByText('Save', { exact: true }) })
        .getByRole('button')
    await save.click()
    await expect(save).toHaveText('Press a key or click again to clear')
    expect(await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.save)).toBe('p')
    await dialog.getByRole('button', { name: 'Reset Settings', exact: true }).focus()
    await expect(save).toHaveText('p')
    await save.click()
    await save.press('l')
    await expect(save).toHaveText('l')
    await save.click()
    await save.click()
    await expect(save).toHaveText('Unassigned')
    expect(
        await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.save),
    ).toBeUndefined()
    expect(
        await page.evaluate(
            () =>
                JSON.parse(
                    localStorage.getItem('sonolus-next-sekai-editor.keyboardShortcuts') ?? '{}',
                ).save,
        ),
    ).toBeUndefined()
    await save.click()
    await save.press('Tab')
    await expect(save).toHaveText('Unassigned')
    await dialog.getByRole('button', { name: 'Reset Keybinds', exact: true }).click()
    await expect(save).toHaveText('p')
})

test('settings and keybind resets are independent and remove saved overrides', async ({ page }) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewNoteSpeed = 9.25
        settings.previewHighlightSelection = false
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, save: 'l' }
    })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Reset Keybinds', exact: true }).click()
    expect(await page.evaluate(() => window.editorTest.settings.previewNoteSpeed)).toBe(9.25)
    expect(await page.evaluate(() => window.editorTest.settings.previewHighlightSelection)).toBe(
        false,
    )
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.keyboardShortcuts'),
        ),
    ).toBeNull()
    await page.evaluate(() => {
        window.editorTest.settings.keyboardShortcuts = {
            ...window.editorTest.settings.keyboardShortcuts,
            save: 'l',
        }
    })
    await dialog.getByRole('button', { name: 'Reset Settings', exact: true }).click()
    expect(await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.save)).toBe('l')
    expect(await page.evaluate(() => window.editorTest.settings.previewHighlightSelection)).toBe(
        true,
    )
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.previewNoteSpeed'),
        ),
    ).toBeNull()
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.previewHighlightSelection'),
        ),
    ).toBeNull()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
