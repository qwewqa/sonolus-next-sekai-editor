import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { addBrushProperty, installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const selection = (page: Page) => panel(page).locator('#properties-section-selection')
const control = (page: Page, label: string) =>
    selection(page)
        .locator('label')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('input, select')

const open = async (page: Page) => {
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
        window.editorTest.settings.propertiesConnectorExpanded = true
    })
    await expect(panel(page)).toBeVisible()
}

/** Shows slides of notes from partial note objects and selects every note. */
const showSlides = (page: Page, slides: Partial<NoteObject>[][]) =>
    page.evaluate(async (slides) => {
        const { fixtures, show, history, store, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        show(
            {
                ...fixtures.interaction,
                slides: slides.map((notes) =>
                    notes.map((note) => ({
                        ...template,
                        left: 0,
                        size: 2,
                        isAttached: false,
                        isCritical: false,
                        isConnectorSeparator: false,
                        noteType: 'default' as const,
                        connectorType: 'active' as const,
                        connectorActiveIsCritical: false,
                        ...note,
                    })),
                ),
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        await nextTick()
    }, slides)

const notes = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .flatMap((entity) => (entity.type === 'note' ? [entity] : []))
            .sort((a, b) => a.beat - b.beat)
            .map(({ beat, isAttached, isCritical, connectorActiveIsCritical }) => ({
                beat,
                isAttached,
                isCritical,
                connectorActiveIsCritical,
            })),
    )

const selectedCount = (page: Page) =>
    page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await open(page)
})

test.describe('partial fields', () => {
    test('edits write only to the notes a field applies to', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 1 }, { beat: 2 }, { beat: 3 }]])
        await control(page, 'Attached').click()
        expect((await notes(page)).map((note) => note.isAttached)).toEqual([
            false,
            true,
            true,
            false,
        ])
        // Every note stays selected.
        expect(await selectedCount(page)).toBe(4)
    })

    test('critical still reaches the connectors of anchors', async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, noteType: 'anchor' },
                { beat: 1, noteType: 'anchor', isConnectorSeparator: true },
                { beat: 2 },
            ],
        ])
        await control(page, 'Critical').click()
        expect(await notes(page)).toEqual([
            { beat: 0, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
            { beat: 1, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
            { beat: 2, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
        ])
    })
})

