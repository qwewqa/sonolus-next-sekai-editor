import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

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

    test('ease halves count easings and modes separately', async ({ page }) => {
        await expect(control(page, 'Connector Ease').locator('option:checked')).toHaveText('Quad')
        const mode = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Connector Ease Mode', { exact: true }) })
        await expect(mode.locator('.form-field-mixed-value')).toHaveText(['In 1', 'Out 1'])
    })

    test('numbers show their range and toggles list their values', async ({ page }) => {
        await expect(control(page, 'Lane')).toHaveAttribute('placeholder', '−4 … 4')
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
        await expect(attached.locator('.form-field-coverage')).toHaveText('1/5')
        await expect(control(page, 'Attached')).toHaveAccessibleDescription(
            'Applies to 1 of 5 selected objects',
        )
        // Note Type applies to every note.
        const type = selection(page)
            .locator('.form-field')
            .filter({ has: page.getByText('Note Type', { exact: true }) })
        await expect(type.locator('.form-field-coverage')).toHaveCount(0)
    })
})

test.describe('selection summary', () => {
    test('lists each kind and narrows the selection to one', async ({ page }) => {
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
        const summary = selection(page).locator('.selection-summary')
        await expect(summary).toHaveText('Notes 4Slides 1BPM 1')
        // Several BPM changes hide Beat; narrowing to notes brings it back.
        await expect(control(page, 'Beat')).toHaveCount(0)
        await summary.getByRole('button', { name: 'Select only Notes (4)' }).click()
        expect(await selectedCount(page)).toBe(4)
        await expect(control(page, 'Beat')).toHaveCount(1)
        // One kind left: nothing to narrow.
        await expect(summary.getByRole('button')).toHaveCount(0)
        await expect(summary).toHaveText('Notes 4Slides 1')
    })
})

test.describe('connector fields', () => {
    const header = (page: Page) => selection(page).getByRole('button', { name: /^Connector/ })

    test('collapse behind a summary and remember it', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, connectorEase: 'outQuad', connectorLayer: 'bottom' }, { beat: 1 }],
        ])
        await expect(header(page)).toHaveAttribute('aria-expanded', 'true')
        await expect(control(page, 'Connector Layer')).toHaveCount(1)

        await header(page).click()
        await expect(header(page)).toHaveAttribute('aria-expanded', 'false')
        await expect(control(page, 'Connector Layer')).toHaveCount(0)
        await expect(header(page).locator('.properties-subsection-summary')).toHaveText(
            'Slide · Default · Quad Out · Bottom',
        )
        expect(
            await page.evaluate(() => window.editorTest.settings.propertiesConnectorExpanded),
        ).toBe(false)
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
