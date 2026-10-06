import { expect, test, type Page } from '@playwright/test'
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
    await dialog.getByRole('button', { name: 'Reset Shortcuts', exact: true }).click()
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
    await dialog.getByRole('button', { name: 'Reset Shortcuts', exact: true }).click()
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

test('shortcut capture takes keys when a click does not focus the button', async ({ page }) => {
    const save = page
        .getByRole('dialog')
        .locator('label')
        .filter({ has: page.getByText('Save', { exact: true }) })
        .getByRole('button')
    // Safari and WebKit don't focus a clicked button.
    await save.dispatchEvent('click')
    await expect(save).toHaveText('Press a key or click again to clear')
    await page.keyboard.press('l')
    await expect(save).toHaveText('l')
    expect(await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.save)).toBe('l')

    // Pressing it again to clear must not move focus first, which WebKit does.
    await save.click()
    const focusMayMove = await save.evaluate((button) =>
        button.dispatchEvent(new MouseEvent('mousedown', { cancelable: true })),
    )
    expect(focusMayMove).toBe(false)
})

const shortcutField = (page: Page, name: string) =>
    page
        .getByRole('dialog')
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Keyboard Shortcuts' }) })
        .locator('.form-field')
        .filter({ has: page.locator('.form-field-text').getByText(name, { exact: true }) })
const shortcutButton = (page: Page, name: string) =>
    shortcutField(page, name).locator('label').getByRole('button')
const savedShortcut = (page: Page, name: string) =>
    page.evaluate((name) => window.editorTest.settings.keyboardShortcuts[name as 'save'], name)

test('shortcut capture waits past modifiers and records the chord they make', async ({ page }) => {
    const save = shortcutButton(page, 'Save')
    await save.click()
    await page.keyboard.press('Shift')
    await page.keyboard.press('Control')
    await expect(save).toHaveText('Press a key or click again to clear')
    await page.keyboard.press('Control+s')
    await expect(save).toHaveText('Ctrl+S')
    expect(await savedShortcut(page, 'save')).toBe('Mod+s')

    for (const [key, saved, shown] of [
        ['Meta+Shift+KeyS', 'Mod+Shift+s', 'Ctrl+Shift+S'],
        ['Alt+KeyA', 'Alt+a', 'Alt+A'],
        ['Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp'],
        ['Control+Space', 'Mod+ ', 'Ctrl+Space'],
        // Shift alone stays part of the character, as before.
        ['Shift+KeyU', 'U', 'Shift+U'],
        ['p', 'p', 'p'],
    ] as const) {
        await save.click()
        await page.keyboard.press(key)
        await expect(save, key).toHaveText(shown)
        expect(await savedShortcut(page, 'save'), key).toBe(saved)
    }

    // AltGr types a character, so it records the plain key.
    await save.click()
    await save.dispatchEvent('keydown', { key: '[', ctrlKey: true, altKey: true })
    await expect(save).toHaveText('[')
    expect(await savedShortcut(page, 'save')).toBe('[')
})

test('shortcut capture refuses chords the browser keeps and waits for another key', async ({
    page,
}) => {
    const save = shortcutButton(page, 'Save')
    await save.click()
    await save.dispatchEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true })
    await expect(save).toHaveText('Ctrl+W belongs to the browser; press another key')
    expect(await savedShortcut(page, 'save')).toBe('p')
    // Ctrl+H reaches pages off Apple devices, so it can be bound.
    await page.keyboard.press('Control+h')
    await expect(save).toHaveText('Ctrl+H')
    expect(await savedShortcut(page, 'save')).toBe('Mod+h')
})

test('shared and browser-claiming bindings are named under their rows', async ({ page }) => {
    // Default plain keys that also answer to the browser's Ctrl chords.
    await expect(shortcutField(page, 'Manage Stages')).toContainText(
        "Replaces the browser's reload",
    )
    await expect(shortcutField(page, 'Select')).toContainText("Replaces the browser's find")
    // The browser keeps zooming with Ctrl+=.
    await expect(shortcutField(page, 'Zoom In Y')).not.toContainText('Replaces')
    await expect(shortcutField(page, 'Save')).not.toContainText('Replaces')

    await shortcutButton(page, 'Save').click()
    await page.keyboard.press('s')
    await expect(shortcutField(page, 'Save')).toContainText('Also runs Slide')
    await expect(shortcutField(page, 'Slide')).toContainText('Also runs Save')
    await expect(shortcutButton(page, 'Slide')).toHaveAccessibleDescription(/Also runs Save/)

    // An exact chord takes Ctrl+R from the plain r, and the warning moves with it.
    await shortcutButton(page, 'Save').click()
    await page.keyboard.press('Control+r')
    await expect(shortcutField(page, 'Slide')).not.toContainText('Also runs')
    await expect(shortcutField(page, 'Save')).toContainText("Replaces the browser's reload")
    await expect(shortcutField(page, 'Manage Stages')).not.toContainText('Replaces')
})

test.describe('on Apple devices', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
            Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
        })
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.keyboard.press(',')
        await expect(page.getByRole('dialog')).toBeVisible()
    })

    test('chords show menu symbols and Cmd chords the system keeps are refused', async ({
        page,
    }) => {
        const save = shortcutButton(page, 'Save')
        await save.click()
        await save.dispatchEvent('keydown', { key: 'h', metaKey: true, cancelable: true })
        await expect(save).toHaveText('⌘H belongs to the browser; press another key')
        await page.keyboard.press('Meta+Shift+KeyS')
        await expect(save).toHaveText('⇧⌘S')
        expect(await savedShortcut(page, 'save')).toBe('Mod+Shift+s')
    })
})
