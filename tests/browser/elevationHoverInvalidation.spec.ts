import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        elevationHoverFrames: number
    }
}

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const frames = (page: Page) => page.evaluate(() => window.elevationHoverFrames)

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.elevationHoverFrames = 0
        const clear = CanvasRenderingContext2D.prototype.clearRect
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (
                this.canvas instanceof HTMLCanvasElement &&
                this.canvas.classList.contains('elevation-canvas')
            )
                window.elevationHoverFrames++
            return clear.apply(this, args)
        }
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, settings, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 3, left: -4, size: 2, elevation: 0 }],
                    [{ ...base, beat: 3, left: -4, size: 2, elevation: 2 }],
                    [{ ...base, beat: 3, left: 2, size: 2, elevation: 4 }],
                ],
            },
            3,
        )
        settings.elevationEditorSideBySide = 'allow'
        settings.showPreview = false
        settings.showSidebar = false
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('select')
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await settle(page)
})

test('moving over empty main-canvas space does not redraw the Elevation pane', async ({ page }) => {
    const box = (await page.locator('canvas.editor-chart').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.view.entities.hovered)).toEqual([])
    const before = await frames(page)
    for (let i = 1; i <= 10; i++) {
        await page.mouse.move(x + i, y)
        await settle(page)
    }
    expect(await frames(page)).toBe(before)
})

test('main-canvas overlap changes redraw all hover highlights while stable hits remain cached', async ({
    page,
}) => {
    const point = await page.evaluate(() => window.editorTest.point(-3, 3))
    await page.mouse.move(point.x, point.y - 70)
    await settle(page)
    const before = await frames(page)
    await page.mouse.move(point.x, point.y)
    await settle(page)
    expect(
        await page.evaluate(() =>
            window.editorTest.view.entities.hovered
                .filter((entity) => entity.type === 'note')
                .map((note) => note.elevation),
        ),
    ).toEqual([0, 2])
    expect(await frames(page)).toBeGreaterThan(before)
    const highlighted = await frames(page)
    await page.mouse.move(point.x + 1, point.y)
    await settle(page)
    expect(await frames(page)).toBe(highlighted)
    await page.mouse.move(point.x, point.y - 70)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.view.entities.hovered)).toEqual([])
    expect(await frames(page)).toBeGreaterThan(highlighted)
})
