import { expect, test, type Locator, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Native scrollbars take room only when shown, which headless Chromium hides.
test.use({
    launchOptions: {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        ignoreDefaultArgs: ['--hide-scrollbars'],
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
})

const properties = (page: Page) => page.locator('#workspace-panel-properties')
const scroller = (page: Page) => properties(page).locator('.properties-scroller')
const bar = (scope: Locator) => scope.locator('.overlay-scrollbar')
const thumb = (scope: Locator) => scope.locator('.overlay-scrollbar-thumb')

const frames = (page: Page) =>
    page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )

/** Opens Properties full of a multi-kind selection. */
const open = async (page: Page, values: Record<string, unknown> = {}) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async (values) => {
        const { history, store, nextTick, fixtures, settings, show } = window.editorTest
        show(fixtures.events)
        Object.assign(settings, { showSidebar: true, ...values })
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()],
        })
        await nextTick()
    }, values)
    await expect(properties(page).locator('.form-field').first()).toBeVisible()
    await frames(page)
}

const gutter = (element: Locator) =>
    element.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth)

const overflows = (element: Locator) =>
    element.evaluate((element) => element.scrollHeight > element.clientHeight + 1)

const scrollTop = (element: Locator) => element.evaluate((element) => element.scrollTop)

/** A point on the element, from its middle outward, with no control beneath the bar. */
const clearSpot = (element: Locator) =>
    element.evaluate((element) => {
        const control = 'button, a, input, select, textarea, label, [role="button"], [tabindex]'
        const rect = element.getBoundingClientRect()
        const strip = element.closest('.overlay-scrollbar')!
        const middle = (rect.top + rect.bottom) / 2
        for (let offset = 0; offset < rect.height / 2 - 2; offset++)
            for (const y of [middle + offset, middle - offset])
                for (let x = rect.right - 1; x > rect.left; x--)
                    if (
                        !document
                            .elementsFromPoint(x, y)
                            .find((under) => !strip.contains(under))
                            ?.closest(control)
                    )
                        return { x, y }
        throw new Error('No spot clear of controls')
    })

/** Moves the pointer onto the bar's edge strip, clear of controls, which reveals it. */
const hoverEdge = async (page: Page, scope: Locator) => {
    const box = (await bar(scope).boundingBox())!
    const { x, y } = await clearSpot(bar(scope))
    await page.mouse.move(x, y)
    await expect(bar(scope)).toHaveClass(/overlay-scrollbar-active/)
    return box
}

test('stacked sections reserve no gutter and their bands reach the panel edge', async ({
    page,
}) => {
    await open(page)
    await expect(properties(page).getByRole('tablist')).toHaveCount(0)
    expect(await overflows(scroller(page))).toBe(true)
    expect(await gutter(scroller(page))).toBe(0)
    const { band, edge } = await scroller(page).evaluate((element) => ({
        band: element.querySelector('h2')!.getBoundingClientRect().right,
        edge: element.getBoundingClientRect().right,
    }))
    expect(band).toBeCloseTo(edge, 0)
})

test('section tabs reserve no gutter either', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, { showPreview: false, propertiesSection: 'selection' })
    await expect(properties(page).getByRole('tablist')).toBeVisible()
    expect(await overflows(scroller(page))).toBe(true)
    expect(await gutter(scroller(page))).toBe(0)
})

test('the bar shows while scrolling, takes no clicks, and hides when idle', async ({ page }) => {
    await open(page)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-shown/)
    const box = (await scroller(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 200)
    await expect(bar(properties(page))).toHaveClass(/overlay-scrollbar-shown/)
    // Shown by scrolling alone, the bar lets clicks reach the content beneath.
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-active/)
    const hit = await thumb(properties(page)).evaluate((thumb) => {
        const rect = thumb.getBoundingClientRect()
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 4)
        return !!target?.closest('.overlay-scrollbar')
    })
    expect(hit).toBe(false)
    await page.waitForTimeout(1300)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-shown/)
})