test.describe('mixed values', () => {
    test.beforeEach(async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, left: -4, connectorEase: 'inQuad' },
                { beat: 1, left: 0, isAttached: true },
                { beat: 2, left: 1, isCritical: true },
            ],
            [
                { beat: 3, left: 2, connectorEase: 'outQuad', noteStyle: 'red' },
                { beat: 4, left: 4 },
            ],
        ])
    })

    test('selects count the objects behind each option and narrow to them', async ({ page }) => {
        const color = control(page, 'Note Color')
        await expect(color.locator('option:checked')).toHaveText('Mixed')
        await expect(color.locator('option', { hasText: 'Red' })).toHaveText('Red · 1')
        await expect(color.locator('option', { hasText: 'Default' })).toHaveText('Default · 4')
        await expect(color.locator('option', { hasText: 'Blue' })).toHaveText('Blue')

        await selection(page).getByRole('button', { name: 'Select only Red (1)' }).click()
        expect(await selectedCount(page)).toBe(1)
        await expect(color.locator('option:checked')).toHaveText('Red')
    })

    test('narrowing by keyboard keeps focus in the field', async ({ page }) => {
        await selection(page).getByRole('button', { name: 'Select only Red (1)' }).focus()
        await page.keyboard.press('Enter')
        expect(await selectedCount(page)).toBe(1)
        await expect(control(page, 'Note Color')).toBeFocused()
    })

    test('ease halves count types and functions separately', async ({ page }) => {
        await expect(control(page, 'Ease Function').locator('option:checked')).toHaveText('Quad')
        const type = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Ease Type', { exact: true }) })
        await expect(type.locator('.form-field-mixed-value')).toHaveText([
            '2 of 5',
            'In 1',
            'Out 1',
        ])
    })

    test('numbers show their range and toggles list their values', async ({ page }) => {
        await expect(control(page, 'Lane')).toHaveAttribute('placeholder', '-4 … 4')
        const critical = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Critical', { exact: true }) })
        await expect(critical.locator('.form-field-mixed-value')).toHaveText([
            'Disabled 4',
            'Enabled 1',
        ])
        await expect(control(page, 'Critical')).toHaveAccessibleDescription(
            'Mixed: Disabled 4, Enabled 1',
        )
        await critical.getByRole('button', { name: 'Select only Enabled (1)' }).click()
        expect(await selectedCount(page)).toBe(1)
    })

    test('fields used by part of the selection say how many objects they cover', async ({
        page,
    }) => {
        const attached = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Attached', { exact: true }) })
        await expect(attached.locator('.form-field-coverage-chip')).toHaveText('1 of 5')
        await expect(control(page, 'Attached')).toHaveAccessibleDescription(
            'Applies to 1 of 5 selected objects',
        )
        // Note Type applies to every note.
        const type = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Note Type', { exact: true }) })
        await expect(type.locator('.form-field-coverage-chip')).toHaveCount(0)
        // The chip narrows to the objects the field covers.
        await attached
            .getByRole('button', { name: 'Select only objects this property applies to (1 of 5)' })
            .click()
        expect(await selectedCount(page)).toBe(1)
    })

    test('coverage alone sits beside the label, on its own row in narrow docks', async ({
        page,
    }) => {
        const field = (label: string) =>
            selection(page)
                .locator('.form-field')
                .filter({ has: page.getByText(label, { exact: true }) })
        const sameRow = async (label: string) => {
            const chip = await field(label).locator('.form-field-mixed').boundingBox()
            const input = await control(page, label).boundingBox()
            return !!chip && !!input && chip.y + chip.height / 2 < input.y + input.height
        }
        expect(await sameRow('Attached')).toBe(true)
        // Controls keep their column.
        const attached = await control(page, 'Attached').boundingBox()
        const type = await control(page, 'Note Type').boundingBox()
        expect(attached?.x).toBeCloseTo(type?.x ?? 0, 0)
        // The chip keeps the usual 12px label gap from its control.
        const chip = await field('Attached').locator('.form-field-coverage-chip').boundingBox()
        expect((attached?.x ?? 0) - ((chip?.x ?? 0) + (chip?.width ?? 0))).toBeGreaterThanOrEqual(
            11.5,
        )
        // Values in use keep their own row.
        expect(await sameRow('Critical')).toBe(false)
        await page.evaluate(() => (window.editorTest.settings.rightDockWidth = 260))
        await expect.poll(() => sameRow('Attached')).toBe(false)
    })

    test('chips are one Tab stop, with arrows between them', async ({ page }) => {
        const chips = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Critical', { exact: true }) })
            .getByRole('toolbar')
            .getByRole('button')
        await expect(chips).toHaveCount(2)
        await chips.first().focus()
        await page.keyboard.press('ArrowRight')
        await expect(chips.nth(1)).toBeFocused()
        await expect(chips.nth(0)).toHaveAttribute('tabindex', '-1')
        await page.keyboard.press('Home')
        await expect(chips.nth(0)).toBeFocused()
    })

    test('descriptions join coverage and values in each locale’s punctuation', async ({ page }) => {
        const type = control(page, 'Ease Type')
        await expect(type).toHaveAccessibleDescription(
            'Applies to 2 of 5 selected objects. Mixed: In 1, Out 1',
        )
        await type.evaluate((element) => element.setAttribute('data-ease-type', ''))
        const described = page.locator('[data-ease-type]')
        for (const [locale, description] of [
            [
                'fr',
                'S’applique à 2 des 5 objets sélectionnés. Mixte : Accélération 1, Décélération 1',
            ],
            ['ja', '選択中の5個のうち2個に適用。混在：加速 1、減速 1'],
            ['zhs', '适用于所选 5 个对象中的 2 个。混合：缓入 1、缓出 1'],
        ] as const) {
            await page.evaluate((locale) => (window.editorTest.settings.locale = locale), locale)
            await expect(described).toHaveAccessibleDescription(description)
        }
    })
})

