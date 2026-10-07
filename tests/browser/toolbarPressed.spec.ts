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

// The division and lane groups show their values in use.
const values = ['1/4 Division', '1/1 Lane Division', 'No Lane Limit']

const run = (page: Page, name: string) =>
    page.evaluate(async (name) => {
        const { commands } = await import('/src/editor/commands/index.ts')
        await commands[name as keyof typeof commands].execute()
        await window.editorTest.nextTick()
    }, name)

test('the toolbar shows the tool in use as pressed', async ({ page }) => {
    await expect.poll(() => pressedTitles(page)).toEqual(['Select', ...values])
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
    await expect.poll(() => pressedTitles(page)).toEqual(['Eraser', ...values])
    await expect(shown(page).and(page.getByTitle('Select', { exact: true }))).toHaveCount(0)
    await page.keyboard.press('f')
    await expect.poll(() => pressedTitles(page)).toEqual(['Select', ...values])

    // The elevation editor is a mode beside the tool.
    await run(page, 'elevation')
    await expect
        .poll(() => pressedTitles(page))
        .toEqual(expect.arrayContaining(['Elevation Editor']))
    await run(page, 'elevation')
    await expect.poll(() => pressedTitles(page)).toEqual(['Select', ...values])
})

test('note presets are pressed only for the preset in use', async ({ page }) => {
    await run(page, 'note2')
    await expect.poll(() => pressedTitles(page)).toEqual(['Note', ...values])

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
    // A disclosure, not a menu: the flyout holds plain buttons.
    await expect(group).not.toHaveAttribute('aria-haspopup')
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

test('flyout hints show named keys readably and punctuation as large as letters', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['speedUp', 'scrollLeft', 'stop', 'select']]
    })
    await shown(page)
        .and(page.getByTitle('Select', { exact: true }))
        .hover()
    const hint = (title: string) =>
        toolbar(page).getByTitle(title, { exact: true }).locator('span').last()
    await expect(hint('Scroll Left')).toHaveText('←')
    await expect(hint('Stop')).toHaveText('Backspace')
    const style = (title: string) =>
        hint(title).evaluate((element) => {
            const { fontSize, fontWeight } = getComputedStyle(element)
            return { size: parseFloat(fontSize), weight: Number(fontWeight) }
        })
    const letter = await style('Select')
    const punctuation = await style('Increase Playback Speed')
    expect(punctuation.size).toBeGreaterThan(letter.size)
    expect(punctuation.weight).toBeGreaterThanOrEqual(700)
})

test('Escape on a tool dialog returns focus to the tool that opened it, or to the chart', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.propertiesPosition = 'disabled'
        settings.toolbar = [['select'], ['brush']]
    })
    // In use already, so running it again opens its dialog.
    await page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        toolName.value = 'brush'
    })
    const dialog = page.locator('.editor-tool-modal')
    const brush = shown(page).and(page.getByTitle('Brush', { exact: true }))
    await brush.focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(shown(page).and(page.getByTitle('Brush', { exact: true }))).toBeFocused()

    // Opened from the chart, it returns there.
    await page.mouse.click(700, 300)
    await page.keyboard.press('b')
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(
        await page.evaluate(
            () =>
                document.activeElement?.getAttribute('tabindex') === '-1' &&
                !!document.activeElement.querySelector('canvas.editor-chart') &&
                !document.activeElement.querySelector('[data-workspace-dock]'),
        ),
    ).toBe(true)
})

test('a tool dialog closed by its button or a tool switch returns focus it held', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.propertiesPosition = 'disabled'
        settings.toolbar = [['select'], ['brush']]
    })
    const setTool = (name: string) =>
        page.evaluate(async (name) => {
            const { toolName } = await window.editorTest.appImport<
                typeof import('../../src/editor/tools/state')
            >('/src/editor/tools/state.ts')
            toolName.value = name as never
        }, name)
    await setTool('brush')
    const dialog = page.locator('.editor-tool-modal')
    const brush = shown(page).and(page.getByTitle('Brush', { exact: true }))
    const open = async () => {
        await setTool('brush')
        await brush.focus()
        await page.keyboard.press('Enter')
        await expect(dialog).toBeVisible()
    }

    // The close button.
    await open()
    await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(brush).toBeFocused()

    // A tool switch while the dialog holds focus.
    await open()
    await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
    await setTool('select')
    await expect(dialog).toHaveCount(0)
    await expect(brush).toBeFocused()

    // Focus the user moved elsewhere stays there.
    await open()
    await page.evaluate(() => {
        const input = document.body.appendChild(document.createElement('input'))
        input.id = 'elsewhere'
        input.focus()
    })
    await setTool('select')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#elsewhere')).toBeFocused()
})