test('hovering the edge shows the bar until the pointer leaves', async ({ page }) => {
    await open(page)
    await hoverEdge(page, properties(page))
    await expect(bar(properties(page))).toHaveClass(/overlay-scrollbar-shown/)
    await page.waitForTimeout(1300)
    await expect(bar(properties(page))).toHaveClass(/overlay-scrollbar-shown/)
    const box = (await scroller(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-active/)
    await page.waitForTimeout(1300)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-shown/)
})

test('dragging the thumb scrolls, and clicking the track pages', async ({ page }) => {
    await open(page)
    const field = properties(page).locator('input:visible').first()
    await field.focus()
    await hoverEdge(page, properties(page))
    const start = (await thumb(properties(page)).boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 100, {
        steps: 4,
    })
    await expect(bar(properties(page))).toHaveClass(/overlay-scrollbar-dragging/)
    const dragged = await scrollTop(scroller(page))
    expect(dragged).toBeGreaterThan(100)
    const moved = (await thumb(properties(page)).boundingBox())!
    expect(moved.y - start.y).toBeCloseTo(100, 0)
    await page.mouse.up()
    // Focus stays where it was.
    await expect(field).toBeFocused()

    const strip = (await bar(properties(page)).boundingBox())!
    const clientHeight = await scroller(page).evaluate((element) => element.clientHeight)
    await page.mouse.click(strip.x + strip.width / 2, strip.y + strip.height - 8)
    await expect
        .poll(() => scrollTop(scroller(page)))
        .toBeCloseTo(dragged + clientHeight * 0.875, -1)
})

test('wheeling over the hovered bar still scrolls', async ({ page }) => {
    await open(page)
    await hoverEdge(page, properties(page))
    // The thumb, unlike the track, lies over no content to take the wheel.
    const onThumb = async () => {
        const { x, y } = await clearSpot(thumb(properties(page)))
        await page.mouse.move(x, y)
    }
    // Whether each wheel was taken from the browser.
    await page.evaluate(() => {
        const taken: boolean[] = []
        Object.assign(window, { taken })
        addEventListener('wheel', (event) => taken.push(event.defaultPrevented))
    })
    await onThumb()
    await page.mouse.wheel(0, 150)
    await expect.poll(() => scrollTop(scroller(page))).toBeGreaterThan(100)
    // Ctrl+wheel is left to the browser's zoom.
    await onThumb()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, 150)
    await page.keyboard.up('Control')
    await expect
        .poll(() => page.evaluate(() => (window as unknown as { taken: boolean[] }).taken))
        .toEqual([true, false])
})

test('a press from elsewhere or a touch passing the edge never reveals the bar', async ({
    page,
}) => {
    await open(page)
    const content = (await scroller(page).boundingBox())!
    const { x, y } = await clearSpot(bar(properties(page)))
    // A drag from the content, as when selecting text, crosses the edge.
    await page.mouse.move(content.x + content.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 4 })
    await frames(page)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-active/)
    await page.mouse.up()
    await page.mouse.move(content.x + content.width / 2, y)
    // A touch moving at the edge leaves it too.
    await scroller(page).evaluate(
        (element, { x, y }) =>
            element.dispatchEvent(
                new PointerEvent('pointermove', {
                    bubbles: true,
                    pointerType: 'touch',
                    clientX: x,
                    clientY: y,
                }),
            ),
        { x, y },
    )
    await frames(page)
    await expect(bar(properties(page))).not.toHaveClass(/overlay-scrollbar-active/)
    // A mouse there reveals it.
    await page.mouse.move(x, y)
    await expect(bar(properties(page))).toHaveClass(/overlay-scrollbar-active/)
})

test('the thumb keeps a minimum height on very long content', async ({ page }) => {
    await open(page)
    await scroller(page).evaluate((element) => {
        const filler = document.createElement('div')
        filler.style.height = '200000px'
        element.append(filler)
    })
    await hoverEdge(page, properties(page))
    await expect
        .poll(async () => (await thumb(properties(page)).boundingBox())!.height)
        .toBeCloseTo(24, 0)
})

