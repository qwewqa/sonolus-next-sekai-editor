import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const header = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true })
const sectionTab = (page: Page, name: string) =>
    panel(page).getByRole('tablist').getByRole('tab', { name, exact: true })

const open = async (page: Page, values: Record<string, unknown> = {}) => {
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate((values) => {
        Object.assign(window.editorTest.settings, { showSidebar: true, ...values })
    }, values)
    await expect(panel(page)).toBeVisible()
}

const selectNoteAt = (page: Page, beat: number) =>
    page.evaluate(async (beat) => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && entity.beat === beat,
            ),
        })
        await window.editorTest.nextTick()
    }, beat)

const settingsOf = (page: Page) =>
    page.evaluate(() => ({
        section: window.editorTest.settings.propertiesSection,
        collapsed: window.editorTest.settings.propertiesCollapsed,
    }))

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
})

test.describe('roomy panel', () => {
    test('sections expand and collapse, persist across reload, and return shortcuts', async ({
        page,
    }) => {
        await open(page)
        await selectNoteAt(page, 3)
        await expect(panel(page).getByRole('tablist')).toHaveCount(0)
        const selection = header(page, 'Selection')
        await expect(selection).toHaveAttribute('aria-expanded', 'true')
        await expect(header(page, 'Tool')).toHaveAttribute('aria-expanded', 'true')
        await expect(header(page, 'View')).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByLabel('Beat', { exact: true })).toHaveValue('4')

        await selection.click()
        await expect(selection).toHaveAttribute('aria-expanded', 'false')
        await expect(page.getByLabel('Beat', { exact: true })).toHaveCount(0)
        // A pointer click leaves keyboard shortcuts with the editor.
        await expect(page.locator('[data-workspace-dock] :focus')).toHaveCount(0)
        await page.keyboard.press('e')
        await expect
            .poll(() => page.evaluate(() => window.editorTest.settings.showGroups))
            .toBe(true)
        expect(await settingsOf(page)).toEqual({ section: 'selection', collapsed: ['selection'] })

        await page.reload()
        await open(page)
        await expect(header(page, 'Selection')).toHaveAttribute('aria-expanded', 'false')
        await expect(header(page, 'View')).toHaveAttribute('aria-expanded', 'true')

        // Keyboard activation keeps focus on the header.
        await header(page, 'Selection').focus()
        await page.keyboard.press('Enter')
        await expect(header(page, 'Selection')).toHaveAttribute('aria-expanded', 'true')
        await expect(header(page, 'Selection')).toBeFocused()
        expect((await settingsOf(page)).collapsed).toEqual([])
    })

    test('typing in a field does not trigger editor shortcuts', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        const lane = page.getByLabel('Lane', { exact: true })
        await lane.focus()
        await page.keyboard.press('e')
        await page.keyboard.press('Escape')
        expect(await page.evaluate(() => window.editorTest.settings.showGroups)).toBe(false)
    })

    test('selection fields lead with position fields and end with elevation', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        const labels = await panel(page)
            .locator('#properties-section-selection .form-field-label')
            .allTextContents()
        const trimmed = labels.map((label) => label.trim())
        expect(trimmed.slice(0, 3)).toEqual(['Beat', 'Lane', 'Size'])
        // Elevation is an advanced value and comes last.
        expect(trimmed.at(-1)).toBe('Elevation')
    })

    test('only the stuck section header raises over fields scrolled beneath it', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1600, height: 760 })
        await open(page)
        await selectNoteAt(page, 3)
        const raised = () =>
            panel(page)
                .locator('h2.shadow-band')
                .evaluateAll((headers) => headers.map((header) => header.textContent?.trim()))
        await expect.poll(raised).toEqual([])
        await panel(page)
            .locator('.properties-scroller')
            .evaluate((element) => (element.scrollTop = 120))
        await expect.poll(raised).toEqual(['Selection'])

        // Collapsing the section moves the content out from under the header.
        await header(page, 'Selection').click()
        await expect.poll(raised).toEqual([])
    })

    test('values of notes a field does not apply to do not make it mixed', async ({ page }) => {
        await open(page, { propertiesConnectorExpanded: true })
        await page.evaluate(async () => {
            const { fixtures, show, nextTick } = window.editorTest
            const base = fixtures.events.slides[0]![0]!
            const note = (beat: number, values: Partial<typeof base> = {}) => ({
                ...base,
                beat,
                ...values,
            })
            show({
                ...fixtures.events,
                slides: [
                    [
                        note(2, { connectorEase: 'inQuad' }),
                        // Attached ticks and tails carry connector values the
                        // slide never uses, as imported charts often do.
                        note(3, {
                            isAttached: true,
                            connectorEase: 'outQuad',
                            flickDirection: 'up',
                        }),
                        note(4, { connectorEase: 'outQuad', connectorLayer: 'bottom' }),
                    ],
                    [note(6, { connectorEase: 'outQuad' }), note(7)],
                ],
            })
            await nextTick()
        })
        const shown = (name: string) =>
            panel(page).getByRole('combobox', { name, exact: true }).locator('option:checked')
        const select = (beats: number[]) =>
            page.evaluate(async (beats) => {
                const { history, store, nextTick } = window.editorTest
                history.replaceState({
                    ...history.state.value,
                    selectedEntities: [...store.getAllEntities()].filter(
                        (entity) => entity.type === 'note' && beats.includes(entity.beat),
                    ),
                })
                await nextTick()
            }, beats)

        await select([2, 3, 4])
        await expect(shown('Ease')).toHaveText('Quad')
        await expect(shown('Ease Mode')).toHaveText('In')
        await expect(shown('Layer')).toHaveText('Top')
        await expect(shown('Flick Direction')).toHaveText('None')
        const listed = panel(page).getByRole('combobox', { name: 'Note Type', exact: true })
        await expect(listed.locator('option').first()).toHaveText('Default')
        await expect(
            panel(page).locator('select option', { hasText: /^\s*(Mixed)?\s*$/ }),
        ).toHaveCount(0)

        // Values that genuinely differ are still mixed.
        await select([2, 6])
        await expect(shown('Ease')).toHaveText('Quad')
        await expect(shown('Ease Mode')).toHaveText('Mixed')
    })

    test('a typed value commits when the presentation switches', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        await expect(panel(page).getByRole('tablist')).toHaveCount(0)
        const lane = page.getByLabel('Lane', { exact: true })
        await lane.fill('2')
        await expect(lane).toBeFocused()
        await page.setViewportSize({ width: 1600, height: 420 })
        await expect(panel(page).getByRole('tablist')).toBeVisible()
        await expect
            .poll(() => page.evaluate(() => window.editorTest.snapshot().selected[0]?.left))
            .toBe(2)
    })
})

