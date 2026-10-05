import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const boot = async (page: Page) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
}

const tools = (page: Page) => page.locator('[data-editor-toolbar] > div > div > button')

const toolRows = (page: Page) =>
    tools(page).evaluateAll((buttons) => {
        const rects = buttons.map((button) => button.getBoundingClientRect())
        const rows = new Map<number, DOMRect[]>()
        for (const rect of rects) rows.set(rect.top, [...(rows.get(rect.top) ?? []), rect])
        return [...rows.entries()]
            .sort(([a], [b]) => a - b)
            .map(([top, row]) => ({
                top,
                count: row.length,
                size: row[0]?.width ?? 0,
                height: row[0]?.height ?? 0,
                gaps: row
                    .sort((a, b) => a.left - b.left)
                    .slice(1)
                    .map((rect, index) => Math.round(rect.left - (row[index]?.right ?? 0))),
            }))
    })

for (const { name, width, height, size } of [
    { name: 'a phone held upright', width: 390, height: 844, size: 40 },
    { name: 'a narrow phone', width: 360, height: 740, size: 37 },
    { name: 'a phone held sideways', width: 844, height: 390, size: 36 },
]) {
    test.describe(`touch toolbar on ${name}`, () => {
        test.use({ viewport: { width, height }, hasTouch: true, isMobile: true })

        test('wraps into balanced rows that use the room for larger tools', async ({ page }) => {
            await boot(page)
            const rows = await toolRows(page)
            expect(rows.length).toBeGreaterThanOrEqual(1)
            const counts = rows.map(({ count }) => count)
            // No orphans: rows differ by at most one tool.
            expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
            for (const row of rows) {
                expect(row.size).toBe(size)
                expect(row.height).toBe(size)
                // Tools sit edge to edge, across rows and along them.
                for (const gap of row.gaps) expect(gap).toBe(0)
            }
            for (const [index, row] of rows.slice(1).entries())
                expect(row.top - (rows[index]?.top ?? 0)).toBe(size)

            // The rows stay inside the canvas, clear of its corner time labels.
            const canvas = (await page.locator('canvas.editor-chart').boundingBox())!
            const last = rows.at(-1)!
            expect(last.top + size).toBeLessThanOrEqual(canvas.y + canvas.height - 24)

            // A group's flyout opens fully above its tool.
            const group = tools(page).nth(2)
            await group.tap()
            const flyout = page.locator('[data-editor-toolbar] .overflow-y-auto')
            await expect(flyout).toBeVisible()
            const box = (await flyout.boundingBox())!
            const tool = (await group.boundingBox())!
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(width)
            expect(box.y + box.height).toBeLessThanOrEqual(tool.y)
        })
    })
}

test('mouse pointers keep 32 px tools', async ({ page }) => {
    await boot(page)
    for (const row of await toolRows(page)) expect(row.size).toBe(32)
})

test.describe('notifications with a tool dialog open', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })

    test('show above the dialog instead of over its fields', async ({ page }) => {
        await boot(page)
        await page.keyboard.press('a')
        const point = await page.evaluate(() => window.editorTest.point(0.5, 5))
        await page.touchscreen.tap(point.x, point.y)
        await page.touchscreen.tap(point.x, point.y)
        const dialog = page.locator('.editor-tool-modal')
        await expect(dialog).toBeVisible()
        const toast = page.locator('.notification')
        await expect(toast).toBeVisible()
        const toastBox = (await toast.boundingBox())!
        const dialogBox = (await dialog.boundingBox())!
        expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(dialogBox.y)
    })
})
