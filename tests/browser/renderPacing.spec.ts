import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

declare global {
    interface Window {
        pacing: { ticks: number; preview: number; startOrStopPlayer: () => void }
    }
}

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        // Every preview frame clears its selection overlay first.
        const clearRect = CanvasRenderingContext2D.prototype.clearRect
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas instanceof HTMLCanvasElement) {
                if (this.canvas.classList.contains('preview-selection') && window.pacing)
                    window.pacing.preview++
            }
            return clearRect.apply(this, args)
        }
        localStorage.setItem('sonolus-next-sekai-editor.previewPosition', '"left"')
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { time } = (await import(
            urls.get('/src/time.ts')!
        )) as typeof import('../../src/time')
        const { startOrStopPlayer } = (await import(
            urls.get('/src/editor/player.ts')!
        )) as typeof import('../../src/editor/player')
        const { watch } = await import(urls.get('/node_modules/.vite/deps/vue.js')!)
        window.pacing = { ticks: 0, preview: 0, startOrStopPlayer }
        watch(time, () => window.pacing.ticks++, { flush: 'sync' })
        window.editorTest.settings.showPreview = true
    })
    await expect(page.locator('.preview-selection')).toBeVisible()
    await settle(page)
})

test('playback redraws the editor and the preview on every clock frame', async ({ page }) => {
    const result = await page.evaluate(async () => {
        window.editorTest.view.cursorTime = 1
        window.pacing.startOrStopPlayer()
        // Let the start-up delay pass so the cursor moves on every tick.
        await new Promise((resolve) => setTimeout(resolve, 300))
        const ticks = window.pacing.ticks
        const preview = window.pacing.preview
        const chart = window.editorFrames.chart
        await new Promise((resolve) => setTimeout(resolve, 1000))
        window.pacing.startOrStopPlayer()
        return {
            ticks: window.pacing.ticks - ticks,
            preview: window.pacing.preview - preview,
            chart: window.editorFrames.chart - chart,
        }
    })
    expect(result.ticks).toBeGreaterThan(20)
    // Drawing a frame late made coalescing skip every other tick (a ratio of 0.5).
    expect(result.chart / result.ticks).toBeGreaterThan(0.9)
    expect(result.preview / result.ticks).toBeGreaterThan(0.9)
})

test('dragging a dock edge scales the preview buffers and reallocates them once on release', async ({
    page,
}) => {
    const canvas = page.locator('.preview-viewport canvas').first()
    const overlay = page.locator('.preview-selection')
    const measure = (c: typeof canvas) =>
        c.evaluate((e: HTMLCanvasElement) => [e.width, e.height, e.clientWidth] as const)
    const size = async () => [await measure(canvas), await measure(overlay)] as const
    const [[width, height, cssWidth], [overlayWidth]] = await size()
    expect(width).toBeGreaterThan(0)

    const handle = page
        .locator('[data-workspace-dock="left"]')
        .getByRole('separator', { name: 'Resize Left Panels' })
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 })
    await settle(page)
    const [[dragWidth, dragHeight, dragCssWidth], [dragOverlayWidth]] = await size()
    // The displayed size follows the pointer while the buffers stay put.
    expect(dragCssWidth).toBeGreaterThan(cssWidth)
    expect([dragWidth, dragHeight, dragOverlayWidth]).toEqual([width, height, overlayWidth])

    await page.mouse.up()
    await settle(page)
    const [[endWidth, endHeight, endCssWidth], [endOverlayWidth]] = await size()
    expect(endCssWidth).toBe(dragCssWidth)
    expect(endWidth).toBeGreaterThan(width)
    expect(endHeight).toBeGreaterThan(height)
    expect(endOverlayWidth).toBeGreaterThan(overlayWidth)
})
