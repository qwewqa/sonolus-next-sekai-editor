import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')

type Shown = { label: string; shown: string; listed: string[] }

/** What every visible field shows, and the entries its list offers. */
const fields = (page: Page) =>
    panel(page)
        .locator('.form-field')
        .evaluateAll((elements) =>
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

const expectNoBlank = async (page: Page, context: string) => {
    for (const field of await fields(page)) {
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
            const add = panel(page).getByRole('combobox', { name: 'Add Property' })
            for (const key of ['connectorEase', 'timeScaleTransition', 'size', 'groupId'])
                await add.selectOption(key)
        }
        await expectNoBlank(page, `tool ${shortcut}`)
    }
})