test.describe('kind blocks', () => {
    const header = (page: Page, name: RegExp) =>
        selection(page).locator('.properties-block-header').filter({ hasText: name })

    test('name each kind and narrow the selection to one', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 1 }, { beat: 2 }], [{ beat: 3 }]])
        await page.evaluate(async () => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) => entity.type === 'note' || entity.type === 'bpm',
                ),
            })
            await nextTick()
        })
        await expect(selection(page).locator('.properties-block-header h3')).toHaveText([
            'Notes 4 · in 1 slide',
            'BPM 1',
            'General',
        ])
        // Several BPM changes hide Beat; narrowing to notes brings it back.
        await expect(control(page, 'Beat')).toHaveCount(0)
        const notes = header(page, /^Notes/)
        await notes.getByRole('button', { name: 'Select only Notes (4)' }).focus()
        await page.keyboard.press('Enter')
        expect(await selectedCount(page)).toBe(4)
        await expect(control(page, 'Beat')).toHaveCount(1)
        // One kind left: nothing to narrow, and the header keeps the focus.
        await expect(selection(page).locator('.properties-block-header button')).toHaveCount(0)
        await expect(selection(page).locator('.properties-block-header h3')).toHaveText([
            'Notes 4 · in 1 slide',
        ])
        await expect(notes.locator('h3')).toBeFocused()
    })

    test('the select only action shows its name only when it fits', async ({ page }) => {
        await page.evaluate(async () => {
            const { fixtures, show, history, store, nextTick } = window.editorTest
            show(fixtures.events)
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) => entity.type === 'timeScale' || entity.type === 'bpm',
                ),
            })
            await nextTick()
        })
        const action = header(page, /^Time Scales/).getByRole('button')
        await expect(action).toHaveText('Select only')
        await expect(action).toHaveAccessibleName('Select only Time Scales (4)')
        // French names it at greater length than the header has room for.
        await page.evaluate(() => (window.editorTest.settings.locale = 'fr'))
        const french = header(page, /^Échelles de temps/).getByRole('button')
        await expect(french).toHaveText('')
        await expect(french).toHaveAccessibleName('Sélectionner seulement Échelles de temps (4)')
    })
})

test.describe('connector fields', () => {
    const header = (page: Page) => selection(page).getByRole('button', { name: /^Connector/ })

    test('collapse behind a summary and remember it', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, connectorEase: 'outQuad', connectorLayer: 'bottom' }, { beat: 1 }],
        ])
        await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
        await expect(control(page, 'Layer')).toHaveCount(1)

        await header(page).click()
        await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
        await expect(control(page, 'Layer')).toHaveCount(0)
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            'Slide · Default · Quad Out · Bottom',
        )
        expect(
            await page.evaluate(() => window.editorTest.settings.propertiesConnectorExpanded),
        ).toBe(false)
    })

    test('the summary names what agrees and counts what differs', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, connectorEase: 'inQuad', connectorLayer: 'bottom' }, { beat: 1 }],
            [{ beat: 2, connectorEase: 'outQuad', connectorStyle: 'red' }, { beat: 3 }],
        ])
        await header(page).click()
        // The function agrees though the types differ; differing values are left out.
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            'Slide · Quad',
        )
        await showSlides(page, [
            [{ beat: 0, connectorType: 'guide', connectorLayer: 'bottom' }, { beat: 1 }],
            [
                {
                    beat: 2,
                    connectorEase: 'inQuad',
                    connectorStyle: 'red',
                    connectorType: 'damage',
                },
                { beat: 3 },
            ],
        ])
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            '4 values differ',
        )
        // A Linear connector has no function to agree on.
        await showSlides(page, [
            [{ beat: 0, connectorEase: 'linear' }, { beat: 1 }],
            [{ beat: 2, connectorEase: 'outQuad' }, { beat: 3 }],
        ])
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            'Slide · Default · Top',
        )
        await showSlides(page, [
            [{ beat: 0, connectorEase: 'inSine' }, { beat: 1 }],
            [{ beat: 2, connectorEase: 'inQuad' }, { beat: 3 }],
        ])
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            'Slide · Default · In · Top',
        )
    })

    test('the summary stays empty when it has nothing to name', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 1, isAttached: true }, { beat: 2 }]])
        await page.evaluate(async () => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) => entity.type === 'note' && entity.beat === 1,
                ),
            })
            await nextTick()
        })
        // Only Separator applies to an attached tick.
        await header(page).click()
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText('')
    })

    test('a typed value commits when the fields collapse', async ({ page }) => {
        await showSlides(page, [[{ beat: 0, connectorType: 'guide' }, { beat: 1 }]])
        const alpha = control(page, 'Guide Alpha')
        await alpha.fill('0.5')
        await header(page).click()
        await expect(alpha).toHaveCount(0)
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        [...window.editorTest.store.getAllEntities()].find(
                            (entity) => entity.type === 'note' && entity.beat === 0,
                        )?.['connectorGuideAlpha' as never],
                ),
            )
            .toBe(0.5)
    })
})

