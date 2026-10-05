import { expect, test, type Locator, type Page } from '@playwright/test'
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

const selectedCount = (page: Page) =>
    page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)

const center = async (indicator: Locator) => {
    const bounds = (await indicator.boundingBox())!
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

const clickIndicator = async (page: Page, indicator: Locator, ctrl = false) => {
    const { x, y } = await center(indicator)
    await page.mouse.move(x, y)
    if (ctrl) await page.keyboard.down('Control')
    await page.mouse.click(x, y)
    if (ctrl) await page.keyboard.up('Control')
}

test('select tool clicks select the notes behind a badge, with Ctrl toggling', async ({
    page,
}, testInfo) => {
    const editor = page.locator('.editor-chart').locator('..')
    const left = editor.locator('[data-side="left"]')
    const right = editor.locator('[data-side="right"]')
    const canUndo = () => page.evaluate(() => window.editorTest.history.canUndo.value)
    expect(await canUndo()).toBe(false)

    const { x, y } = await center(right)
    // The far edge of the badge is still inside its hit area.
    const bounds = (await right.boundingBox())!
    await page.mouse.move(bounds.x + 1, y)
    await expect(editor).toHaveCSS('cursor', 'pointer')
    await page.mouse.move(x, y)
    await expect(editor).toHaveCSS('cursor', 'pointer')
    await expect(right).toHaveClass(/is-hovered/)
    await expect(left).not.toHaveClass(/is-hovered/)
    await page.screenshot({ path: testInfo.outputPath('offscreen-select-hover-desktop.png') })

    await page.mouse.click(x, y)
    expect(await selectedCount(page)).toBe(12)
    await expect(page.locator('.notification')).toHaveText('Selected 12 objects')
    await expect(right).toHaveClass(/border-white(\s|$)/)

    await clickIndicator(page, left, true)
    expect(await selectedCount(page)).toBe(13)
    await clickIndicator(page, left, true)
    expect(await selectedCount(page)).toBe(12)
    await clickIndicator(page, left)
    expect(await selectedCount(page)).toBe(1)
    // Selection changes never add undo steps.
    expect(await canUndo()).toBe(false)

    // Away from the badge the select tool behaves as before.
    await page.mouse.move(x - 120, y)
    await expect(editor).toHaveCSS('cursor', 'default')
    await expect(right).not.toHaveClass(/is-hovered/)
})

test('Shift extends a badge selection to the whole slides', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 2, left: 0, size: 2 },
                        { ...base, beat: 3, left: 40, size: 2 },
                    ],
                ],
            },
            1.5,
        )
    })
    const right = page.locator('.editor-chart').locator('..').locator('[data-side="right"]')
    await expect(right).toHaveAttribute('data-count', '1')
    const { x, y } = await center(right)
    await page.mouse.move(x, y)
    await page.keyboard.down('Shift')
    await page.mouse.click(x, y)
    await page.keyboard.up('Shift')
    expect(await selectedCount(page)).toBe(2)
    await page.mouse.click(x, y)
    expect(await selectedCount(page)).toBe(1)
})

test('pressing and dragging from a badge box-selects instead', async ({ page }) => {
    const editor = page.locator('.editor-chart').locator('..')
    const right = editor.locator('[data-side="right"]')
    const { x, y } = await center(right)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 100, y + 60, { steps: 5 })
    await expect(editor).toHaveCSS('cursor', 'crosshair')
    await page.mouse.up()
    expect(await selectedCount(page)).toBe(0)
})

for (const dimming of ['type', 'group'] as const) {
    test(`notes dimmed by ${dimming} are counted but cannot be selected from their badge`, async ({
        page,
    }) => {
        await page.evaluate((dimming) => {
            const { view, settings } = window.editorTest
            if (dimming === 'type') {
                settings.showOtherObjects = true
                view.visibilities = { ...view.visibilities, note: false }
            } else {
                settings.showOtherGroups = true
                view.groupId = 2 as typeof view.groupId
            }
        }, dimming)
        const editor = page.locator('.editor-chart').locator('..')
        const right = editor.locator('[data-side="right"]')
        await expect(right).toHaveAttribute('data-count', '12')
        await expect(right).toHaveAttribute('data-selectable', '0')
        const { x, y } = await center(right)
        await page.mouse.move(x, y)
        await expect(editor).toHaveCSS('cursor', 'default')
        await expect(right).not.toHaveClass(/is-hovered/)
        await page.mouse.click(x, y)
        expect(await selectedCount(page)).toBe(0)
    })
}

test('other tools ignore the badges', async ({ page }) => {
    const editor = page.locator('.editor-chart').locator('..')
    const right = editor.locator('[data-side="right"]')
    const notes = () => page.evaluate(() => window.editorTest.snapshot().notes.length)
    const before = await notes()
    await page.keyboard.press('a')
    const { x, y } = await center(right)
    await page.mouse.move(x, y)
    await expect(right).not.toHaveClass(/is-hovered/)
    await page.mouse.click(x, y)
    expect(await notes()).toBe(before + 1)
})

test('elevation editor badges select their notes too', async ({ page }) => {
    await page.keyboard.press('t')
    const pane = page.locator('.elevation-editor')
    const editor = pane.locator('.editor')
    const left = pane.locator('[data-side="left"]')
    const right = pane.locator('[data-side="right"]')
    await expect(right).toHaveAttribute('data-count', '12')
    const { x, y } = await center(right)
    await page.mouse.move(x, y)
    await expect(editor).toHaveCSS('cursor', 'pointer')
    await expect(right).toHaveClass(/is-hovered/)
    await page.mouse.click(x, y)
    expect(await selectedCount(page)).toBe(12)
    await clickIndicator(page, left, true)
    expect(await selectedCount(page)).toBe(13)
    await clickIndicator(page, left, true)
    expect(await selectedCount(page)).toBe(12)
})

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('badges show the hover state at phone size', async ({ page }, testInfo) => {
        const editor = page.locator('.editor-chart').locator('..')
        const right = editor.locator('[data-side="right"]')
        await expect(right).toBeVisible()
        const { x, y } = await center(right)
        await page.mouse.move(x, y)
        await expect(editor).toHaveCSS('cursor', 'pointer')
        await expect(right).toHaveClass(/is-hovered/)
        await page.screenshot({ path: testInfo.outputPath('offscreen-select-hover-phone.png') })
    })

    test.describe('touch', () => {
        test.use({ hasTouch: true })

        test('tapping a badge selects its notes', async ({ page }) => {
            const editor = page.locator('.editor-chart').locator('..')
            const right = editor.locator('[data-side="right"]')
            const { x, y } = await center(right)
            await page.touchscreen.tap(x, y)
            await expect.poll(() => selectedCount(page)).toBe(12)
            await expect(right).not.toHaveClass(/is-hovered/)
        })
    })
})
