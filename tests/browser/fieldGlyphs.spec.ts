import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
})

test.afterEach(({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const field = (page: Page, label: string) =>
    panel(page)
        .locator('.form-field')
        .filter({ has: page.locator('.form-field-text').getByText(label, { exact: true }) })
const lead = (page: Page, label: string) => field(page, label).locator('.form-field-select-lead')
const selectPadding = (page: Page, label: string) =>
    field(page, label)
        .locator('select')
        .evaluate((select) => getComputedStyle(select).paddingLeft)

const open = async (page: Page, settings: Record<string, unknown> = {}) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate((settings) => {
        const { history, fixtures } = window.editorTest
        const chart = structuredClone(fixtures.interaction)
        const [a, b, c, d] = chart.slides.map((slide) => slide[0]!)
        Object.assign(a!, { noteStyle: 'purple', flickDirection: 'upLeft', connectorStyle: 'red' })
        Object.assign(b!, { noteStyle: 'red', flickDirection: 'none', connectorStyle: 'black' })
        Object.assign(c!, { noteStyle: 'default', flickDirection: 'downRight' })
        // Values no option names, far off screen so only the panel shows them.
        Object.assign(d!, { beat: 1000, noteStyle: 'pink', flickDirection: 'sideways' })
        // Each head gets a tail, so connector fields show.
        chart.slides = chart.slides.map(([head]) => [head!, { ...head!, beat: head!.beat + 1 }])
        chart.timeScales = structuredClone(fixtures.events.timeScales)
        history.resetState(false, chart, 0, 'glyphs.json')
        Object.assign(window.editorTest.settings, {
            showSidebar: true,
            propertiesConnectorExpanded: true,
            ...settings,
        })
    }, settings)
    await expect(panel(page)).toBeVisible()
}

const select = (page: Page, type: string, indices: number[]) =>
    page.evaluate(
        async ({ type, indices }) => {
            const { history, store } = window.editorTest
            const all = [...store.getAllEntities()]
                .filter((entity) => entity.type === type)
                .sort((a, b) => a.beat - b.beat)
            history.replaceState({
                ...history.state.value,
                selectedEntities: indices.map((index) => all[index]!),
            })
            await window.editorTest.nextTick()
        },
        { type, indices },
    )

test('color and flick fields show the current value as the canvas draws it', async ({ page }) => {
    await open(page)
    await select(page, 'note', [0])
    await expect(lead(page, 'Note Color').locator('circle')).toHaveAttribute('fill', '#dfaaff')
    await expect(lead(page, 'Note Color').locator('circle')).toHaveAttribute('stroke', '#bd66ee')
    await expect(lead(page, 'Color').locator('circle')).toHaveAttribute('fill', '#d6737b')
    await expect(lead(page, 'Flick Direction').locator('polygon')).toHaveCount(1)
    await expect(lead(page, 'Flick Direction')).toHaveAttribute('aria-hidden', 'true')
    // Options stay text.
    await expect(field(page, 'Note Color').locator('option svg')).toHaveCount(0)

    // Black connectors use the styled connector base; None has no arrow.
    await select(page, 'note', [2])
    await expect(lead(page, 'Color').locator('circle')).toHaveAttribute('fill', '#555555')
    await expect(lead(page, 'Flick Direction')).toHaveCount(0)

    // Default resolves per object: a dashed ring.
    await select(page, 'note', [4])
    await expect(lead(page, 'Note Color').locator('circle')).toHaveAttribute(
        'stroke-dasharray',
        '2.2 2',
    )

    // Unknown values have no glyph.
    await select(page, 'note', [6])
    await expect(lead(page, 'Note Color')).toHaveCount(0)
    await expect(lead(page, 'Flick Direction')).toHaveCount(0)

    // Mixed values keep their counts in the options and no glyph or inset.
    await select(page, 'note', [0, 2])
    await expect(lead(page, 'Note Color')).toHaveCount(0)
    expect(await selectPadding(page, 'Note Color')).toBe('16px')
    await expect(
        field(page, 'Note Color').locator('option', { hasText: 'Purple · 1' }),
    ).toHaveCount(1)
    await expect(field(page, 'Note Color').locator('.form-field-mixed-value')).toHaveCount(2)
})

test('tool presets show glyphs only for values that are set', async ({ page }) => {
    await open(page, { propertiesSection: 'tool' })
    await page.evaluate(async () => {
        const { settings } = window.editorTest
        const presets = structuredClone(settings.defaultNotePropertiesPresets)
        presets[0] = { ...presets[0]!, noteStyle: 'cyan', flickDirection: undefined }
        settings.defaultNotePropertiesPresets = presets
        const { switchToolTo } = await import('/src/editor/tools/index.ts')
        switchToolTo('note')
    })
    await expect(lead(page, 'Note Color').locator('circle')).toHaveAttribute('fill', '#83e5ff')
    await expect(lead(page, 'Flick Direction')).toHaveCount(0)
})

test.describe('time scale transition', () => {
    const transition = 'Transition'
    const segments = (page: Page) => field(page, transition).getByRole('radiogroup')

    test('a wide dock shows the markers beside both names', async ({ page }) => {
        await open(page, { rightDockWidth: 460 })
        await select(page, 'timeScale', [1])
        await expect(segments(page)).toBeVisible()
        await expect(segments(page).locator('[aria-hidden="true"] svg')).toHaveCount(2)
        await expect(segments(page).locator('circle')).toHaveCount(1)
        await expect(segments(page).locator('polygon')).toHaveCount(1)
        await expect(segments(page).getByRole('radio', { name: 'Scroll' })).toBeChecked()
    })

    test('the default dock keeps every name in full without the marker', async ({ page }) => {
        await open(page)
        await select(page, 'timeScale', [1])
        await expect(field(page, transition).locator('select')).toBeVisible()
        await expect(lead(page, transition)).toHaveCount(0)
        expect(await selectPadding(page, transition)).toBe('16px')
    })

    test('a phone keeps the segments and drops the markers first', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await open(page)
        await select(page, 'timeScale', [1])
        await expect(segments(page)).toBeVisible()
        await expect(segments(page).locator('svg')).toHaveCount(0)
    })
})

test('keyboard shortcuts show each command icon before its name', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    const section = page
        .locator('dialog[open] section')
        .filter({ has: page.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true }) })
    const rows = section.locator('.form-field')
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    expect(count).toBeGreaterThan(50)
    await expect(section.locator('.form-field-icon[aria-hidden="true"] > *')).toHaveCount(count)
    // The icon adds nothing to the field's name.
    const timeScale = rows.filter({
        has: page.locator('.form-field-text').getByText('Time Scale', { exact: true }),
    })
    await expect(timeScale.locator('.form-field-icon')).toContainText('TS')
    await expect(timeScale.getByRole('button')).not.toHaveAccessibleName(/TS/)
})

