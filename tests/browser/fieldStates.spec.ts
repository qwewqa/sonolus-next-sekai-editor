import { expect, test, type Page } from '@playwright/test'
import { addBrushProperty, installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')

type Shown = { label: string; shown: string; listed: string[] }

/** What every visible field shows, and the entries its list offers. */
const fields = (page: Page, root = panel(page)) =>
    root.locator('.form-field').evaluateAll((elements) =>
        elements.flatMap((field): Shown[] => {
            if (!(field as HTMLElement).offsetParent) return []
            const label = field.querySelector('.form-field-text')?.textContent?.trim() ?? ''
            const radiogroup = field.querySelector('[role="radiogroup"]')
            const select = field.querySelector('select')
            const input = field.querySelector('input')
            let shown = ''
            let listed: string[] = []
            if (radiogroup) {
                const checked = radiogroup.querySelector<HTMLInputElement>('input:checked')
                // Mixed checks nothing; its values are listed beneath instead.
                shown = checked
                    ? (checked.closest('label')?.textContent ?? '')
                    : [...field.querySelectorAll('.form-field-mixed-value')]
                          .map((value) => value.textContent)
                          .join(', ')
            } else if (select) {
                shown = select.selectedOptions[0]?.textContent ?? ''
                listed = [...select.options]
                    .filter((option) => !option.hidden)
                    .map((option) => option.textContent?.trim() ?? '')
            } else if (input) {
                shown = input.value || input.placeholder
            }
            return [{ label, shown: shown.trim(), listed }]
        }),
    )

const expectNoBlank = async (page: Page, context: string, root = panel(page)) => {
    for (const field of await fields(page, root)) {
        expect(field.shown, `${context}: ${field.label}`).not.toBe('')
        for (const entry of field.listed) {
            expect(entry, `${context}: ${field.label} lists`).not.toMatch(/^(Mixed)?$/)
            expect(entry, `${context}: ${field.label} lists`).not.toMatch(/^Unknown/)
        }
    }
}

const select = (page: Page, filter: string) =>
    page.evaluate(async (filter) => {
        const { history, store, nextTick } = window.editorTest
        const all = [...store.getAllEntities()].filter((entity) => entity.type !== 'connector')
        const types = [...new Set(all.map((entity) => entity.type))]
        const groups: Record<string, typeof all> = { everything: all }
        for (const type of types) {
            groups[`all ${type}`] = all.filter((entity) => entity.type === type)
            groups[`one ${type}`] = groups[`all ${type}`]!.slice(0, 1)
        }
        history.replaceState({
            ...history.state.value,
            selectedEntities: groups[filter] ?? [],
        })
        await nextTick()
        return Object.keys(groups)
    }, filter)

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.showSidebar = true
        settings.propertiesConnectorExpanded = true
    })
    await expect(panel(page)).toBeVisible()
})

for (const fixture of ['events', 'interaction', 'connectors'] as const) {
    test(`no field is blank for any selection of the ${fixture} chart`, async ({ page }) => {
        await page.evaluate(async (fixture) => {
            const { show, fixtures, nextTick } = window.editorTest
            show(fixtures[fixture])
            await nextTick()
        }, fixture)
        for (const selection of await select(page, '')) {
            await select(page, selection)
            await expectNoBlank(page, `${fixture} ${selection}`)
        }
    })
}

test('the properties dialog on a phone shows no blank field and explains mixed ones', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(async () => {
        const { show, fixtures, settings, nextTick } = window.editorTest
        settings.showSidebar = false
        show(fixtures.connectors)
        await nextTick()
    })
    const dialog = page.getByRole('dialog')
    for (const selection of ['all note', 'everything', 'one note']) {
        await select(page, selection)
        await page.evaluate(async () => {
            // The context menu's Edit Properties action.
            const { focusSelectionProperties } = await window.editorTest.appImport<
                typeof import('../../src/editor/editSelectionProperties')
            >('/src/editor/editSelectionProperties.ts')
            await focusSelectionProperties(true)
        })
        await expect(dialog.locator('.form-field').first()).toBeVisible()
        await expectNoBlank(page, `dialog ${selection}`, dialog)
        if (selection === 'all note') {
            await expect(dialog.locator('.properties-block-header h3')).toHaveText([
                'Notes 48 · in 18 slides',
            ])
            await expect(dialog.locator('.form-field-coverage-chip').first()).toBeVisible()
            await expect(dialog.getByLabel('Lane', { exact: true })).toHaveAttribute(
                'placeholder',
                '-10.5 … 8',
            )
        }
        await dialog.getByRole('button', { name: 'Close' }).click()
    }
})

test('values no option names show as unknown rather than blank', async ({ page }) => {
    await page.evaluate(async () => {
        const { show, fixtures, history, store, nextTick } = window.editorTest
        const note = fixtures.interaction.slides.flat()[0]!
        show({
            ...fixtures.interaction,
            slides: [
                [{ ...note, beat: 2, noteStyle: 'mystery' as never, sfx: 'whistle' as never }],
            ],
        })
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        await nextTick()
    })
    const color = panel(page).getByRole('combobox', { name: 'Note Color', exact: true })
    await expect(color.locator('option:checked')).toHaveText('Unknown (mystery)')
    await expect(
        panel(page).getByRole('combobox', { name: 'SFX', exact: true }).locator('option:checked'),
    ).toHaveText('Unknown (whistle)')
    await expectNoBlank(page, 'unknown')
})

