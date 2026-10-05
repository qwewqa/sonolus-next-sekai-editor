import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show, settings, history } = window.editorTest
        settings.showOtherGroups = false
        settings.showOtherObjects = false
        settings.elevationEditorSideBySide = 'allow'
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 3, left: -40, size: 2, elevation: 2 }],
                    ...Array.from({ length: 12 }, () => [
                        { ...base, beat: 3, left: 40, size: 2, elevation: 2 },
                    ]),
                    [{ ...base, beat: 3, left: 0, size: 2, elevation: 2 }],
                    [{ ...base, beat: 500, left: 40, size: 2, elevation: 2 }],
                ],
            },
            1.5,
        )
        const current = history.state.value
        history.replaceState({
            ...current,
            selectedEntities: [...current.store.slides.note.values()][0]!,
        })
    })
})

test('main editor counts offscreen notes and indicators disappear after panning or filtering', async ({
    page,
}) => {
    const editor = page.locator('.editor-chart').locator('..')
    const indicators = editor.locator('.offscreen-note-indicator')
    await expect(indicators).toHaveCount(2)
    await expect(editor.locator('[data-side="left"]')).toHaveAttribute('data-count', '1')
    await expect(editor.locator('[data-side="right"]')).toHaveAttribute('data-count', '12')
    await page.evaluate(() => {
        window.editorTest.view.lane = 40
    })
    await expect(indicators).toHaveCount(1)
    await expect(indicators).toHaveAttribute('data-side', 'left')
    await expect(indicators).toHaveAttribute('data-count', '2')
    await page.evaluate(() => {
        const { view } = window.editorTest
        view.visibilities = { ...view.visibilities, note: false }
    })
    await expect(indicators).toHaveCount(0)
})

test('elevation editor shows directional counts and stays legible on phones', async ({
    page,
}, testInfo) => {
    await page.keyboard.press('t')
    const editor = page.locator('.elevation-editor')
    await expect(editor.locator('[data-side="left"]')).toHaveAttribute('data-count', '1')
    await expect(editor.locator('[data-side="right"]')).toHaveAttribute('data-count', '12')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'disallow'
    })
    const header = await editor.locator('.elevation-header').boundingBox()
    for (const indicator of await editor.locator('.offscreen-note-indicator').all()) {
        await expect(indicator).toBeInViewport()
        const bounds = await indicator.boundingBox()
        expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
        expect(bounds!.width).toBeGreaterThan(20)
    }
    await page.screenshot({ path: testInfo.outputPath('offscreen-phone.png') })
})

test('offscreen counts follow live width previews and revert on Cancel', async ({ page }) => {
    await page.evaluate(() => {
        const { history, settings } = window.editorTest
        const current = history.state.value
        history.replaceState({
            ...current,
            selectedEntities: [...current.store.slides.note.values()].flat(),
        })
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, scaleWidth: 'F10' }
    })
    await page.keyboard.press('F10')
    await page.getByRole('spinbutton', { name: 'Scale Factor' }).fill('0.1')
    const editor = page.locator('.editor-chart').locator('..')
    await expect(editor.locator('[data-side="left"]')).toHaveAttribute('data-count', '14')
    await expect(editor.locator('[data-side="right"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor.locator('[data-side="left"]')).toHaveAttribute('data-count', '1')
    await expect(editor.locator('[data-side="right"]')).toHaveAttribute('data-count', '12')
})