test('a shortcut icon gives way before its name would clamp, and returns with room', async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await open(page)
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    const row = (name: string) =>
        page.locator('dialog[open] .form-field').filter({
            has: page.locator('.form-field-text').getByText(name, { exact: true }),
        })
    const long = row('Toggle Stage Transform Event Visibility')
    await expect(long.locator('.form-field-icon')).toBeHidden()
    await expect(row('Save').locator('.form-field-icon')).toBeVisible()
    expect(
        await long
            .locator('.form-field-text')
            .evaluate((text) => text.scrollHeight <= text.clientHeight + 1),
    ).toBe(true)

    await page.setViewportSize({ width: 1600, height: 1000 })
    await expect(long.locator('.form-field-icon')).toBeVisible()
})

test('wide text icons keep clear of their names in the shortcut list and flyouts', async ({
    page,
}) => {
    // Space from the icon's drawn chip (not its box) to the name.
    const gap = (row: import('@playwright/test').Locator, text: string) =>
        row.evaluate((row, text) => {
            const chip = [...row.querySelectorAll('span, div')]
                .filter((element) => element.textContent?.trim() === 'BPM')
                .at(-1)!
            const name = [...row.querySelectorAll('span')].find(
                (element) => element.textContent?.trim() === text,
            )!
            return name.getBoundingClientRect().left - chip.getBoundingClientRect().right
        }, text)

    await open(page)
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    const row = page
        .locator('dialog[open] .form-field')
        .filter({ has: page.getByText('Toggle BPM Visibility', { exact: true }) })
    expect(await gap(row, 'Toggle BPM Visibility')).toBeGreaterThanOrEqual(6)
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    const shown = page.locator('[data-editor-toolbar] > div > div > button')
    await shown.and(page.getByTitle('Cycle Object Visibilities', { exact: true })).hover()
    const item = page
        .locator('[data-editor-toolbar] > div > div > div button')
        .filter({ hasText: 'Toggle BPM Visibility' })
    await expect(item).toBeVisible()
    expect(await gap(item, 'Toggle BPM Visibility')).toBeGreaterThanOrEqual(6)
})