test.describe('brush', () => {
    const tool = (page: Page) => panel(page).locator('#properties-section-tool')

    test.beforeEach(async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, isCritical: true },
                { beat: 1, isCritical: true },
            ],
        ])
        await page.keyboard.press('b')
        await expect(tool(page).getByText('Brush Properties')).toBeVisible()
    })

    test('starts empty and lists only the properties it sets', async ({ page }) => {
        await expect(tool(page).locator('.brush-group')).toHaveCount(0)
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(0)

        // Added properties start from the selection's value when it agrees.
        await addBrushProperty(tool(page), 'isCritical')
        const row = tool(page).locator('[data-brush-key="isCritical"]')
        await expect(row.locator('select')).toBeFocused()
        await expect(row.locator('option:checked')).toHaveText('Enabled')
        await expect(tool(page).locator('.brush-group h3')).toHaveText(['Note'])
        // A set property leaves the menu.
        await tool(page).getByRole('button', { name: 'Add Property', exact: true }).click()
        await expect(page.getByRole('menu').locator('[data-menu-key="sfx"]')).toHaveCount(1)
        await expect(page.getByRole('menu').locator('[data-menu-key="isCritical"]')).toHaveCount(0)
        await page.keyboard.press('Escape')

        // Removing by keyboard moves on to the next row, then to Add Property.
        await addBrushProperty(tool(page), 'sfx')
        await row.getByRole('button', { name: 'Remove Critical' }).focus()
        await page.keyboard.press('Enter')
        await expect(tool(page).locator('[data-brush-key="sfx"] select')).toBeFocused()
        await tool(page).getByRole('button', { name: 'Remove SFX' }).focus()
        await page.keyboard.press('Enter')
        await expect(tool(page).getByRole('button', { name: 'Add Property' })).toBeFocused()
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(0)
        await expect(tool(page).locator('.brush-group')).toHaveCount(0)
    })

    test('Add Property opens a list the keyboard browses before choosing', async ({ page }) => {
        const add = tool(page).getByRole('button', { name: 'Add Property', exact: true })
        await expect(add).toHaveAttribute('aria-haspopup', 'menu')
        await add.focus()
        await page.keyboard.press('ArrowDown')
        const menu = page.getByRole('menu', { name: 'Add Property' })
        await expect(menu).toBeVisible()
        await expect(add).toHaveAttribute('aria-expanded', 'true')
        // Grouped by kind, each group named by its heading.
        await expect(menu.getByRole('group', { name: 'Note', exact: true })).toBeVisible()
        const items = menu.getByRole('menuitem')
        await expect(items.first()).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('ArrowUp')
        await expect(items.nth(1)).toBeFocused()
        // Browsing adds nothing.
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(0)
        const key = await items.nth(1).getAttribute('data-menu-key')
        await page.keyboard.press('Enter')
        await expect(menu).toHaveCount(0)
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(1)
        await expect(
            tool(page).locator(`[data-brush-key="${key}"]`).locator('input, select').first(),
        ).toBeFocused()

        // Escape closes the list and returns to the button, adding nothing.
        await add.focus()
        await page.keyboard.press('Enter')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
        await expect(add).toBeFocused()
        await expect(add).toHaveAttribute('aria-expanded', 'false')
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(1)
        await expect(tool(page)).toBeVisible()
    })

    test('Add Property finds items by their first letters and opens upward to the last', async ({
        page,
    }) => {
        const add = tool(page).getByRole('button', { name: 'Add Property', exact: true })
        const menu = page.getByRole('menu', { name: 'Add Property' })
        const items = menu.getByRole('menuitem')
        const focusedLabel = () => page.evaluate(() => document.activeElement?.textContent.trim())
        await add.focus()
        await page.keyboard.press('ArrowUp')
        await expect(menu).toBeVisible()
        await expect(items.last()).toBeFocused()
        await page.keyboard.press('Escape')

        await page.keyboard.press('ArrowDown')
        await expect(items.first()).toHaveText('Group')
        // Repeating a letter cycles through its matches, wrapping.
        for (const label of ['Note Type', 'Note Color', 'Note Type']) {
            await page.keyboard.press('n')
            await expect.poll(focusedLabel).toBe(label)
            // Past the prefix timeout, so each press is a fresh letter.
            await page.waitForTimeout(600)
        }
        // Typed quickly, letters build a prefix.
        await page.keyboard.type('sk')
        await expect.poll(focusedLabel).toBe('Skip (beats)')
        await page.waitForTimeout(600)
        await page.keyboard.type('sli')
        await expect.poll(focusedLabel).toBe('Slide Fake')
        // Typing adds nothing.
        await expect(tool(page).locator('[data-brush-key]')).toHaveCount(0)
        await expect(menu).toBeVisible()
        // Nor does it start Firefox's quick find.
        expect(
            await page.evaluate(() =>
                document.activeElement?.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }),
                ),
            ),
        ).toBe(false)
    })

    test('picks agreeing values from the selection and clears them', async ({ page }) => {
        await tool(page).getByRole('button', { name: 'Pick from Selection' }).click()
        await expect(tool(page).locator('[data-brush-key="isCritical"] option:checked')).toHaveText(
            'Enabled',
        )
        await expect(tool(page).locator('[data-brush-key="connectorType"]')).toHaveCount(1)
        // Beat and lane are never brushed.
        await expect(tool(page).locator('[data-brush-key="left"]')).toHaveCount(0)
        await tool(page).getByRole('button', { name: 'Clear', exact: true }).click()
        await expect(tool(page).locator('.brush-group')).toHaveCount(0)
    })

    test('never offers the stage without dynamic stages', async ({ page }) => {
        await tool(page).getByRole('button', { name: 'Add Property', exact: true }).click()
        await expect(page.getByRole('menu').locator('[data-menu-key="groupId"]')).toHaveCount(1)
        await expect(page.getByRole('menu').locator('[data-menu-key="stageId"]')).toHaveCount(0)
        await page.keyboard.press('Escape')
        await tool(page).getByRole('button', { name: 'Pick from Selection' }).click()
        await expect(tool(page).locator('[data-brush-key="groupId"]')).toHaveCount(1)
        await expect(tool(page).locator('[data-brush-key="stageId"]')).toHaveCount(0)
    })
})