test.describe('phone panel', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('a fixed section strip switches sections and keeps the chosen one', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        const tabs = panel(page).getByRole('tablist')
        await expect(tabs).toBeVisible()
        await expect(tabs.getByRole('tab')).toHaveCount(3)
        await expect(sectionTab(page, 'Selection')).toHaveAttribute('aria-selected', 'true')

        // Fields are visible and usable for the selected note.
        const lane = page.getByLabel('Lane', { exact: true })
        await expect(lane).toBeInViewport()
        await lane.fill('1')
        await lane.blur()
        await expect
            .poll(() => page.evaluate(() => window.editorTest.snapshot().selected[0]?.left))
            .toBe(1)

        await sectionTab(page, 'View').tap()
        await expect(sectionTab(page, 'View')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('combobox', { name: 'Division', exact: true })).toBeVisible()
        await expect(page.getByLabel('Lane', { exact: true })).toHaveCount(0)
        expect((await settingsOf(page)).section).toBe('view')

        // Selecting another object does not switch away from View or Tool.
        await selectNoteAt(page, 5)
        await expect(sectionTab(page, 'View')).toHaveAttribute('aria-selected', 'true')
        await sectionTab(page, 'Tool').tap()
        await selectNoteAt(page, 7)
        await expect(sectionTab(page, 'Tool')).toHaveAttribute('aria-selected', 'true')
        expect((await settingsOf(page)).section).toBe('tool')

        // Arrow, Home and End keys move along the strip.
        await sectionTab(page, 'Tool').focus()
        await page.keyboard.press('ArrowRight')
        await expect(sectionTab(page, 'View')).toBeFocused()
        await expect(sectionTab(page, 'View')).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('Home')
        await expect(sectionTab(page, 'Selection')).toBeFocused()
        await page.keyboard.press('End')
        await expect(sectionTab(page, 'View')).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('ArrowRight')
        await expect(sectionTab(page, 'Selection')).toHaveAttribute('aria-selected', 'true')
    })

    test('the Tool section falls back when the tool has no settings', async ({ page }) => {
        await open(page, { propertiesSection: 'tool' })
        await expect(sectionTab(page, 'Tool')).toHaveAttribute('aria-selected', 'true')
        await expect(panel(page).getByText('The current tool has no settings.')).toBeVisible()
        expect((await settingsOf(page)).section).toBe('tool')

        await page.evaluate(async () => {
            const { switchToolTo } =
                (await import('/src/editor/tools/index.ts')) as typeof import('../../src/editor/tools')
            switchToolTo('note')
        })
        await expect(panel(page).getByText('Default Note Properties')).toBeVisible()
        await expect(
            panel(page).getByRole('combobox', { name: 'Preset', exact: true }),
        ).toBeVisible()
    })

    test('section scroll positions survive switches and remounts', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        const body = panel(page).getByRole('tabpanel')
        await body.evaluate((element) => (element.scrollTop = 120))
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(120)

        await sectionTab(page, 'View').tap()
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
        await sectionTab(page, 'Selection').tap()
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(120)

        // Closing and reopening the panel remounts it in place.
        await page.evaluate(() => (window.editorTest.settings.showSidebar = false))
        await expect(panel(page)).toHaveCount(0)
        await page.evaluate(() => (window.editorTest.settings.showSidebar = true))
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(120)
    })

    test('the section strip raises over fields scrolled beneath it', async ({ page }) => {
        await open(page)
        await selectNoteAt(page, 3)
        const band = panel(page).locator('.properties-tabs')
        const body = panel(page).getByRole('tabpanel')
        await expect(band).not.toHaveClass(/shadow-band/)
        await body.evaluate((element) => (element.scrollTop = 120))
        await expect(band).toHaveClass(/shadow-band/)

        // A section shown at its top is not raised, and the scrolled one is again.
        await sectionTab(page, 'Tool').tap()
        await expect(band).not.toHaveClass(/shadow-band/)
        await sectionTab(page, 'Selection').tap()
        await expect(band).toHaveClass(/shadow-band/)
    })

    test('a typed value commits when another panel covers Properties without a blur', async ({
        page,
    }) => {
        await open(page, { showGroups: true })
        await selectNoteAt(page, 3)
        const lane = page.getByLabel('Lane', { exact: true })
        await lane.fill('3')
        await expect(lane).toBeFocused()
        // Like a tap on iOS Safari: the rail tab activates without taking focus.
        await page
            .locator('[data-workspace-dock="top"]')
            .getByRole('tab', { name: 'Groups', exact: true })
            .evaluate((element: HTMLElement) => element.click())
        await expect(panel(page)).toHaveCount(0)
        expect(await page.evaluate(() => window.editorTest.snapshot().selected[0]?.left)).toBe(3)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
    })
})

