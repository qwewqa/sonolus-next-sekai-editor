import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const selection = (page: Page) => page.locator('#properties-section-selection')

const open = async (page: Page, locale: string, rightDockWidth: number) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(
        async ({ locale, rightDockWidth }) => {
            const { history, store, nextTick, fixtures, settings } = window.editorTest
            const chart = structuredClone(fixtures.interaction)
            // Each head gets a tail, so connector fields show; Critical is mixed.
            chart.slides = chart.slides.map(([head], index) => [
                { ...head!, isCritical: index === 0 },
                { ...head!, beat: head!.beat + 1 },
            ])
            history.resetState(false, chart, 0, 'stacking.json')
            Object.assign(settings, {
                locale,
                showSidebar: true,
                rightDockWidth,
                propertiesConnectorExpanded: true,
            })
            await nextTick()
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
            })
            await nextTick()
        },
        { locale, rightDockWidth },
    )
    await expect(selection(page).locator('.form-field').first()).toBeVisible()
    // Lets observers settle.
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
}

const stacked = (page: Page) =>
    selection(page)
        .locator('.form-field.form-field-value-stacked .form-field-text')
        .allTextContents()

const field = (page: Page, label: string) =>
    selection(page)
        .locator('.form-field')
        .filter({ has: page.locator('.form-field-text').getByText(label, { exact: true }) })

test('values that would truncate at the narrowest dock go below their label', async ({ page }) => {
    await open(page, 'fr', 260)
    await expect
        .poll(() => stacked(page))
        .toEqual(expect.arrayContaining(['Critique', 'Factice', 'Couche']))
    // Values that fit stay beside the label.
    expect(await stacked(page)).not.toContain('Temps')
    expect(await stacked(page)).not.toContain('Type d’interp.')

    // A click on an on/off value doesn't move its row.
    const dummy = field(page, 'Factice')
    const box = await dummy.boundingBox()
    await dummy.locator('.form-field-toggle > input').click()
    await expect(dummy.locator('.form-field-toggle > input')).toHaveValue('Activé')
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await expect(dummy).toHaveClass(/form-field-value-stacked/)
    expect(await dummy.boundingBox()).toEqual(box)
})

test('a stacked choice stays a select instead of switching back and forth', async ({ page }) => {
    await open(page, 'ja', 260)
    const presentation = field(page, '表示方式')
    await expect(presentation).toHaveClass(/form-field-value-stacked/)
    await expect(presentation.locator('select')).toBeVisible()
    // The page stays responsive; a layout loop would stall this.
    expect(await page.evaluate(() => 1)).toBe(1)

    // A wider dock gives the segments room beside the label again.
    await page.evaluate(() => (window.editorTest.settings.rightDockWidth = 480))
    await expect(presentation).not.toHaveClass(/form-field-value-stacked/)
    await expect(presentation.locator('[role="radiogroup"]')).toBeVisible()
})

for (const locale of ['en', 'fr', 'tr', 'ja']) {
    test(`${locale} values at the default dock stay beside their labels`, async ({ page }) => {
        await open(page, locale, 336)
        expect(await stacked(page)).toEqual([])
    })
}