test.describe('unset values', () => {
    const tool = (page: Page) => panel(page).locator('#properties-section-tool')
    const empty = (page: Page, label: string) =>
        tool(page)
            .locator('label')
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator('select option')
            .first()

    test('creation presets say whether an unset field copies or is automatic', async ({ page }) => {
        await page.keyboard.press('a')
        await expect(empty(page, 'Note Type')).toHaveText('Copy')
        await expect(empty(page, 'Type')).toHaveText('Auto')
        await tool(page)
            .locator('label')
            .filter({ has: page.getByText('Copy Properties', { exact: true }) })
            .locator('input')
            .click()
        await expect(empty(page, 'Note Type')).toHaveText('Auto')
    })

    test('brush rows leave through their remove button, not an Unchanged entry', async ({
        page,
    }) => {
        await page.keyboard.press('b')
        await addBrushProperty(tool(page), 'noteType')
        const noteType = tool(page).locator('[data-brush-key="noteType"] select')
        await expect(noteType.locator('option:not([hidden])').first()).toHaveText('Default')
        await expect(noteType.locator('option', { hasText: 'Unchanged' })).toHaveCount(0)
        // Either half of an ease may stay Unchanged while the other is set.
        await addBrushProperty(tool(page), 'connectorEase')
        await expect(
            tool(page)
                .locator('[data-brush-key="connectorEase"] select')
                .first()
                .locator('option')
                .first(),
        ).toHaveText('Unchanged')
    })
})

