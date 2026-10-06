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

    test('Ctrl+C keeps copying selected page text', async ({ page }) => {
        await page.evaluate(() => {
            const text = document.body.appendChild(document.createElement('p'))
            text.textContent = 'Note Speed'
            getSelection()?.selectAllChildren(text)
            // The browser fires copy only when the key's default action runs.
            document.addEventListener('copy', () => {
                text.dataset.copied = String(getSelection())
            })
        })
        await page.keyboard.press('Control+c')
        await expect(page.locator('p[data-copied]')).toHaveAttribute('data-copied', 'Note Speed')

        // Other editing chords still keep the browser's action out.
        await logDefaults(page)
        await page.keyboard.press('Control+z')
        expect(await lastDefault(page)).toBe(true)
    })

    test('pressing the chart drops selected page text, so Ctrl+C copies the objects', async ({
        page,
    }) => {
        await setTool(page, 'select')
        const at = await page.evaluate(() => {
            const { history, store, point } = window.editorTest
            // Firefox grants no clipboard permissions to tests, so the write is recorded instead.
            Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: async (text: string) => {
                    document.body.dataset.copied = text
                },
            })
            history.replaceState({ ...history.state.value, selectedEntities: [] })
            const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
            const text = document.body.appendChild(document.createElement('p'))
            text.textContent = 'Note Speed'
            getSelection()?.selectAllChildren(text)
            return point(note.hitbox!.lane, note.beat)
        })
        await page.mouse.click(at.x, at.y)
        expect(
            await page.evaluate(() => ({
                collapsed: getSelection()?.isCollapsed,
                selected: window.editorTest.history.state.value.selectedEntities.length,
            })),
        ).toEqual({ collapsed: true, selected: 1 })
        await page.keyboard.press('Control+c')
        await expect
            .poll(() => page.evaluate(() => document.body.dataset.copied))
            .toContain('"entities"')
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
    ] as const) {
        test(`${chord} runs the ${tool} tool's plain key and keeps the browser's action out`, async ({
            page,
        }) => {
            await logDefaults(page)
            await setTool(page, 'select')
            await page.keyboard.press(chord)
            expect(await toolName(page)).toBe(tool)
            expect(await lastDefault(page)).toBe(true)
        })
    }

    test('Ctrl+Shift+A matches no plain a and keeps the browser default', async ({ page }) => {
        await logDefaults(page)
        await setTool(page, 'select')
        await page.keyboard.press('Control+Shift+A')
        expect(await toolName(page)).toBe('select')
        expect(await lastDefault(page)).toBe(false)
    })

    test('a chord binding wins over the plain key it shares', async ({ page }) => {
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = {
                ...settings.keyboardShortcuts,
                bpm: 'Mod+s',
                timeScale: 'Alt+s',
                eraser: 'Shift+ArrowUp',
            }
        })
        await logDefaults(page)
        await setTool(page, 'select')
        for (const [chord, tool, prevented] of [
            ['Control+s', 'bpm', true],
            ['Meta+s', 'bpm', true],
            ['s', 'slide', true],
            ['Alt+s', 'timeScale', true],
            // Shift makes the key S, which nothing is bound to.
            ['Control+Shift+S', 'timeScale', false],
        ] as const) {
            await page.keyboard.press(chord)
            expect(await toolName(page), chord).toBe(tool)
            expect(await lastDefault(page), chord).toBe(prevented)
        }

        await page.keyboard.press('Shift+ArrowUp')
        expect(await toolName(page)).toBe('eraser')
        expect(await lastDefault(page)).toBe(true)
    })

    test('Alt, AltGr and named keys with Ctrl keep running their bindings', async ({ page }) => {
        await logDefaults(page)
        await setTool(page, 'select')
        await page.keyboard.press('Alt+a')
        expect(await toolName(page)).toBe('note')
        // Alt keeps the browser's action.
        expect(await lastDefault(page)).toBe(false)

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
        expect(await lastDefault(page)).toBe(false)
    })

    test('Ctrl or Cmd with zoom, tab and navigation keys runs bindings and keeps the browser action', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = { ...settings.keyboardShortcuts, brush: 'Mod+]' }
        })
        await logDefaults(page)
        const width = await page.evaluate(() => window.editorTest.settings.width)
        // Zoom In Y is =; the browser still zooms.
        const pps = () => page.evaluate(() => window.editorTest.settings.pps)
        const before = await pps()
        await page.keyboard.press('Control+Equal')
        expect(await pps()).not.toBe(before)
        expect(await lastDefault(page)).toBe(false)

        // Division 1/1 is 1; the browser still switches tabs.
        expect(await page.evaluate(() => window.editorTest.view.division)).not.toBe(1)
        await page.keyboard.press('Control+1')
        expect(await page.evaluate(() => window.editorTest.view.division)).toBe(1)
        expect(await lastDefault(page)).toBe(false)

        // Zoom Out X is [; Cmd+[ still goes back on macOS.
        await page.keyboard.press('Meta+BracketLeft')
        expect(await page.evaluate(() => window.editorTest.settings.width)).not.toBe(width)
        expect(await lastDefault(page)).toBe(false)

        // An exact chord on a symbol runs and keeps the browser action too.
        await setTool(page, 'select')
        await page.keyboard.press('Control+BracketRight')
        expect(await toolName(page)).toBe('brush')
        expect(await lastDefault(page)).toBe(false)

        // Letters keep it out.
        await page.keyboard.press('Control+s')
        expect(await toolName(page)).toBe('slide')
        expect(await lastDefault(page)).toBe(true)
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
        await setTool(page, 'select')
        await page.keyboard.press('Control+s')
        expect(await toolName(page)).toBe('select')
    })

    test('a toggle passes Ctrl chords for any binding but keeps plain keys', async ({ page }) => {
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = { ...settings.keyboardShortcuts, bpm: 'Mod+Shift+b' }
        })
        await setTool(page, 'select')
        await control(page, 'Critical').focus()
        await page.keyboard.press('s')
        expect(await toolName(page)).toBe('select')
        await page.keyboard.press('Control+s')
        expect(await toolName(page)).toBe('slide')
        await page.keyboard.press('Control+Shift+B')
        expect(await toolName(page)).toBe('bpm')
        await expect(control(page, 'Critical')).toBeFocused()
    })
})

