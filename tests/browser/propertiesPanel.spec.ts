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
        await expect(shown('Ease Type')).toHaveText('In')
        await expect(shown('Ease Function')).toHaveText('Quad')
        await expect(shown('Layer')).toHaveText('Top')
        await expect(shown('Flick Direction')).toHaveText('None')
        const listed = panel(page).getByRole('combobox', { name: 'Note Type', exact: true })
        await expect(listed.locator('option').first()).toHaveText('Default')
        await expect(
            panel(page).locator('select option', { hasText: /^\s*(Mixed)?\s*$/ }),
        ).toHaveCount(0)

        // Values that genuinely differ are still mixed.
        await select([2, 6])
        await expect(shown('Ease Type')).toHaveText('Mixed')
        await expect(shown('Ease Function')).toHaveText('Quad')
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
    for (const tool of ['brush', 'note', 'slide']) {
        if (tool !== 'brush')
            await page.evaluate(async (tool) => {
                const { switchToolTo } = await import('/src/editor/tools/index.ts')
                switchToolTo(tool as 'note' | 'slide')
            }, tool)
        await expect(headings.first()).toBeVisible()
        if (tool !== 'brush')
            // The tool's title, then a heading over every group, the first included.
            await expect(headings, tool).toHaveText([
                tool === 'note' ? 'Default Note Properties' : 'Default Slide Properties',
                'Note',
                'Connector',
                'General',
            ])
        for (const style of await styles(headings)) expect(style, tool).toEqual(kind)
    }

    // The Selection's Connector disclosure shares the style beside its chevron.
    await page.evaluate(async () => {
        const { history, store, nextTick, show, fixtures } = window.editorTest
        show(fixtures.connectors)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
        })
        await nextTick()
    })
    const [connector] = await styles(panel(page).locator('.properties-subsection [id$="-heading"]'))
    expect(connector).toEqual(kind)
})

for (const width of [336, 260]) {
    test(`brush controls line up with the panel's at a ${width}px dock`, async ({ page }) => {
        await open(page, { rightDockWidth: width, propertiesCollapsed: ['selection'] })
        await selectNoteAt(page, 3)
        await page.keyboard.press('b')
        await panel(page).getByRole('button', { name: 'Pick from Selection' }).click()
        const layout = await panel(page).evaluate((panel) => {
            const lefts = (selector: string) => [
                ...new Set(
                    [
                        ...panel.querySelectorAll(
                            `${selector} .form-field-row > :not(.form-field-label)`,
                        ),
                    ].map((control) => Math.round(control.getBoundingClientRect().left)),
                ),
            ]
            const rows = [...panel.querySelectorAll('[data-brush-key]')].map((row) => {
                const text = row.querySelector('.form-field-text')!
                const range = document.createRange()
                range.selectNodeContents(text)
                return {
                    text: range.getBoundingClientRect().right,
                    remove: row
                        .querySelector('.brush-remove')!
                        .getBoundingClientRect()
                        .toJSON() as DOMRect,
                    control: row
                        .querySelector('.form-field-row > :not(.form-field-label)')!
                        .getBoundingClientRect().left,
                }
            })
            return {
                brush: lefts('[data-brush-key]'),
                view: lefts('#properties-section-view'),
                rows,
            }
        })
        expect(layout.brush).toEqual(layout.view)
        for (const row of layout.rows) {
            expect(row.remove.left).toBeGreaterThanOrEqual(row.text)
            expect(row.remove.right).toBeLessThanOrEqual(row.control)
        }
    })
}

test('controls get 10rem less the label gap at the default dock', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
        const { history, store, nextTick, show, fixtures } = window.editorTest
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()],
        })
        await nextTick()
    })
    const widths = await panel(page)
        .locator('#properties-section-selection .form-field-row > :not(.form-field-label)')
        .evaluateAll((controls) =>
            controls
                .filter((control) => control.getClientRects().length)
                .map((control) => Math.round(control.getBoundingClientRect().width)),
        )
    expect(widths.length).toBeGreaterThan(10)
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(148)
})