test('two-value choices list the values in use while mixed', async ({ page }) => {
    await page.evaluate(async () => {
        const { fixtures, show, history, store, nextTick, settings } = window.editorTest
        settings.rightDockWidth = 560
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale',
            ),
        })
        await nextTick()
    })
    const field = selection(page)
        .locator('.form-field')
        .filter({ has: page.getByRole('radiogroup', { name: /^Transition/ }) })
    await expect(field.locator('.form-field-mixed-value')).toHaveText(['Time Scale 2', 'Scroll 2'])
    await field.getByRole('button', { name: 'Select only Scroll (2)' }).click()
    expect(await selectedCount(page)).toBe(2)
})

test('View picks the current group, apart from the selection’s group', async ({ page }) => {
    await showSlides(page, [[{ beat: 0 }]])
    const view = panel(page).locator('#properties-section-view')
    await expect(
        view
            .getByRole('combobox', { name: 'Current Group', exact: true })
            .locator('option:checked'),
    ).toHaveText('All Groups')
    await expect(view.getByRole('combobox', { name: 'Group', exact: true })).toHaveCount(0)
    await expect(control(page, 'Group')).toHaveCount(1)
})

test('kind blocks use short labels; General names what several kinds share', async ({ page }) => {
    await page.evaluate(async () => {
        const { fixtures, show, history, store, nextTick } = window.editorTest
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((entity) =>
                ['timeScale', 'cameraEventJoint', 'stageStyleEventJoint'].includes(entity.type),
            ),
        })
        await nextTick()
    })
    const block = (name: RegExp) =>
        selection(page)
            .locator('.properties-block')
            .filter({ has: page.locator('.properties-block-header h3', { hasText: name }) })
    const labels = (name: RegExp) => block(name).locator('.form-field-text').allTextContents()
    expect(await labels(/^Time Scales/)).toEqual(
        expect.arrayContaining(['Editor Lane', 'Ease Type', 'Ease Function', 'Transition']),
    )
    expect(await labels(/^Camera Events/)).toEqual(
        expect.arrayContaining(['Shift Lane', 'Zoom', 'Rotation', 'Ease Type']),
    )
    // Editor Lane and the event ease also edit every kind having them at once.
    expect(await labels(/^General/)).toEqual(
        expect.arrayContaining(['Editor Lane', 'Event Ease Type', 'Event Ease Function']),
    )
    for (const name of [/^Time Scales/, /^Camera Events/, /^General/]) {
        const list = await labels(name)
        expect(new Set(list).size).toBe(list.length)
    }
    // An edit in a kind's block reaches only that kind.
    await block(/^Camera Events/)
        .getByRole('combobox', { name: 'Ease Type', exact: true })
        .selectOption('linear')
    const eases = await page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .filter((entity) => entity.type === 'stageStyleEventJoint')
            .map((entity) => (entity as unknown as { eventEase: string }).eventEase),
    )
    expect(eases).toEqual(expect.arrayContaining(['inQuad']))
})

test('ease functions list linear eases apart and narrow to them', async ({ page }) => {
    await page.evaluate(async () => {
        const { fixtures, show, history, store, nextTick } = window.editorTest
        show(fixtures.connectors)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        await nextTick()
    })
    const name = selection(page)
        .locator('.form-field')
        .filter({ has: page.getByText('Ease Function', { exact: true }) })
        .first()
    await expect(name.locator('.form-field-mixed-value').last()).toHaveText('Linear 5')
    await name.getByRole('button', { name: 'Select only Linear (5)' }).click()
    expect(await selectedCount(page)).toBe(5)
})

