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
    test(`${locale} values at a 336 dock, below the default, stay beside their labels`, async ({
        page,
    }) => {
        await open(page, locale, 336)
        expect(await stacked(page)).toEqual([])
    })
}

test('brush values stack too, with remove kept on the label line', async ({ page }) => {
    await open(page, 'ja', 260)
    await page.evaluate(async () => {
        const { history, store, nextTick, settings } = window.editorTest
        settings.propertiesCollapsed = ['selection']
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        await nextTick()
    })
    await page.keyboard.press('b')
    const tool = page.locator('#workspace-panel-properties')
    await tool.locator('.brush-pick').click()
    const row = tool.locator('[data-brush-key="noteStyle"]')
    await expect(row.locator('.form-field')).toHaveClass(/form-field-value-stacked/)
    const layout = await row.evaluate((row) => {
        const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(row.querySelector('.form-field-text')!)
        return {
            remove: box('.brush-remove').toJSON() as DOMRect,
            text: range.getBoundingClientRect().toJSON() as DOMRect,
            control: box('.form-field-row > :not(.form-field-label)').toJSON() as DOMRect,
        }
    })
    // Beside the label, not over the value below it.
    expect(layout.remove.left).toBeGreaterThanOrEqual(layout.text.right)
    expect(layout.remove.bottom).toBeLessThanOrEqual(layout.control.top)
    expect(
        Math.abs(
            (layout.remove.top + layout.remove.bottom) / 2 -
                (layout.text.top + layout.text.bottom) / 2,
        ),
    ).toBeLessThan(4)
})

test('a mixed range too long for its pill goes below its label', async ({ page }) => {
    await open(page, 'fr', 260)
    await page.evaluate(async () => {
        const { history, store, nextTick, fixtures } = window.editorTest
        // Beats far apart, with fractions, as a long selection shows them.
        const chart = structuredClone(fixtures.interaction)
        chart.slides = chart.slides.map(([head], index) => [
            { ...head!, beat: 56 + 1 / 3 + index },
            { ...head!, beat: 62.75 + index },
        ])
        history.resetState(false, chart, 0, 'stacking.json')
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
        })
        await nextTick()
    })
    const beat = field(page, 'Temps')
    await expect(beat.locator('input')).toHaveAttribute('placeholder', /^\d+\.3333 … \d+\.75$/)
    await expect(beat).toHaveClass(/form-field-value-stacked/)
    const fits = await beat.locator('input').evaluate((input: HTMLInputElement) => {
        const style = getComputedStyle(input)
        const context = document.createElement('canvas').getContext('2d')!
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const room =
            input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        return context.measureText(input.placeholder).width <= room
    })
    expect(fits).toBe(true)

    // The row holds still while a value is typed.
    await beat.locator('input').click()
    await page.keyboard.type('5')
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await expect(beat).toHaveClass(/form-field-value-stacked/)
    await page.keyboard.press('Escape')
})

test('a field refits when only its mixed range changes', async ({ page }) => {
    await open(page, 'fr', 260)
    const select = (slide: number) =>
        page.evaluate(async (slide) => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) =>
                        entity.type === 'note' && entity.beat >= slide && entity.beat < slide + 20,
                ),
            })
            await nextTick()
        }, slide)
    await page.evaluate(async () => {
        const { history, nextTick, fixtures } = window.editorTest
        // A short range on one slide, a long one on the other.
        const chart = structuredClone(fixtures.interaction)
        const [head] = chart.slides[0]!
        chart.slides = [
            [
                { ...head!, beat: 1 },
                { ...head!, beat: 2 },
            ],
            [
                { ...head!, beat: 56 + 1 / 3 },
                { ...head!, beat: 62.75 },
            ],
        ]
        history.resetState(false, chart, 0, 'stacking.json')
        await nextTick()
    })
    await select(0)
    const beat = field(page, 'Temps')
    await expect(beat.locator('input')).toHaveAttribute('placeholder', '2 … 3')
    await expect(beat).not.toHaveClass(/form-field-value-stacked/)
    // The same field, so only an update can refit it.
    await beat.evaluate((element) => (element.dataset.kept = ''))
    await select(50)
    await expect(beat.locator('input')).toHaveAttribute('placeholder', '57.3333 … 63.75')
    await expect(beat).toHaveAttribute('data-kept', '')
    await expect(beat).toHaveClass(/form-field-value-stacked/)
})
