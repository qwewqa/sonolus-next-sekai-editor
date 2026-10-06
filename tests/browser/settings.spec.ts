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
    await expect(save).toHaveText('P')
    await save.click()
    await save.press('l')
    await expect(save).toHaveText('L')
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
    await expect(save).toHaveText('P')
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
    await expect(save).toHaveText('L')
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
/** The refusal under a capturing row; the button keeps its prompt. */
const expectRefused = async (page: Page, name: string, message: string) => {
    await expect(shortcutButton(page, name)).toHaveText('Press a key or click again to clear')
    await expect(shortcutField(page, name).locator('.form-field-notes')).toContainText(message)
    await expect(shortcutField(page, name).getByRole('status')).toContainText(message)
}
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
        ['p', 'p', 'P'],
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
    await expectRefused(
        page,
        'Save',
        'Ctrl+W is reserved by the browser or system. Press another key.',
    )
    expect(await savedShortcut(page, 'save')).toBe('p')
    // Ctrl+H reaches pages off Apple devices, so it can be bound.
    await page.keyboard.press('Control+h')
    await expect(save).toHaveText('Ctrl+H')
    expect(await savedShortcut(page, 'save')).toBe('Mod+h')
    // The refusal goes once capture ends.
    await expect(shortcutField(page, 'Save')).not.toContainText('is reserved')

    // Ctrl+Alt+letter reads as AltGr, so it would record the bare letter.
    await save.click()
    await save.dispatchEvent('keydown', { key: 'k', ctrlKey: true, altKey: true })
    await expectRefused(
        page,
        'Save',
        'Ctrl+Alt+K types characters on many keyboards. Press another key.',
    )
    expect(await savedShortcut(page, 'save')).toBe('Mod+h')

    // So does Ctrl+Alt+digit.
    await save.dispatchEvent('keydown', { key: '1', ctrlKey: true, altKey: true })
    await expectRefused(
        page,
        'Save',
        'Ctrl+Alt+1 types characters on many keyboards. Press another key.',
    )
    expect(await savedShortcut(page, 'save')).toBe('Mod+h')
})

test('shortcut capture waits past IME and dead keys and ignores Caps Lock', async ({ page }) => {
    const save = shortcutButton(page, 'Save')
    await save.click()
    for (const key of ['Process', 'Dead', 'Unidentified'])
        await save.dispatchEvent('keydown', { key, cancelable: true })
    // Chrome's first IME keydown can carry a plain key with keyCode 229.
    await save.evaluate((button) => {
        const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
        Object.defineProperty(event, 'keyCode', { get: () => 229 })
        button.dispatchEvent(event)
    })
    await expect(save).toHaveText('Press a key or click again to clear')
    expect(await savedShortcut(page, 'save')).toBe('p')

    // Caps Lock reports an uppercase letter without Shift.
    await save.dispatchEvent('keydown', { key: 'A', cancelable: true })
    await expect(save).toHaveText('A')
    expect(await savedShortcut(page, 'save')).toBe('a')
    await save.click()
    await save.dispatchEvent('keydown', { key: 'a', shiftKey: true, cancelable: true })
    await expect(save).toHaveText('Shift+A')
    expect(await savedShortcut(page, 'save')).toBe('A')
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
        await expectRefused(
            page,
            'Save',
            '⌘H is reserved by the browser or system. Press another key.',
        )
        await page.keyboard.press('Meta+Shift+KeyS')
        await expect(save).toHaveText('⇧⌘S')
        expect(await savedShortcut(page, 'save')).toBe('Mod+Shift+s')
    })
})

test('visibility toggles list kinds in the tools’ order everywhere', async ({ page }) => {
    const kinds = ['Note', 'BPM', 'Time Scale', 'Camera Event', 'Stage Mask Event']
    // The keyboard shortcut list.
    const names = await page
        .getByRole('dialog')
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Keyboard Shortcuts' }) })
        .locator('.form-field-text')
        .allInnerTexts()
    const toggles = names.flatMap((name) => /^Toggle (.*) Visibility$/.exec(name.trim())?.[1] ?? [])
    expect(toggles.slice(0, kinds.length)).toEqual(kinds)

    const result = await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        const { settings, view, history, fixtures } = window.editorTest
        const chart = structuredClone(fixtures.notes)
        chart.isDynamicStages = true
        history.resetState(false, chart, 0, 'visibility.json')
        // The default toolbar's flyout, read upward from its button.
        const group = settings.toolbar.find((names) => names.includes('cycleVisibilities')) ?? []
        // Each cycle shows one kind alone, in order.
        const cycle: string[] = []
        for (let step = 0; step < 4; step++) {
            commands.cycleVisibilities.execute()
            cycle.push(
                Object.entries(view.visibilities)
                    .filter(([, shown]) => shown)
                    .map(([type]) => type)
                    .filter((type) => type !== 'connector' && !type.endsWith('Connection'))
                    .join(),
            )
        }
        return { group: [...group].reverse(), cycle }
    })
    expect(result.group.slice(0, 6)).toEqual([
        'cycleVisibilities',
        'noteVisibility',
        'bpmVisibility',
        'timeScaleVisibility',
        'cameraEventVisibility',
        'stageMaskEventVisibility',
    ])
    expect(result.cycle).toEqual(['note', 'bpm', 'timeScale', 'cameraEventJoint'])
})

for (const locale of ['fr', 'tr', 'en']) {
    test(`${locale} settings values go below their label rather than truncate on a phone`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        await page.evaluate(
            (locale) => (window.editorTest.settings.locale = locale as never),
            locale,
        )
        const dialog = page.getByRole('dialog')
        await expect
            .poll(() =>
                dialog.locator('.form-field').evaluateAll((fields) => {
                    const context = document.createElement('canvas').getContext('2d')!
                    return fields.flatMap((field) => {
                        const select = field.querySelector('select')
                        if (!select?.getClientRects().length) return []
                        const style = getComputedStyle(select)
                        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
                        const text = select.selectedOptions[0]?.textContent.trim() ?? ''
                        const room =
                            select.clientWidth -
                            parseFloat(style.paddingLeft) -
                            parseFloat(style.paddingRight)
                        return context.measureText(text).width > room + 0.5 ? [text] : []
                    })
                }),
            )
            .toEqual([])
        // Short values keep their place beside the label.
        const stacked = await dialog
            .locator('.form-field.form-field-value-stacked')
            .evaluateAll((fields) => fields.length)
        expect(stacked).toBeGreaterThan(0)
        expect(stacked).toBeLessThan(6)
    })
}

for (const locale of ['en', 'fr', 'ja', 'tr']) {
    test(`${locale} the capture prompt shows in full on a phone`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 })
        await page.evaluate(
            (locale) => (window.editorTest.settings.locale = locale as never),
            locale,
        )
        const save = page
            .getByRole('dialog')
            .locator('.form-field')
            .filter({ has: page.locator('[data-icon-column]') })
            .first()
            .getByRole('button')
        await save.scrollIntoViewIfNeeded()
        await save.click()
        await expect
            .poll(() =>
                save.evaluate(
                    (button) =>
                        button.scrollWidth <= button.clientWidth &&
                        button.scrollHeight <= button.clientHeight,
                ),
            )
            .toBe(true)
        // It returns beside its name once capture ends.
        await page.keyboard.press('Escape')
    })
}