for (const locale of ['ja', 'fr']) {
    test(`${locale} brush buttons fit, with Add Property on its own row`, async ({ page }) => {
        await open(page, { locale, propertiesCollapsed: ['selection'], propertiesSection: 'tool' })
        await selectNoteAt(page, 3)
        await page.keyboard.press('b')
        await page.evaluate(async () => {
            const { brushProperties } = await import('/src/editor/tools/brush/index.ts')
            brushProperties.value = { size: 2 }
        })
        for (const viewport of [
            { width: 1600, height: 1000 },
            { width: 390, height: 844 },
        ]) {
            await page.setViewportSize(viewport)
            const measure = () =>
                panel(page).evaluate((panel) => {
                    const box = (selector: string) =>
                        panel.querySelector(selector)!.getBoundingClientRect().toJSON() as DOMRect
                    const add = panel.querySelector('.brush-add span')!
                    return {
                        add: box('.brush-add'),
                        pick: box('.brush-pick'),
                        clear: box('.brush-clear'),
                        addFits: add.scrollWidth <= add.clientWidth,
                    }
                })
            // The whole layout, since the panel may still be settling from the resize.
            await expect
                .poll(async () => {
                    const { add, pick, clear, addFits } = await measure()
                    return {
                        shown: pick.width > 0,
                        addFits,
                        pickBelowAdd: pick.top > add.bottom,
                        // Clear never wraps onto a line of its own.
                        clearBesidePick: Math.abs(clear.top - pick.top) < 1,
                    }
                })
                .toEqual({ shown: true, addFits: true, pickBelowAdd: true, clearBesidePick: true })
        }
    })
}

test('a kind heading never wraps its count onto a line alone', async ({ page }) => {
    await open(page, { locale: 'fr', rightDockWidth: 260 })
    await page.evaluate(async () => {
        const { history, store, nextTick, show, fixtures } = window.editorTest
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()],
        })
        await nextTick()
    })
    const lone = await panel(page)
        .locator('.properties-block-header h3')
        .evaluateAll((headings) =>
            headings.flatMap((heading) => {
                const count = heading.querySelector('.tabular-nums')
                if (!count) return []
                const range = document.createRange()
                range.selectNodeContents(count)
                const countLine = range.getBoundingClientRect()
                // Text before the count on the same line.
                range.setStart(heading, 0)
                range.setEndBefore(count)
                const before = [...range.getClientRects()].filter(
                    (rect) => rect.width > 1 && Math.abs(rect.top - countLine.top) < 2,
                )
                return before.length ? [] : [heading.textContent]
            }),
        )
    expect(lone).toEqual([])
})

test('a View value too long beside its label goes below it, as in Settings', async ({ page }) => {
    await open(page, { locale: 'fr', rightDockWidth: 336 })
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.events, 3))
    const field = (label: string) =>
        panel(page)
            .locator('#properties-section-view .form-field')
            .filter({ has: page.locator('.form-field-text').getByText(label, { exact: true }) })
    const switchTool = (name: string) =>
        page.evaluate(async (name) => {
            const { appImport, nextTick } = window.editorTest
            const tools = await appImport<typeof import('../../src/editor/tools')>(
                '/src/editor/tools/index.ts',
            )
            tools.switchToolTo(name as never)
            await nextTick()
        }, name)
    const stacked = /form-field-value-stacked/

    await expect(field('Outil')).not.toHaveClass(stacked)
    await expect(field('Groupe actuel')).toHaveClass(stacked)
    // A tool change from elsewhere refits the row.
    await switchTool('stageStyleEvent')
    await expect(field('Outil')).toHaveClass(stacked)
    await switchTool('select')
    await expect(field('Outil')).not.toHaveClass(stacked)

    // A change while View is collapsed shows correctly once it expands.
    await header(page, 'Vue').click()
    await expect(field('Outil')).toHaveCount(0)
    await switchTool('stageStyleEvent')
    await header(page, 'Vue').click()
    await expect(field('Outil')).toHaveClass(stacked)
})