test.describe('landscape phone panel', () => {
    test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

    test('long translations keep tabs and fields inside the panel', async ({ page }) => {
        await open(page, { locale: 'fr' })
        await selectNoteAt(page, 3)
        await expect(panel(page).getByRole('tablist')).toBeVisible()
        const fits = () =>
            panel(page).evaluate((root) => {
                const bounds = root.getBoundingClientRect()
                const tabs = [...root.querySelectorAll<HTMLElement>('.properties-tab-label > span')]
                const controls = [...root.querySelectorAll<HTMLElement>('input, select')]
                return {
                    tabsFit: tabs.every((tab) => tab.scrollWidth <= tab.clientWidth),
                    controls: controls.length,
                    inside: controls.every((control) => {
                        const box = control.getBoundingClientRect()
                        return box.left >= bounds.left && box.right <= bounds.right + 0.5
                    }),
                    // A single 16px line inside the pill; wrapped text would grow it.
                    singleLine: controls.every(
                        (control) => control.getBoundingClientRect().height <= 36,
                    ),
                }
            })
        for (const name of ['Sélection', 'Vue']) {
            await sectionTab(page, name).tap()
            expect(await fits()).toMatchObject({ tabsFit: true, inside: true, singleLine: true })
            expect((await fits()).controls).toBeGreaterThan(0)
        }
    })
})