test('Escape in a tool dialog field reverts an uncommitted edit, else closes the dialog', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { settings, appImport } = window.editorTest
        settings.propertiesPosition = 'disabled'
        const { toolName } = await appImport<typeof import('../../src/editor/tools/state')>(
            '/src/editor/tools/state.ts',
        )
        toolName.value = 'bpm'
    })
    const dialog = page.locator('.editor-tool-modal')
    const field = dialog
        .locator('label')
        .filter({ has: page.getByText('BPM', { exact: true }) })
        .locator('input')
    const bpms = () =>
        page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
                entity.type === 'bpm' && entity.beat === 2 ? [entity.bpm] : [],
            ),
        )
    const point = await page.evaluate(() => window.editorTest.point(0, 2))
    await page.mouse.click(point.x, point.y)
    await expect(dialog).toBeVisible()
    const initial = await bpms()
    expect(initial).toHaveLength(1)

    // Uncommitted typing: Escape reverts it and keeps the dialog.
    await field.fill('200')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(field).toHaveValue(`${initial[0]}`)
    expect(await bpms()).toEqual(initial)

    // Committed: Escape closes the dialog and returns focus to the chart.
    await field.fill('200')
    await page.keyboard.press('Enter')
    expect(await bpms()).toEqual([200])
    await expect(field).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await bpms()).toEqual([200])
    expect(
        await page.evaluate(
            () =>
                document.activeElement?.getAttribute('tabindex') === '-1' &&
                !!document.activeElement.querySelector('canvas.editor-chart'),
        ),
    ).toBe(true)
})

test('Escape in a tool setting field reverts typing first, then closes the dialog', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { settings, appImport } = window.editorTest
        settings.propertiesPosition = 'disabled'
        const { toolName } = await appImport<typeof import('../../src/editor/tools/state')>(
            '/src/editor/tools/state.ts',
        )
        toolName.value = 'note'
    })
    await page.mouse.click(700, 300)
    await page.keyboard.press('a')
    const dialog = page.locator('.editor-tool-modal')
    await expect(dialog).toBeVisible()
    const field = dialog
        .locator('label')
        .filter({ has: page.getByText('Guide Alpha', { exact: true }) })
        .locator('input')
    await field.fill('0.5')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('division and lane groups show the value in use on their face', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [
            ['divisionCustom', 'division8', 'division4', 'division1'],
            ['laneDivisionCustom', 'laneDivision2', 'laneDivision1'],
            ['laneLimitCustom', 'laneLimitSix', 'laneLimitNone'],
            ['redo', 'undo'],
        ]
    })
    const face = (index: number) => shown(page).nth(index)
    const expectFace = async (index: number, title: string, text?: string) => {
        await expect(face(index)).toHaveAttribute('title', title)
        await expect(face(index)).toHaveAttribute('aria-pressed', 'true')
        if (text) await expect(face(index)).toHaveText(text)
    }
    await expectFace(0, '1/4 Division', '1/4')
    await expectFace(1, '1/1 Lane Division')
    await expectFace(2, 'No Lane Limit')

    // A shortcut switches the division, and the face follows.
    await page.keyboard.press('8')
    await expectFace(0, '1/8 Division', '1/8')

    // A custom division shows its value on the custom button.
    await page.keyboard.press('`')
    await page.getByRole('spinbutton', { name: 'Division', exact: true }).fill('7')
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expectFace(0, 'Custom Division', '1/7')
    await face(0).hover()
    const custom = toolbar(page).locator(':scope > div > div > div button').first()
    await expect(custom).toHaveAttribute('title', 'Custom Division')
    await expect(custom).toHaveAttribute('aria-pressed', 'true')
    await expect(custom).toContainText('1/7')
    await page.keyboard.press('Escape')

    // Cancelling the custom dialog keeps the face on the value in use.
    await page.keyboard.press('4')
    await expectFace(0, '1/4 Division', '1/4')
    await face(0).hover()
    await toolbar(page).getByTitle('Custom Division', { exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: 'Division', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('spinbutton', { name: 'Division', exact: true })).toHaveCount(0)
    await expectFace(0, '1/4 Division', '1/4')

    // Lane divisions and lane limits behave the same.
    await run(page, 'laneDivision2')
    await expectFace(1, '1/2 Lane Division')
    await page.evaluate(() => (window.editorTest.view.laneDivision = 5))
    await expectFace(1, 'Custom Lane Division', '1/5')
    await run(page, 'laneLimitSix')
    await expectFace(2, 'Limit to ±6 Lanes')
    await page.evaluate(() => (window.editorTest.settings.maxLane = 12))
    await expectFace(2, 'Custom Lane Limit', '12')
    // Values too long for the face show the placeholder.
    await page.evaluate(() => (window.editorTest.settings.maxLane = 2.5))
    await expectFace(2, 'Custom Lane Limit', 'n')
    await page.evaluate(() => (window.editorTest.view.laneDivision = 128))
    await expectFace(1, 'Custom Lane Division', '1/n')
    // Unpressed, the custom buttons show their placeholder.
    await run(page, 'laneLimitNone')
    await face(2).hover()
    await expect(
        toolbar(page).getByTitle('Custom Lane Limit', { exact: true }).locator('text'),
    ).toHaveText('n')
    await page.keyboard.press('Escape')

    // A tool that switches once its command resolves still takes the face.
    await page.evaluate(() => {
        const { settings, history } = window.editorTest
        history.replaceState({ ...history.state.value, isDynamicStages: true })
        settings.toolbar = [['cameraEvent', 'event'], ...settings.toolbar.slice(1)]
    })
    await expect(face(0)).toHaveAttribute('title', 'Event')
    await face(0).hover()
    await toolbar(page).getByTitle('Camera Event', { exact: true }).click()
    await expect(face(0)).toHaveAttribute('title', 'Camera Event')
    await expect(face(0)).toHaveAttribute('aria-pressed', 'true')

    // Groups of plain actions still show the last one used.
    await face(3).hover()
    await toolbar(page).getByTitle('Redo', { exact: true }).click()
    await expect(face(3)).toHaveAttribute('title', 'Redo')
    await expect(face(3)).not.toHaveAttribute('aria-pressed')
})