test('selects show their value on hover', async ({ page }) => {
    await open(page)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.notes, 3))
    const mismatched = () =>
        page.locator('select:not(.brush-add select)').evaluateAll((selects) =>
            (selects as HTMLSelectElement[])
                .filter((select) => select.getClientRects().length)
                .flatMap((select) => {
                    const text = select.selectedOptions[0]?.textContent.trim() ?? ''
                    return select.title === text ? [] : [`${text} != ${select.title}`]
                }),
        )
    const count = () =>
        page
            .locator('select')
            .evaluateAll(
                (selects) => selects.filter((select) => select.getClientRects().length).length,
            )

    // All Groups/Stages and a selection whose values differ.
    await page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        await nextTick()
    })
    await expect(panel(page).getByRole('combobox').first()).toBeVisible()
    expect(await count()).toBeGreaterThan(5)
    expect(await panel(page).locator('select[title="Mixed"]').count()).toBeGreaterThan(0)
    await expect(panel(page).locator('select[title="All Groups"]')).toHaveCount(1)
    expect(await mismatched()).toEqual([])

    await page.evaluate(() => (window.editorTest.settings.locale = 'fr'))
    await expect(panel(page).locator('select[title="Tous les groupes"]')).toHaveCount(1)
    expect(await mismatched()).toEqual([])

    // A pick that is turned down shows the held value again.
    const division = panel(page).getByRole('combobox', { name: 'Division', exact: true })
    await division.selectOption({ label: '1/n' })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Fermer' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(division).toHaveAttribute('title', '1/4')
    expect(await mismatched()).toEqual([])

    // The preview panel's selects too.
    await page.evaluate(() =>
        Object.assign(window.editorTest.settings, {
            showPreview: true,
            leftDockCollapsed: false,
            previewPosition: 'left',
            previewControls: 'expanded',
        }),
    )
    await expect(page.locator('select[aria-labelledby$="-transport"]')).toBeVisible()
    expect(await mismatched()).toEqual([])

    // And the elevation editor's.
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-select select')).toHaveAttribute('title', /./)
    expect(await mismatched()).toEqual([])
})

// Brushing selects what it brushes, which resizes the Selection section above.
const brushKeepsToolSection = async (page: Page, scrolled: boolean) => {
    // Scrolling from a resize observer would loop the scroller's observers.
    page.on('pageerror', (error) => {
        throw error
    })
    // Four notes in a row across the chart, clear of the toolbar.
    const chart = (await page.locator('canvas.editor-chart').boundingBox())!
    const toolbarTop = (await page.locator('[data-editor-toolbar] button').first().boundingBox())!.y
    const y = (Math.max(chart.y, 0) + toolbarTop) / 2
    await page.evaluate(async (y) => {
        const { show, fixtures, point, nextTick } = window.editorTest
        show({ ...fixtures.interaction, slides: [] }, 3)
        const beat = (point(0, 0).y - y) / (point(0, 0).y - point(0, 1).y)
        const note = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [-7, -3, 1, 5].map((left) => [{ ...note, beat, left, size: 2 }]),
            },
            3,
        )
        const { switchToolTo } = await import('/src/editor/tools/index.ts')
        switchToolTo('brush')
        await nextTick()
    }, y)
    await expect(panel(page).getByRole('tablist')).toHaveCount(0)
    const heading = panel(page).getByText('Brush Properties', { exact: true })
    await expect(heading).toBeVisible()
    if (scrolled)
        // The Brush near the top, with the Selection above it out of view.
        await panel(page)
            .locator('.properties-scroller')
            .evaluate((scroller) => {
                const tool = scroller.querySelector('[data-properties-section="tool"]')!
                scroller.scrollTop +=
                    tool.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
            })
    const top = async () => (await heading.boundingBox())!.y
    const before = await top()

    const start = { x: (await page.evaluate(() => window.editorTest.point(-8, 0))).x, y: y - 12 }
    const end = { x: (await page.evaluate(() => window.editorTest.point(8, 0))).x, y: y + 12 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(
            start.x + ((end.x - start.x) * step) / 6,
            start.y + ((end.y - start.y) * step) / 6,
        )
        await page.evaluate(() => new Promise(requestAnimationFrame))
        expect(Math.abs((await top()) - before), `step ${step}`).toBeLessThan(3)
    }
    await page.mouse.up()
    await expect
        .poll(() => page.evaluate(() => window.editorTest.snapshot().selected.length))
        .toBe(4)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    expect(Math.abs((await top()) - before)).toBeLessThan(3)
}

test('the Brush keeps its place in the panel while brushing selects notes', async ({ page }) => {
    await open(page)
    await brushKeepsToolSection(page, false)

    // Once the panel is used, a smaller selection leaves no blank room below.
    await panel(page).getByText('Brush Properties', { exact: true }).click()
    await page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((entity) => entity.type === 'bpm'),
        })
        await nextTick()
    })
    const scroller = panel(page).locator('.properties-scroller')
    await expect
        .poll(() =>
            scroller.evaluate((element) => {
                const view = element.querySelector('[data-properties-section="view"]')!
                const blank =
                    element.getBoundingClientRect().bottom - view.getBoundingClientRect().bottom
                return element.scrollTop > 0 && blank > 1
            }),
        )
        .toBe(false)

    await brushKeepsToolSection(page, true)
})

test.describe('phone sheet', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('the Brush keeps its place in a tall panel while brushing', async ({ page }) => {
        await open(page, { showPreview: false, topDockHeight: 2000 })
        await brushKeepsToolSection(page, false)
    })
})
