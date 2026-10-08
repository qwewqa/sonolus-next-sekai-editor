import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.use({ viewport: { width: 1920, height: 1080 } })

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

/** One note at beat 8, lane 0, shown `fraction` of the way down the chart. */
const showNote = (page: Page, fraction: number) =>
    page.evaluate(async (fraction) => {
        const { fixtures, show, view, settings, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        settings.dragToPanY = true
        settings.pps = 200
        show(
            {
                ...fixtures.interaction,
                slides: [[{ ...template, beat: 8, left: -1, size: 2, isAttached: false }]],
            },
            0,
        )
        view.time = 4 + ((fraction - 0.5) * view.h) / settings.pps
        await nextTick()
    }, fraction)

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(([lane, beat]) => window.editorTest.point(lane, beat), [lane, beat] as const)
const viewTime = (page: Page) => page.evaluate(() => window.editorTest.view.time)
const beats = (page: Page) =>
    page.evaluate(() => window.editorTest.snapshot().notes.map(({ beat }) => beat))

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
    await page.keyboard.press('a')
})

test('a drag starting in the bottom pan zone keeps the view still until it goes deeper', async ({
    page,
}) => {
    await showNote(page, 0.875)
    await settle(page)
    const before = await viewTime(page)
    const start = await point(page, 0, 8)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y - 25, { steps: 3 })
    await page.waitForTimeout(300)
    expect(await viewTime(page)).toBe(before)
    const end = await point(page, 0, 10)
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    await page.mouse.up()
    expect(await viewTime(page)).toBe(before)
    expect(await beats(page)).toEqual([10])
})

test('a drag starting in the bottom pan zone pans once deeper than its start', async ({ page }) => {
    await showNote(page, 0.875)
    await settle(page)
    const before = await viewTime(page)
    const start = await point(page, 0, 8)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y - 25, { steps: 3 })
    await page.mouse.move(start.x, start.y + 40, { steps: 3 })
    await expect.poll(() => viewTime(page)).toBeLessThan(before)
    await page.mouse.up()
})

test('a drag entering the bottom pan zone from outside pans', async ({ page }) => {
    await showNote(page, 0.5)
    await settle(page)
    const before = await viewTime(page)
    const start = await point(page, 0, 8)
    const bottom = await page.evaluate(() => {
        const { view } = window.editorTest
        return view.y + view.h * 0.92
    })
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, bottom, { steps: 5 })
    await expect.poll(() => viewTime(page)).toBeLessThan(before)
    await page.mouse.up()
})

test('a drag starting in the right pan zone keeps the view still until it goes deeper', async ({
    page,
}) => {
    await showNote(page, 0.5)
    // Lane 0 sits 87.5% across the chart.
    const before = await page.evaluate(() => {
        const { settings, view } = window.editorTest
        settings.dragToPanY = false
        settings.dragToPanX = true
        settings.maxScrollX = 10
        view.lane = -settings.width * 0.375
        return view.lane
    })
    await settle(page)
    const viewLane = () => page.evaluate(() => window.editorTest.view.lane)
    const start = await point(page, 0, 8)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 25, start.y, { steps: 3 })
    await page.waitForTimeout(300)
    expect(await viewLane()).toBe(before)
    await page.mouse.move(start.x + 40, start.y, { steps: 3 })
    await expect.poll(viewLane).toBeGreaterThan(before)
    await page.mouse.up()
})

test.describe('with touch', () => {
    test.use({ hasTouch: true })

    test('a touch drag starting in the bottom pan zone keeps the view still', async ({ page }) => {
        const client = await page.context().newCDPSession(page)
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
            client.send('Input.dispatchTouchEvent', {
                type,
                touchPoints: points.map(([x, y], id) => ({ x, y, id })),
            })
        await showNote(page, 0.875)
        await settle(page)
        const before = await viewTime(page)
        const start = await point(page, 0, 8)
        await touch('touchStart', [[start.x, start.y]])
        for (let step = 1; step <= 3; step++)
            await touch('touchMove', [[start.x, start.y - (25 * step) / 3]])
        await page.waitForTimeout(300)
        expect(await viewTime(page)).toBe(before)
        const end = await point(page, 0, 10)
        for (let step = 1; step <= 5; step++)
            await touch('touchMove', [
                [start.x, start.y - 25 + ((end.y - start.y + 25) * step) / 5],
            ])
        await settle(page)
        await touch('touchEnd', [])
        await settle(page)
        expect(await viewTime(page)).toBe(before)
        expect(await beats(page)).toEqual([10])
    })
})
