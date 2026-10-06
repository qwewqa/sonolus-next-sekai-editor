import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.mouse.click(700, 400)
})

const toolName = (page: Page) =>
    page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        return toolName.value
    })

const setTool = (page: Page, name: string) =>
    page.evaluate(async (name) => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        toolName.value = name as never
    }, name)

/** Makes every note critical in one undoable edit. */
const edit = (page: Page) =>
    page.evaluate(async () => {
        const { history, store, appImport } = window.editorTest
        const { editSelectedEditableEntities } = await appImport<
            typeof import('../../src/editor/sidebars/default')
        >('/src/editor/sidebars/default/index.ts')
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
        })
        editSelectedEditableEntities({ isCritical: true })
    })

const isEdited = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()].some(
            (e) => e.type === 'note' && e.isCritical,
        ),
    )

// Listens after the editor's window listener, so it sees the final state.
const logDefaults = (page: Page) =>
    page.evaluate(() => {
        const log: boolean[] = []
        ;(window as unknown as { keyLog: boolean[] }).keyLog = log
        addEventListener('keydown', (event) => {
            if (!['Control', 'Meta', 'Shift', 'Alt'].includes(event.key))
                log.push(event.defaultPrevented)
        })
    })
const lastDefault = (page: Page) =>
    page.evaluate(() => (window as unknown as { keyLog: boolean[] }).keyLog.at(-1))

test.describe('chords', () => {
    for (const chord of ['Control+z', 'Meta+z']) {
        test(`${chord} undoes and keeps the browser's own undo out`, async ({ page }) => {
            await logDefaults(page)
            await edit(page)
            await page.keyboard.press(chord)
            expect(await isEdited(page)).toBe(false)
            expect(await lastDefault(page)).toBe(true)
        })
    }

    test('Ctrl+C keeps copying selected page text', async ({ context, page }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.evaluate(async () => {
            await navigator.clipboard.writeText('before')
            const text = document.body.appendChild(document.createElement('p'))
            text.textContent = 'Note Speed'
            getSelection()?.selectAllChildren(text)
        })
        await page.keyboard.press('Control+c')
        await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe('Note Speed')
    })

    test('a rebound undo key undoes with Ctrl too', async ({ page }) => {
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = { ...settings.keyboardShortcuts, undo: 'l' }
        })
        await edit(page)
        await page.keyboard.press('Control+l')
        expect(await isEdited(page)).toBe(false)
    })

    for (const [chord, tool] of [
        ['Control+s', 'slide'],
        ['Meta+b', 'brush'],
        ['Control+Shift+A', 'note'],
    ] as const) {
        test(`${chord} leaves the ${tool} tool to its plain key and keeps the browser default`, async ({
            page,
        }) => {
            await logDefaults(page)
            await setTool(page, 'select')
            await page.keyboard.press(chord)
            expect(await toolName(page)).toBe('select')
            expect(await lastDefault(page)).toBe(false)
        })
    }

    test('Alt, AltGr and named keys with Ctrl keep running their bindings', async ({ page }) => {
        await setTool(page, 'select')
        await page.keyboard.press('Alt+a')
        expect(await toolName(page)).toBe('note')

        // AltGr arrives as Ctrl+Alt; [ zooms out horizontally.
        const width = () => page.evaluate(() => window.editorTest.settings.width)
        const before = await width()
        await page.evaluate(() =>
            dispatchEvent(new KeyboardEvent('keydown', { key: '[', ctrlKey: true, altKey: true })),
        )
        expect(await width()).not.toBe(before)

        const time = () => page.evaluate(() => window.editorTest.view.time)
        const start = await time()
        await page.keyboard.press('Control+ArrowUp')
        await expect.poll(time).not.toBe(start)
    })
})

test.describe('dock', () => {
    test.beforeEach(async ({ page }) => {
        await page.evaluate(async () => {
            const { settings, history, store, nextTick } = window.editorTest
            settings.showSidebar = true
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
            })
            await nextTick()
        })
    })

    const control = (page: Page, label: string) =>
        page
            .locator('#properties-section-selection label')
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator('input, select')

    test('undo works right after a toggle in the panel', async ({ page }) => {
        await control(page, 'Critical').click()
        await expect(control(page, 'Critical')).toBeFocused()
        expect(await isEdited(page)).toBe(true)
        await page.keyboard.press('Control+z')
        expect(await isEdited(page)).toBe(false)
        await page.keyboard.press('Control+y')
        expect(await isEdited(page)).toBe(true)
    })

    test('a focused select passes Ctrl+Z but keeps its plain keys', async ({ page }) => {
        await edit(page)
        await setTool(page, 'select')
        await control(page, 'Note Type').focus()
        // No option starts with q, so type-ahead changes nothing here.
        await page.keyboard.press('q')
        expect(await toolName(page)).toBe('select')
        await page.keyboard.press('Control+z')
        expect(await isEdited(page)).toBe(false)
    })

    test('a number field keeps Ctrl+Z for its own text', async ({ page }) => {
        await edit(page)
        const size = control(page, 'Size')
        await size.click()
        await page.keyboard.type('3')
        await page.keyboard.press('Control+z')
        expect(await isEdited(page)).toBe(true)
    })
})
