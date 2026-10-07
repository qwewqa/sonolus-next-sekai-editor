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

    test('with page text selected, Ctrl+C and Ctrl+X leave selected objects alone', async ({
        page,
    }) => {
        const notes = await page.evaluate(() => {
            const { history, store } = window.editorTest
            // Firefox grants no clipboard permissions to tests, so writes are recorded instead.
            Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: async (text: string) => {
                    document.body.dataset.written = text
                },
            })
            const notes = [...store.getAllEntities()].filter((entity) => entity.type === 'note')
            history.replaceState({ ...history.state.value, selectedEntities: notes })
            const text = document.body.appendChild(document.createElement('p'))
            text.textContent = 'Note Speed'
            getSelection()?.selectAllChildren(text)
            document.addEventListener('copy', () => (text.dataset.copied = String(getSelection())))
            document.addEventListener('cut', () => (text.dataset.cut = 'true'))
            return notes.length
        })
        expect(notes).toBeGreaterThan(0)
        const count = () =>
            page.evaluate(
                () =>
                    [...window.editorTest.store.getAllEntities()].filter(
                        (entity) => entity.type === 'note',
                    ).length,
            )

        await page.keyboard.press('Control+c')
        await expect(page.locator('p[data-copied]')).toHaveAttribute('data-copied', 'Note Speed')
        await page.keyboard.press('Control+x')
        await expect(page.locator('p[data-cut]')).toHaveCount(1)
        await page.waitForTimeout(100)
        expect(await page.evaluate(() => document.body.dataset.written)).toBeUndefined()
        expect(await count()).toBe(notes)
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

    test('a new object selection drops selected page text, so Ctrl+C copies the objects', async ({
        page,
    }) => {
        await page.evaluate(() => {
            // Firefox grants no clipboard permissions to tests, so the write is recorded instead.
            Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: async (text: string) => {
                    document.body.dataset.copied = text
                },
            })
            const text = document.body.appendChild(document.createElement('p'))
            text.id = 'text'
            text.textContent = 'Note Speed'
            document.addEventListener('copy', () => (text.dataset.copied = String(getSelection())))
            getSelection()?.selectAllChildren(text)
        })
        // As a properties chip or the manager's Select Objects does.
        const selectNotes = () =>
            page.evaluate(async () => {
                const { history, store, nextTick } = window.editorTest
                history.replaceState({
                    ...history.state.value,
                    selectedEntities: [...store.getAllEntities()].filter(
                        (entity) => entity.type === 'note',
                    ),
                })
                await nextTick()
            })
        await selectNotes()
        expect(await page.evaluate(() => getSelection()?.isCollapsed)).toBe(true)
        await page.keyboard.press('Control+c')
        await expect
            .poll(() => page.evaluate(() => document.body.dataset.copied))
            .toContain('"entities"')

        // Text selected afterwards keeps its native copy.
        await page.evaluate(() => {
            delete document.body.dataset.copied
            getSelection()?.selectAllChildren(document.getElementById('text')!)
        })
        await page.keyboard.press('Control+c')
        await expect(page.locator('#text')).toHaveAttribute('data-copied', 'Note Speed')
        await page.waitForTimeout(100)
        expect(await page.evaluate(() => document.body.dataset.copied)).toBeUndefined()

        // A field keeps its own selection.
        await page.evaluate(() => {
            const input = document.body.appendChild(document.createElement('input'))
            input.value = 'Lead'
            input.focus()
            input.select()
        })
        await selectNotes()
        expect(
            await page.evaluate(() => {
                const input = document.activeElement as HTMLInputElement
                return [input.selectionStart, input.selectionEnd]
            }),
        ).toEqual([0, 4])
    })

    test('a page selection without text leaves Ctrl+C to copy the objects', async ({ page }) => {
        const range = await page.evaluate(() => {
            const { history, store } = window.editorTest
            // Firefox grants no clipboard permissions to tests, so the write is recorded instead.
            Object.defineProperty(navigator.clipboard, 'writeText', {
                configurable: true,
                value: async (text: string) => {
                    document.body.dataset.copied = text
                },
            })
            const notes = [...store.getAllEntities()].filter((entity) => entity.type === 'note')
            history.replaceState({ ...history.state.value, selectedEntities: notes })
            const container = document.body.appendChild(document.createElement('p'))
            container.appendChild(document.createElement('span'))
            const range = document.createRange()
            range.setStart(container, 0)
            range.setEnd(container, 1)
            getSelection()?.removeAllRanges()
            getSelection()?.addRange(range)
            return { collapsed: getSelection()?.isCollapsed, text: String(getSelection()) }
        })
        expect(range).toEqual({ collapsed: false, text: '' })
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

    test('Space and Enter on a focused button press only the button', async ({ page }) => {
        const isPlaying = () =>
            page.evaluate(
                async () =>
                    (
                        await window.editorTest.appImport<typeof import('../../src/player')>(
                            '/src/player.ts',
                        )
                    ).isPlaying.value,
            )
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.keyboardShortcuts = { ...settings.keyboardShortcuts, help: 'Enter' }
            settings.toolbar = [
                ['undo'],
                ...settings.toolbar.map((group) => group.filter((name) => name !== 'undo')),
            ]
        })
        await edit(page)
        const undo = page.locator('[data-editor-toolbar] button[title="Undo"]')
        await undo.focus()
        await page.keyboard.press('Space')
        expect(await isEdited(page)).toBe(false)
        expect(await isPlaying()).toBe(false)

        await edit(page)
        await undo.focus()
        await page.keyboard.press('Enter')
        expect(await isEdited(page)).toBe(false)
        await expect(page.getByRole('dialog')).toHaveCount(0)

        // Other keys still run their shortcuts.
        await setTool(page, 'select')
        await page.keyboard.press('s')
        expect(await toolName(page)).toBe('slide')
    })
})

