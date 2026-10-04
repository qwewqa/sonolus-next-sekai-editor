import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

test.use({ isMobile: true, hasTouch: true })

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

for (const { width, height } of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
]) {
    for (const split of [false, true]) {
        test(
            'top preview tab shares the title row at ' +
                width +
                'px (' +
                (split ? 'split' : 'replacement') +
                ')',
            async ({ page }, testInfo) => {
                await page.setViewportSize({ width, height })
                await page.evaluate((split) => {
                    const { settings } = window.editorTest
                    settings.previewPosition = 'top'
                    settings.previewHeight = 200
                    settings.showPreview = true
                    settings.elevationEditorSideBySide = split ? 'allow' : 'disallow'
                }, split)
                const tab = page.locator('.preview-panel-toggle')
                await page.keyboard.press('t')
                await expect(page.locator('.elevation-editor')).toBeVisible()
                const assertClear = async () => {
                    await settle(page)
                    const button = (await tab.boundingBox())!
                    const header = (await page.locator('.elevation-header').boundingBox())!
                    expect(button.height).toBe(16)
                    expect(button.y).toBe(header.y)
                    for (const control of [
                        page.getByRole('spinbutton', { name: 'Beat', exact: true }),
                        page.getByRole('combobox', { name: 'Elevation snapping', exact: true }),
                        page.getByRole('button', { name: 'Close elevation editor', exact: true }),
                    ]) {
                        const box = (await control.boundingBox())!
                        expect(
                            button.x + button.width <= box.x ||
                                box.x + box.width <= button.x ||
                                button.y + button.height <= box.y ||
                                box.y + box.height <= button.y,
                        ).toBe(true)
                        expect(
                            await control.evaluate((element) => {
                                const r = element.getBoundingClientRect()
                                return element.contains(
                                    document.elementFromPoint(
                                        r.x + r.width / 2,
                                        r.y + r.height / 2,
                                    ),
                                )
                            }),
                        ).toBe(true)
                    }
                    const title = (await page.locator('.elevation-header strong').boundingBox())!
                    expect(title.x + title.width).toBeLessThanOrEqual(button.x)
                    const beat = (await page
                        .getByRole('spinbutton', { name: 'Beat', exact: true })
                        .boundingBox())!
                    const snap = (await page
                        .getByRole('combobox', { name: 'Elevation snapping', exact: true })
                        .boundingBox())!
                    expect(beat.height).toBe(snap.height)
                    expect(snap.y === beat.y || snap.x === beat.x).toBe(true)
                    for (const box of [beat, snap]) {
                        expect(box.x).toBeGreaterThanOrEqual(header.x)
                        expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width)
                    }
                    if (!split) {
                        expect(
                            await page
                                .locator('.elevation-header strong')
                                .evaluate((element) => element.scrollWidth <= element.clientWidth),
                        ).toBe(true)
                    }
                }
                await assertClear()
                await tab.click()
                await expect(page.locator('.preview')).toHaveCount(0)
                await assertClear()
                await page.getByRole('spinbutton', { name: 'Beat', exact: true }).fill('7')
                await page.getByRole('spinbutton', { name: 'Beat', exact: true }).press('Tab')
                await page
                    .getByRole('combobox', { name: 'Elevation snapping', exact: true })
                    .selectOption('4')
                await tab.click()
                await expect(page.locator('.preview')).toBeVisible()
                const before = (await page.locator('.preview').boundingBox())!
                const handle = (await tab.boundingBox())!
                await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
                await page.mouse.down()
                await page.mouse.move(handle.x + handle.width / 2, handle.y + 70, { steps: 4 })
                await page.mouse.up()
                await expect
                    .poll(async () => (await page.locator('.preview').boundingBox())!.height)
                    .toBeGreaterThan(before.height)
                await assertClear()
                await page.screenshot({
                    path: testInfo.outputPath('compact-preview-elevation.png'),
                    style: '.notification { visibility:hidden }',
                })
                await page
                    .getByRole('button', { name: 'Close elevation editor', exact: true })
                    .click()
                await expect(page.locator('canvas.editor-chart')).toBeVisible()
            },
        )
    }
}

test('left preview tab keeps its existing position and collapse behavior', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 844, height: 390 })
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
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-editor')).toBeVisible()
    const beat = (await page.getByRole('spinbutton', { name: 'Beat', exact: true }).boundingBox())!
    const snap = (await page
        .getByRole('combobox', { name: 'Elevation snapping', exact: true })
        .boundingBox())!
    expect(beat.height).toBe(snap.height)
    expect(beat.y).toBe(snap.y)
    await page.screenshot({
        path: testInfo.outputPath('landscape-elevation.png'),
        style: '.notification { visibility:hidden }',
    })
})