test('forced colors keep the native scrollbar and its gutter', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await open(page, { showGroups: true })
    await expect(bar(properties(page))).toHaveCount(0)
    expect(await gutter(scroller(page))).toBeGreaterThan(0)
    // The manager list and its band reserve the same gutter.
    const groups = page.locator('#workspace-panel-groups')
    await expect(groups.locator('.manager-entry').first()).toBeVisible()
    await expect(bar(groups)).toHaveCount(0)
    expect(await gutter(groups.locator('.manager-entries'))).toBeGreaterThan(0)
    const ends = await groups.evaluate((panel) => ({
        band: panel.querySelector('.manager-all')!.getBoundingClientRect().right,
        row: panel.querySelector('.manager-entry')!.getBoundingClientRect().right,
    }))
    expect(ends.band).toBeCloseTo(ends.row, 0)
})

test('reduced motion shows and hides the bar without fading', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    expect(
        await bar(properties(page)).evaluate((bar) => getComputedStyle(bar).transitionDuration),
    ).toBe('0s')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(
        await bar(properties(page)).evaluate((bar) => getComputedStyle(bar).transitionDuration),
    ).not.toBe('0s')
})

test('a long manager list reserves no gutter, and its band lines up with the rows', async ({
    page,
}) => {
    await open(page)
    await page.evaluate(async () => {
        const { history, fixtures, settings, nextTick } = window.editorTest
        const chart = structuredClone(fixtures.notes)
        chart.groups = new Map(
            Array.from({ length: 40 }, (_, i) => [(i + 1) as never, { name: `Group ${i + 1}` }]),
        )
        history.resetState(false, chart, 0, 'groups.json')
        settings.showGroups = true
        await nextTick()
    })
    const groups = page.locator('#workspace-panel-groups')
    const list = groups.locator('.manager-entries')
    await expect(list.locator('.manager-entry').first()).toBeVisible()
    expect(await overflows(list)).toBe(true)
    expect(await gutter(list)).toBe(0)
    const ends = await groups.evaluate((panel) => ({
        band: panel.querySelector('.manager-all')!.getBoundingClientRect().right,
        row: panel.querySelector('.manager-entry')!.getBoundingClientRect().right,
    }))
    expect(ends.band).toBeCloseTo(ends.row, 0)

    const box = (await list.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 200)
    await expect(bar(groups)).toHaveClass(/overlay-scrollbar-shown/)
    // Clear of the dock's resize handle at the left dock's edge.
    const strip = await hoverEdge(page, groups)
    expect(strip.x + strip.width).toBeLessThanOrEqual(box.x + box.width - 6)
    // The thumb drags from a spot with no control beneath.
    const start = await clearSpot(thumb(groups))
    const before = await scrollTop(list)
    await page.mouse.move(start.x, start.y)
    await expect(bar(groups)).toHaveClass(/overlay-scrollbar-active/)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + 60, { steps: 3 })
    await page.mouse.up()
    const dragged = await scrollTop(list)
    expect(dragged).toBeGreaterThan(before + 60)

    // A row's menu button keeps its clicks where the strip lies over it, beside
    // the thumb or under it.
    const thumbBox = (await thumb(groups).boundingBox())!
    const buttons = await list.locator('.manager-more').evaluateAll(
        (buttons, { left, listTop }) =>
            buttons
                .map((button) => button.getBoundingClientRect())
                .filter(
                    (rect) =>
                        rect.right > left + 2 &&
                        rect.top > listTop + 8 &&
                        rect.bottom < innerHeight - 80,
                )
                .map((rect) => rect.toJSON() as DOMRect),
        { left: strip.x, listTop: box.y },
    )
    const beside = buttons.find(
        (rect) => rect.bottom < thumbBox.y || rect.top > thumbBox.y + thumbBox.height,
    )
    const under = buttons.find(
        (rect) => rect.top > thumbBox.y && rect.bottom < thumbBox.y + thumbBox.height,
    )
    for (const more of [beside, under]) {
        expect(more).toBeTruthy()
        const x = more!.right - 1
        const y = more!.y + more!.height / 2
        await page.mouse.move(x, y)
        await expect(bar(groups)).not.toHaveClass(/overlay-scrollbar-active/)
        await page.mouse.click(x, y)
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await scrollTop(list)).toBe(dragged)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
    }
})