test.describe('tool dialogs', () => {
    const dialog = (page: Page) => page.locator('.editor-tool-modal')
    const division = (page: Page) => page.evaluate(() => window.editorTest.view.division)
    const selected = (page: Page) =>
        page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)

    test.beforeEach(async ({ page }) => {
        await page.evaluate(() => {
            window.editorTest.settings.propertiesPosition = 'disabled'
        })
        await setTool(page, 'note')
        await edit(page)
        await page.keyboard.press('a')
        await expect(dialog(page)).toBeFocused()
    })

    test('shortcuts run from the chart and the dialog, but not its fields', async ({ page }) => {
        // Focused as it opens, the dialog passes keys on.
        await page.keyboard.press('z')
        expect(await isEdited(page)).toBe(false)
        await page.keyboard.press('Control+y')
        expect(await isEdited(page)).toBe(true)

        // Fields keep their keys.
        const before = await division(page)
        const field = dialog(page).locator('input[type="number"]').first()
        await field.fill('')
        await field.press('3')
        await expect(field).toHaveValue('3')
        expect(await division(page)).toBe(before)

        // Other controls pass keys on, except those that press them.
        await logDefaults(page)
        const select = dialog(page).locator('select').first()
        await select.focus()
        await page.keyboard.press('Control+z')
        expect(await isEdited(page)).toBe(false)
        // The chord's browser action stays out.
        expect(await lastDefault(page)).toBe(true)
        const toggle = dialog(page).locator('input[type="button"]').first()
        await toggle.focus()
        await page.keyboard.press('Control+y')
        expect(await isEdited(page)).toBe(true)
        expect(await lastDefault(page)).toBe(true)
        await page.keyboard.press('z')
        expect(await isEdited(page)).toBe(false)
        await page.keyboard.press('Control+y')
        expect(await isEdited(page)).toBe(true)
        const shown = await toggle.inputValue()
        await page.keyboard.press('Space')
        await expect(toggle).not.toHaveValue(shown)
        expect(
            await page.evaluate(
                async () =>
                    (
                        await window.editorTest.appImport<typeof import('../../src/player')>(
                            '/src/player.ts',
                        )
                    ).isPlaying.value,
            ),
        ).toBe(false)

        // A click on the chart leaves the dialog open and gives the keys back.
        await page.mouse.click(300, 200)
        await expect(dialog(page)).toBeVisible()
        await page.keyboard.press('z')
        expect(await isEdited(page)).toBe(false)

        // Escape closes the dialog rather than deselecting.
        const count = await selected(page)
        await page.keyboard.press('Escape')
        await expect(dialog(page)).toHaveCount(0)
        expect(await selected(page)).toBe(count)
    })

    test('undo by shortcut leaves no stale dialog preview', async ({ page }) => {
        await page.keyboard.press('Escape')
        await page.evaluate(async () => {
            const { editSelectionProperties } = await window.editorTest.appImport<
                typeof import('../../src/editor/editSelectionProperties')
            >('/src/editor/editSelectionProperties.ts')
            editSelectionProperties()
        })
        const size = dialog(page)
            .locator('label')
            .filter({ has: page.getByText('Size', { exact: true }) })
            .locator('input')
        await size.fill('5')
        const preview = () =>
            page.evaluate(async () => {
                const { previewEdit } =
                    await window.editorTest.appImport<typeof import('../../src/preview/edit')>(
                        '/src/preview/edit.ts',
                    )
                return !!previewEdit.value
            })
        expect(await preview()).toBe(true)
        // Leaving the field commits it; undo then takes that edit back, preview and all.
        await page.mouse.click(300, 200)
        await page.keyboard.press('z')
        expect(await isEdited(page)).toBe(true)
        expect(await preview()).toBe(false)
        await expect(size).not.toHaveValue('5')
    })

    test('switching tools closes the dialog; Settings still holds every key', async ({ page }) => {
        await page.keyboard.press('f')
        expect(await toolName(page)).toBe('select')
        await expect(dialog(page)).toHaveCount(0)

        await page.keyboard.press(',')
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.keyboard.press('z')
        expect(await isEdited(page)).toBe(true)
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
        await logDefaults(page)
        await page.keyboard.press('Control+z')
        expect(await isEdited(page)).toBe(false)
        // The chord's browser action stays out.
        expect(await lastDefault(page)).toBe(true)
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
        await logDefaults(page)
        await page.keyboard.press('Control+s')
        expect(await toolName(page)).toBe('slide')
        // Ctrl+S doesn't also save the page.
        expect(await lastDefault(page)).toBe(true)
        await page.keyboard.press('Control+Shift+B')
        expect(await toolName(page)).toBe('bpm')
        expect(await lastDefault(page)).toBe(true)
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

    /** Reloads with a saved record built from the defaults; null leaves a command out. */
    const loadSaved = async (page: Page, changes: Record<string, string | null>) => {
        await page.evaluate((changes) => {
            const record: Record<string, string> = {
                ...window.editorTest.settings.keyboardShortcuts,
            }
            for (const [name, key] of Object.entries(changes))
                if (key === null) Reflect.deleteProperty(record, name)
                else record[name] = key
            localStorage.setItem(
                'sonolus-next-sekai-editor.keyboardShortcuts',
                JSON.stringify(record),
            )
        }, changes)
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        return page.evaluate(() => window.editorTest.settings.keyboardShortcuts)
    }

    test('a record saved before a command existed gains its default', async ({ page }) => {
        const loaded = await loadSaved(page, { deleteSelection: null, undo: 'l' })
        expect(loaded.deleteSelection).toBe('Delete')
        expect(loaded.undo).toBe('l')
    })

    test("a new command's default never takes a key the user gave another", async ({ page }) => {
        const loaded = await loadSaved(page, { deleteSelection: null, stop: 'Delete' })
        expect(loaded.deleteSelection).toBe('')
        expect(loaded.stop).toBe('Delete')
    })

    test('an unbound command stays unbound', async ({ page }) => {
        // Unbinding is saved as ''; records saved by 757e7e9 left the command out.
        const loaded = await loadSaved(page, { deleteSelection: '', save: null, undo: 'l' })
        expect(loaded.deleteSelection).toBe('')
        expect(loaded.save).toBeUndefined()
    })

    test('unbinding a command in Settings outlasts a reload', async ({ page }) => {
        await page.keyboard.press(',')
        const button = page
            .getByRole('dialog')
            .locator('label')
            .filter({ has: page.getByText('Delete', { exact: true }) })
            .getByRole('button')
        await button.click()
        await button.click()
        await expect(button).toHaveText('Unassigned')
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        expect(
            await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.deleteSelection),
        ).toBe('')
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

test('held toggle keys act once while held movement keys repeat', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { view, appImport, settings, nextTick } = window.editorTest
        // Pressing a tool's key again with the sidebar shown cycles its presets.
        settings.showSidebar = true
        await nextTick()
        const { isPlaying } = await appImport<typeof import('../../src/player')>('/src/player.ts')
        const { defaultNotePropertiesPresetIndex } = await appImport<
            typeof import('../../src/editor/tools/note')
        >('/src/editor/tools/note/index.ts')
        const hold = (key: string) => {
            for (const repeat of [false, true, true, true])
                dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true }))
        }
        hold(' ')
        const playing = isPlaying.value
        dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
        const snapping = view.snapping
        hold('i')
        hold('a')
        const { commands } = await appImport<typeof import('../../src/editor/commands')>(
            '/src/editor/commands/index.ts',
        )
        let scrolls = 0
        const scroll = commands.scrollUp.execute
        commands.scrollUp.execute = () => {
            scrolls++
        }
        hold('ArrowUp')
        commands.scrollUp.execute = scroll
        return {
            playing,
            stopped: !isPlaying.value,
            snapped: view.snapping !== snapping,
            preset: defaultNotePropertiesPresetIndex.value,
            scrolls,
        }
    })
    expect(result).toEqual({
        playing: true,
        stopped: true,
        snapped: true,
        preset: 0,
        scrolls: 4,
    })
})