test('the selection dialog follows the selection', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { settings, fixtures, show } = window.editorTest
        settings.propertiesPosition = 'disabled'
        show({
            ...fixtures.interaction,
            bpms: [...fixtures.interaction.bpms, { beat: 4, bpm: 90 }],
        })
    })
    const select = (kinds: string[]) =>
        page.evaluate(async (kinds) => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((entity) =>
                    kinds.includes(entity.type),
                ),
            })
            await nextTick()
        }, kinds)
    const dialog = page.locator('.editor-tool-modal')
    const named = (name: string) => page.getByRole('dialog', { name, exact: true })

    await select(['note'])
    await page.evaluate(async () => {
        const { editSelectionProperties } = await window.editorTest.appImport<
            typeof import('../../src/editor/editSelectionProperties')
        >('/src/editor/editSelectionProperties.ts')
        editSelectionProperties()
    })
    await expect(named('Note Properties')).toBeVisible()

    await select(['bpm'])
    await expect(named('BPM Properties')).toBeVisible()
    await expect(dialog).not.toContainText('No object selected')
    await expect(dialog.getByText('BPM', { exact: true }).first()).toBeVisible()

    await select(['bpm', 'note'])
    await expect(named('Selection')).toBeVisible()

    // A kind's own dialog over a mixed selection stays on its kind through edits.
    await page.evaluate(async () => {
        const { appImport } = window.editorTest
        const { showToolModal } = await appImport<typeof import('../../src/editor/toolModals')>(
            '/src/editor/toolModals.ts',
        )
        const { default: SelectionPropertiesModal } = await appImport<{
            default: typeof import('../../src/editor/workspace/properties/SelectionPropertiesModal.vue').default
        }>('/src/editor/workspace/properties/SelectionPropertiesModal.vue')
        void showToolModal(SelectionPropertiesModal, { kind: 'note' })
    })
    await expect(named('Note Properties')).toBeVisible()
    await page.evaluate(async () => {
        const { appImport, nextTick } = window.editorTest
        const { editSelectedEditableEntities } = await appImport<
            typeof import('../../src/editor/sidebars/default')
        >('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities({ isCritical: true })
        await nextTick()
    })
    await expect(named('Note Properties')).toBeVisible()

    await select([])
    await expect(dialog).toHaveCount(0)
})

test('emptying the selection returns focus the dialog held to the chart', async ({ page }) => {
    await page.evaluate(() => (window.editorTest.settings.propertiesPosition = 'disabled'))
    await showSlides(page, [[{ beat: 0 }, { beat: 1 }]])
    await page.evaluate(async () => {
        const { editSelectionProperties } = await window.editorTest.appImport<
            typeof import('../../src/editor/editSelectionProperties')
        >('/src/editor/editSelectionProperties.ts')
        editSelectionProperties()
    })
    const dialog = page.locator('.editor-tool-modal')
    await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.evaluate(async () => {
        const { history, nextTick } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        await nextTick()
    })
    await expect(dialog).toHaveCount(0)
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document.activeElement?.getAttribute('tabindex') === '-1' &&
                    !!document.activeElement.querySelector('canvas.editor-chart') &&
                    !document.activeElement.querySelector('[data-workspace-dock]'),
            ),
        )
        .toBe(true)
})

test.describe('brush on a phone', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

    test('a tapped property joins the brush without focusing its field', async ({ page }) => {
        await page.evaluate(() => (window.editorTest.settings.propertiesPosition = 'disabled'))
        // The second press opens the tool's dialog.
        await page.keyboard.press('b')
        await page.keyboard.press('b')
        const dialog = page.locator('.editor-tool-modal')
        await expect(dialog.getByText('Brush Properties')).toBeVisible()
        await dialog.getByRole('button', { name: 'Add Property', exact: true }).tap()
        await page.getByRole('menu').locator('[data-menu-key="size"]').tap()
        const size = dialog.locator('[data-brush-key="size"] input')
        await expect(size).toBeVisible()
        await expect(size).not.toBeFocused()
    })
})