test('stacked section bands reach the panel edge with no reserved scrollbar gutter', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await open(page, { propertiesPosition: 'right' })
    await expect(panel(page).getByRole('tablist')).toHaveCount(0)
    const { band, scroller } = await panel(page).evaluate((element) => {
        const scroller = element.querySelector('.properties-scroller')!
        const band = scroller.querySelector('h2')!.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        return { band: band.right, scroller: box.right }
    })
    // Content that fits shows no scrollbar, so nothing should cut the band short.
    expect(band).toBeCloseTo(scroller, 0)
})

test('a pressed section tab takes the accent fill, as every pressed control does', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, { showPreview: false, propertiesSection: 'view' })
    const tool = sectionTab(page, 'Tool')
    const box = (await tool.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expect
        .poll(() =>
            tool
                .locator('.properties-tab-pill')
                .evaluate((pill) => getComputedStyle(pill).backgroundColor),
        )
        .toBe('rgb(119, 239, 220)')
    await page.mouse.up()
})

test('view selects return to the current value when a picked command is cancelled', async ({
    page,
}) => {
    await open(page, { propertiesSection: 'view' })
    const shown = (name: string) =>
        panel(page)
            .getByRole('combobox', { name, exact: true })
            .evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text.trim())
    const dialog = page.getByRole('dialog')

    const division = panel(page).getByRole('combobox', { name: 'Division', exact: true })
    await division.selectOption({ label: '1/n' })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => shown('Division')).toBe('1/4')
    await division.selectOption({ label: '1/n' })
    await dialog.getByRole('spinbutton').fill('5')
    await dialog.getByRole('spinbutton').press('Enter')
    await expect.poll(() => shown('Division')).toBe('1/5')

    // Event tools ask to enable dynamic stages first.
    const tool = panel(page).getByRole('combobox', { name: 'Tool', exact: true })
    await tool.selectOption({ label: 'Camera Event' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => shown('Tool')).toBe('Select')
    await tool.selectOption({ label: 'Eraser' })
    await expect.poll(() => shown('Tool')).toBe('Eraser')
})

test('preset and brush headings match the selection kind headings', async ({ page }) => {
    await open(page)
    await selectNoteAt(page, 3)
    const styles = (headings: import('@playwright/test').Locator) =>
        headings.evaluateAll((all) =>
            all.map((heading) => {
                const { fontSize, fontWeight, color } = getComputedStyle(heading)
                return { fontSize, fontWeight, color }
            }),
        )
    const [kind] = await styles(panel(page).locator('.properties-block-header .font-bold'))
    const headings = panel(page).locator('#properties-section-tool h3')
    await page.keyboard.press('b')
    await panel(page).getByRole('button', { name: 'Pick from Selection' }).click()
    for (const tool of ['brush', 'a', 's']) {
        if (tool !== 'brush') await page.keyboard.press(tool)
        await expect(headings.first()).toBeVisible()
        for (const style of await styles(headings)) expect(style, tool).toEqual(kind)
    }
})
