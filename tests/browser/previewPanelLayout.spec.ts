import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
})

test('portrait preview tab reserves space above the chart and elevation controls', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewPosition = 'auto'
        settings.previewHeight = 200
        settings.showPreview = true
        settings.elevationEditorSideBySide = 'disallow'
    })
    const tab = page.locator('.preview-panel-toggle')
    const assertBelowTab = async (selector: string) => {
        await settle(page)
        const button = (await tab.boundingBox())!
        const panel = (await page.locator(selector).boundingBox())!
        expect(button.height).toBe(16)
        expect(panel.y).toBeGreaterThanOrEqual(button.y + button.height)
        const unobscured = await page.locator(selector).evaluate((element) => {
            const rect = element.getBoundingClientRect()
            const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 8)
            return element.contains(target) || !!target?.closest('.editor')?.contains(element)
        })
        expect(unobscured).toBe(true)
    }
    await assertBelowTab('canvas.editor-chart')
    await tab.click()
    await expect(page.locator('.preview')).toHaveCount(0)
    await assertBelowTab('canvas.editor-chart')
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-editor')).toBeVisible()
    await assertBelowTab('.elevation-header')
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('7')
    await beat.press('Tab')
    await expect(beat).toHaveValue('7')
    await page.getByRole('combobox', { name: 'Elevation snapping', exact: true }).selectOption('4')
    await tab.click()
    await expect(page.locator('.preview')).toBeVisible()
    await assertBelowTab('.elevation-header')
    const before = (await page.locator('.preview').boundingBox())!
    const handle = (await tab.boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 70, { steps: 4 })
    await page.mouse.up()
    await expect
        .poll(async () => (await page.locator('.preview').boundingBox())!.height)
        .toBeGreaterThan(before.height)
    await assertBelowTab('.elevation-header')
    await page.screenshot({ path: testInfo.outputPath('portrait-preview-elevation.png') })
    await page.getByRole('button', { name: 'Close elevation editor', exact: true }).click()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await assertBelowTab('canvas.editor-chart')
})

test('left preview tab keeps its existing position and collapse behavior', async ({ page }) => {
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewPosition = 'left'
        settings.previewWidth = 350
        settings.showPreview = true
    })
    await settle(page)
    const tab = page.locator('.preview-panel-toggle')
    const preview = (await page.locator('.preview').boundingBox())!
    const chart = (await page.locator('canvas.editor-chart').boundingBox())!
    const button = (await tab.boundingBox())!
    expect(button.width).toBe(16)
    expect(button.x).toBe(preview.x + preview.width)
    expect(chart.x).toBe(button.x)
    expect(button.y + button.height / 2).toBe(preview.y + preview.height / 2)
    await tab.click()
    await expect(page.locator('.preview')).toHaveCount(0)
    await expect.poll(async () => (await tab.boundingBox())!.x).toBe(0)
    await tab.click()
    await expect(page.locator('.preview')).toBeVisible()
})
