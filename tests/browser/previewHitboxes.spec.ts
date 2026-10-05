import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

declare global {
    interface Window {
        hitboxTest: { frames: number; vertices: number; uploads: number }
    }
}

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const vertices = async (page: Page) => {
    await settle(page)
    return page.evaluate(() => window.hitboxTest.vertices)
}

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.hitboxTest = { frames: 0, vertices: 0, uploads: 0 }
        const clear = WebGLRenderingContext.prototype.clear
        WebGLRenderingContext.prototype.clear = function (...args) {
            window.hitboxTest.frames++
            window.hitboxTest.vertices = 0
            return clear.apply(this, args)
        }
        const bufferSubData = WebGLRenderingContext.prototype.bufferSubData
        WebGLRenderingContext.prototype.bufferSubData = function (...args) {
            const data = args[2]
            if (data instanceof Float32Array) window.hitboxTest.vertices += data.length
            return bufferSubData.apply(this, args)
        }
        const upload = WebGLRenderingContext.prototype.texImage2D
        WebGLRenderingContext.prototype.texImage2D = function (...args: unknown[]) {
            if (args.some((arg) => arg instanceof ImageBitmap)) window.hitboxTest.uploads++
            return Reflect.apply(upload, this, args)
        }
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show, view, settings } = window.editorTest
        settings.showPreview = true
        settings.previewShowEffects = false
        // A tap at beat 6 is judged at the paused cursor.
        show(
            {
                ...fixtures.interaction,
                slides: [[{ ...fixtures.interaction.slides[0]![0]!, beat: 6 }]],
            },
            3,
        )
        view.cursorTime = 3
    })
    await expect(
        page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
    ).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.hitboxTest.uploads)).toBe(2)
})

test('show hitboxes redraws immediately, persists and adds no history', async ({ page }) => {
    const toggle = page.locator('.preview-controls').getByLabel('Show Hitboxes', { exact: true })
    await expect(toggle).not.toBeChecked()
    expect(await page.evaluate(() => window.editorTest.settings.previewShowHitboxes)).toBe(false)
    const plain = await vertices(page)
    expect(plain).toBeGreaterThan(0)

    const frames = await page.evaluate(() => window.hitboxTest.frames)
    await toggle.check()
    await expect.poll(() => page.evaluate(() => window.hitboxTest.frames)).toBeGreaterThan(frames)
    const overlaid = await vertices(page)
    // Six bounds lines and eight target quads, each six vertices of ten floats.
    expect(overlaid - plain).toBe(14 * 6 * 10)
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.previewShowHitboxes'),
        ),
    ).toBe('true')

    await toggle.uncheck()
    expect(await vertices(page)).toBe(plain)
    await toggle.check()
    expect(await vertices(page)).toBe(overlaid)

    // Neither the chart nor its resources change.
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    expect(await page.evaluate(() => window.hitboxTest.uploads)).toBe(2)

    await page.reload()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.showPreview = true
    })
    await expect(
        page.locator('.preview-controls').getByLabel('Show Hitboxes', { exact: true }),
    ).toBeChecked()
    expect(await page.evaluate(() => window.editorTest.settings.previewShowHitboxes)).toBe(true)
})

test('the preview popup and global settings share the hitbox option', async ({ page }) => {
    const toggle = page.locator('.preview-controls').getByLabel('Show Hitboxes', { exact: true })
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    const field = dialog
        .locator('label')
        .filter({ has: page.getByText('Show Hitboxes', { exact: true }) })
        .getByRole('button')
    await expect(field).toHaveValue('Disabled')
    const plain = await vertices(page)
    await field.click()
    await expect(field).toHaveValue('Enabled')
    await expect(toggle).toBeChecked()
    expect(await vertices(page)).toBeGreaterThan(plain)
    await page.keyboard.press('Escape')
    await toggle.uncheck()
    await page.keyboard.press(',')
    await expect(field).toHaveValue('Disabled')
    expect(await vertices(page)).toBe(plain)

    // Reset Settings turns it off again.
    await field.click()
    await expect(field).toHaveValue('Enabled')
    await dialog.getByRole('button', { name: 'Reset Settings', exact: true }).click()
    await expect(field).toHaveValue('Disabled')
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.previewShowHitboxes'),
        ),
    ).toBeNull()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