test.describe('saved shortcuts', () => {
    test('a record saved before chords loads and runs unchanged', async ({ page }) => {
        // As 757e7e9 wrote it: the whole record once any binding changed.
        const saved = await page.evaluate(() => {
            const record = { ...window.editorTest.settings.keyboardShortcuts, undo: 'l', bpm: 'U' }
            localStorage.setItem(
                'sonolus-next-sekai-editor.keyboardShortcuts',
                JSON.stringify(record),
            )
            return record
        })
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.mouse.click(700, 400)
        expect(await page.evaluate(() => window.editorTest.settings.keyboardShortcuts)).toEqual(
            saved,
        )

        await edit(page)
        await page.keyboard.press('Control+l')
        expect(await isEdited(page)).toBe(false)
        await setTool(page, 'select')
        await page.keyboard.press('Shift+U')
        expect(await toolName(page)).toBe('bpm')
        expect(
            JSON.parse(
                (await page.evaluate(() =>
                    localStorage.getItem('sonolus-next-sekai-editor.keyboardShortcuts'),
                )) ?? '{}',
            ),
        ).toEqual(saved)
    })

    test('a chord binding persists and Reset Shortcuts removes it', async ({ page }) => {
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = { ...settings.keyboardShortcuts, bpm: 'Mod+Shift+b' }
        })
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.mouse.click(700, 400)
        await setTool(page, 'select')
        await page.keyboard.press('Control+Shift+B')
        expect(await toolName(page)).toBe('bpm')

        await page.keyboard.press(',')
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Reset Shortcuts', exact: true })
            .click()
        expect(
            await page.evaluate(() =>
                localStorage.getItem('sonolus-next-sekai-editor.keyboardShortcuts'),
            ),
        ).toBeNull()
        expect(await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.bpm)).toBe(
            'q',
        )
    })
})