test('brush, creation presets and View never show a blank field', async ({ page }) => {
    await select(page, 'one note')
    for (const shortcut of ['b', 'a', 's', 'f']) {
        await page.keyboard.press(shortcut)
        if (shortcut === 'b') {
            for (const key of ['connectorEase', 'timeScaleTransition', 'size', 'groupId'])
                await addBrushProperty(panel(page), key)
        }
        await expectNoBlank(page, `tool ${shortcut}`)
    }
})

test('a rejected number entry returns to the actual value', async ({ page }) => {
    await page.evaluate(() => (window.editorTest.settings.propertiesSection = 'view'))
    const size = panel(page)
        .locator('#properties-section-view label')
        .filter({ has: page.getByText('Size', { exact: true }) })
        .locator('input')
    await expect(size).toHaveValue('2')
    await size.fill('')
    await size.press('Enter')
    await expect(size).toHaveValue('2')
    await size.fill('-1')
    await size.press('Tab')
    await expect(size).toHaveValue('2')
    expect(await page.evaluate(() => window.editorTest.view.noteSize)).toBe(2)
    await size.fill('3')
    await size.press('Enter')
    expect(await page.evaluate(() => window.editorTest.view.noteSize)).toBe(3)
})

test('an unset choice in a select looks like an unset number field', async ({ page }) => {
    await page.keyboard.press('a')
    const field = (label: string) =>
        panel(page)
            .locator('.form-field')
            .filter({ has: page.locator('.form-field-text').getByText(label, { exact: true }) })
    const noteType = field('Note Type').locator('select')
    await expect(noteType.locator('option:checked')).toHaveText('Copy')
    // The field draws the value over a select with a shared list.
    const colors = await page.evaluate(
        ([select, input]) => ({
            unset: getComputedStyle(select!.parentElement!.querySelector('.select-value')!).color,
            placeholder: getComputedStyle(input!, '::placeholder').color,
            option: getComputedStyle((select as HTMLSelectElement).options[1]!).color,
            set: getComputedStyle(
                document.querySelector('#workspace-panel-properties .select-value')!,
            ).color,
        }),
        [await noteType.elementHandle(), await field('Elevation').locator('input').elementHandle()],
    )
    expect(colors.unset).toBe(colors.placeholder)
    // The list itself, and a set value such as the preset number, stay full strength.
    expect(colors.option).toBe('rgb(68, 68, 102)')
    expect(colors.set).toBe('rgb(68, 68, 102)')
})

test('the name field of a rename dialog keeps its edge at rest in high contrast', async ({
    page,
}) => {
    // High contrast drops its shadow; the transparent outline is painted instead.
    await page.emulateMedia({ forcedColors: 'active' })
    await page.evaluate(async () => {
        const { openGroupProperties } = await import('/src/editor/workspace/manager/groups.ts')
        const { groups } = window.editorTest.history.state.value
        void openGroupProperties([...groups.keys()][0]!)
    })
    const name = page.getByRole('dialog').getByRole('textbox', { name: 'Name' })
    await expect(name).toBeVisible()
    const text = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'CanvasText'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(
        await name.evaluate((element) => {
            const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(element)
            return { style: outlineStyle, width: outlineWidth, color: outlineColor }
        }),
    ).toEqual({ style: 'solid', width: '2px', color: text })
})

test('a form dialog stays open on an invalid number and changes nothing', async ({ page }) => {
    const dialog = page.getByRole('dialog')
    const read = () =>
        page.evaluate(async () => {
            const { history, settings, view, appImport } = window.editorTest
            const { notification } = await appImport<
                typeof import('../../src/editor/notification')
            >('/src/editor/notification.ts')
            const { initialLife, bgm } = history.state.value
            return {
                division: view.division,
                maxLane: settings.maxLane,
                customMaxLane: settings.customMaxLane,
                initialLife,
                offset: bgm.offset,
                notice: notification.value.id,
                canUndo: history.canUndo.value,
            }
        })
    const open = (name: string) =>
        page.evaluate(async (name) => {
            const { commands } = await import('/src/editor/commands/index.ts')
            void commands[name as keyof typeof commands].execute()
        }, name)
    const before = await read()
    for (const [command, label, value] of [
        ['divisionCustom', 'Division', '0'],
        ['laneLimitCustom', 'Maximum Lane (±)', '-3'],
        ['properties', 'Initial Life', '-5'],
        ['properties', 'Initial Life', '1.5'],
        ['bgm', 'Offset (ms)', ''],
    ] as const) {
        for (const submit of ['click', 'Enter'] as const) {
            const context = `${command} ${value || 'blank'} ${submit}`
            await open(command)
            const field = dialog.getByRole('spinbutton', { name: label, exact: true })
            await field.fill(value)
            if (submit === 'click') await dialog.getByRole('button', { name: 'Confirm' }).click()
            else await field.press('Enter')
            // The native message shows on the field, which keeps the entry.
            await expect(dialog, context).toBeVisible()
            await expect(field, context).toBeFocused()
            await expect(field, context).toHaveValue(value)
            expect(
                await field.evaluate((input: HTMLInputElement) => input.validationMessage),
                context,
            ).not.toBe('')
            expect(await read(), context).toEqual(before)
            // Escape reverts the entry, then closes.
            await page.keyboard.press('Escape')
            await expect(dialog, context).toBeVisible()
            await page.keyboard.press('Escape')
            await expect(dialog, context).toHaveCount(0)
        }
    }
})