test('command names line up in one icon column that text glyphs fit', async ({ page }) => {
    await open(page)
    // Every drawn glyph, text included, stays inside its 20px column.
    const columns = (selector: string) =>
        page.locator(selector).evaluateAll((columns) =>
            columns
                .filter((column) => column.getClientRects().length)
                .map((column) => {
                    const box = column.getBoundingClientRect()
                    const drawn = [...column.querySelectorAll('*')].flatMap((element) => {
                        const range = document.createRange()
                        range.selectNodeContents(element)
                        return [element.getBoundingClientRect(), range.getBoundingClientRect()]
                    })
                    const name = column.nextElementSibling!.getBoundingClientRect().left
                    return {
                        width: Math.round(box.width),
                        overflow: drawn.some(
                            (rect) =>
                                rect.width > 0 &&
                                (rect.left < box.left - 0.5 || rect.right > box.right + 0.5),
                        ),
                        name: Math.round(name),
                    }
                }),
        )
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    await expect(page.locator('dialog[open] [data-icon-column]').first()).toBeVisible()
    const list = await columns('dialog[open] [data-icon-column]')
    expect(new Set(list.map(({ width }) => width))).toEqual(new Set([20]))
    expect(list.filter(({ overflow }) => overflow)).toEqual([])
    expect(new Set(list.map(({ name }) => name)).size).toBe(1)
    await page.keyboard.press('Escape')

    // Flyouts on a phone share the column; the toolbar's own buttons keep the
    // glyphs' full size.
    await page.setViewportSize({ width: 390, height: 844 })
    const shown = page.locator('[data-editor-toolbar] > div > div > button')
    const bpm = shown.and(page.getByTitle('BPM', { exact: true }))
    expect(
        await bpm.evaluate(
            (button) => getComputedStyle(button.querySelector('span span')!).fontSize,
        ),
    ).toBe('12px')
    await bpm.hover()
    await expect(page.locator('[data-editor-toolbar] [data-icon-column]').first()).toBeVisible()
    const flyout = await columns('[data-editor-toolbar] [data-icon-column]')
    expect(flyout.filter(({ overflow }) => overflow)).toEqual([])
    expect(new Set(flyout.map(({ name }) => name)).size).toBe(1)
})

for (const width of [336, 260]) {
    test(`select values keep 1.75rem beside the chevron at a ${width}px dock`, async ({ page }) => {
        await open(page, { rightDockWidth: width })
        await page.evaluate(async () => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
            })
            await nextTick()
        })
        const selects = await panel(page)
            .locator('.form-field-select > select')
            .evaluateAll((selects) =>
                selects
                    .filter((select) => select.getClientRects().length)
                    .map((select) => {
                        const box = select.getBoundingClientRect()
                        const padding = parseFloat(getComputedStyle(select).paddingRight)
                        const chevron = select
                            .parentElement!.querySelector('.form-field-select-icon svg')!
                            .getBoundingClientRect()
                        return { padding, clear: chevron.left - (box.right - padding) }
                    }),
            )
        expect(selects.length).toBeGreaterThan(3)
        for (const { padding, clear } of selects) {
            expect(padding).toBe(28)
            expect(clear).toBeGreaterThanOrEqual(2)
        }
    })
}

test('a value glyph gives way only when that lets the value fit', async ({ page }) => {
    await open(page)
    const shown = (label: string) =>
        lead(page, label).evaluate((lead) => getComputedStyle(lead).display !== 'none')
    const fits = (label: string) =>
        field(page, label)
            .locator('select')
            .evaluate((select) => select.scrollWidth <= select.clientWidth)
    // The default note colour, "デフォルト", fits only without its swatch.
    await page.evaluate(() => (window.editorTest.settings.locale = 'ja'))
    await page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (e) => e.type === 'note' && e.beat === 7,
            ),
        })
        await nextTick()
    })
    await expect.poll(() => shown('ノーツの色')).toBe(false)
    expect(await fits('ノーツの色')).toBe(true)
    // Up Left in French truncates either way, so its arrow stays.
    await page.evaluate(() => (window.editorTest.settings.locale = 'fr'))
    await page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (e) => e.type === 'note' && e.beat === 3,
            ),
        })
        await nextTick()
    })
    await expect.poll(() => shown('Direction du Flick')).toBe(true)
    // With room, the swatch returns.
    await page.evaluate(() => (window.editorTest.settings.rightDockWidth = 560))
    await page.evaluate(() => (window.editorTest.settings.locale = 'ja'))
    await page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (e) => e.type === 'note' && e.beat === 7,
            ),
        })
        await nextTick()
    })
    await expect.poll(() => shown('ノーツの色')).toBe(true)
})
