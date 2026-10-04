import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.use({ hasTouch: true })
const runtimeErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})
test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const selectTwo = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()].flat().slice(0, 2),
        })
    })
const openFromToolbar = async (page: Page, pane = '') => {
    const root = pane ? page.locator(pane) : page.locator('body')
    await root.locator('button[title="Help"], button[title="Open Context Menu"]').first().tap()
    await root.getByRole('button', { name: 'Open Context Menu', exact: true }).last().tap()
    await expect(page.getByRole('menu')).toBeVisible()
}

for (const viewport of [
    { width: 320, height: 480 },
    { width: 390, height: 844 },
]) {
    test(`touch toolbar opens selection actions without deselecting and fits ${viewport.width}x${viewport.height}`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize(viewport)
        await selectTwo(page)
        const before = await page.evaluate(() => window.editorTest.snapshot())
        await openFromToolbar(page)
        expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual(
            before.selected,
        )
        const menu = page.getByRole('menu')
        const box = (await menu.boundingBox())!
        expect(box.x).toBe(8)
        expect(box.x + box.width).toBe(viewport.width - 8)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBe(viewport.height - 8)
        const items = await menu
            .getByRole('menuitem')
            .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))
        expect(items.every((height) => height >= 44)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('mobile-context-menu.png') })
        const remove = menu.getByRole('menuitem', { name: 'Delete', exact: true })
        await remove.scrollIntoViewIfNeeded()
        await remove.tap()
        await expect(menu).toHaveCount(0)
        expect((await page.evaluate(() => window.editorTest.snapshot())).notes.length).toBe(
            before.notes.length - before.selected.length,
        )
        await page.keyboard.press('z')
        expect((await page.evaluate(() => window.editorTest.snapshot())).notes).toEqual(
            before.notes,
        )
    })
}

test('mobile backdrop dismisses without placing notes or changing the selection', async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await selectTwo(page)
    await page.keyboard.press('a')
    const before = await page.evaluate(() => window.editorTest.snapshot())
    await openFromToolbar(page)
    await page.touchscreen.tap(20, 40)
    await expect(page.getByRole('menu')).toHaveCount(0)
    const after = await page.evaluate(() => window.editorTest.snapshot())
    expect(after.notes).toEqual(before.notes)
    expect(after.selected).toEqual(before.selected)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('context command supports an assigned hotkey and preserves selection regardless of pointer position', async ({
    page,
}) => {
    expect(
        await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.openContextMenu),
    ).toBeUndefined()
    await selectTwo(page)
    await page.evaluate(() => {
        window.editorTest.settings.keyboardShortcuts.openContextMenu = 'F9'
    })
    const blank = await page.evaluate(() => window.editorTest.point(5, 1))
    await page.mouse.move(blank.x, blank.y)
    const before = await page.evaluate(() => window.editorTest.snapshot())
    await page.keyboard.press('F9')
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible()
    expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual(
        before.selected,
    )
    await page.keyboard.press('F9')
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes).toEqual(before.notes)
})

test('empty-caret toolbar context uses the chart beat and keeps the current editing tool', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => window.editorTest.view.w)).toBe(390)
    await page.keyboard.press('f')
    const blank = await page.evaluate(() => window.editorTest.point(5, 1.25))
    await page.touchscreen.tap(blank.x, blank.y)
    await expect.poll(() => page.evaluate(() => window.editorTest.view.cursorTime)).toBe(0.625)
    expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual([])
    await openFromToolbar(page)
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
    expect(
        await page.evaluate(
            async () => (await import('/src/editor/tools/index.ts')).toolName.value,
        ),
    ).toBe('select')
    await page.getByRole('menuitem', { name: 'Edit Elevations', exact: true }).tap()
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('2.25')
    await page.getByRole('button', { name: 'Close elevation editor', exact: true }).tap()
    expect(
        await page.evaluate(
            async () => (await import('/src/editor/tools/index.ts')).toolName.value,
        ),
    ).toBe('select')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('elevation toolbar context handles off-slice selected notes without losing them', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await selectTwo(page)
    await page.keyboard.press('t')
    await page.evaluate(() => {
        const { history } = window.editorTest
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat().find((note) => note.beat === 5)!
        history.replaceState({ ...source, selectedEntities: [note] })
    })
    await openFromToolbar(page, '.elevation-editor')
    expect(
        (await page.evaluate(() => window.editorTest.snapshot())).selected.map(
            (entity) => entity.beat,
        ),
    ).toEqual([5])
    await page.getByRole('menuitem', { name: 'Edit Elevations', exact: true }).tap()
    await expect(
        page.locator('.elevation-editor').getByRole('spinbutton', { name: 'Beat', exact: true }),
    ).toHaveValue('6')
})

test('split toolbar action targets the pane that owns the button', async ({ page }) => {
    await selectTwo(page)
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await page.keyboard.press('t')
    const main = page
        .locator('div.relative.min-w-0.flex-1.overflow-hidden')
        .filter({ has: page.locator('canvas.editor-chart') })
    await main.getByRole('button', { name: 'Help', exact: true }).hover()
    await main.getByRole('button', { name: 'Open Context Menu', exact: true }).click()
    expect(
        await page.evaluate(async () =>
            Boolean((await import('/src/editor/navigation.ts')).editorNavigation.value),
        ),
    ).toBe(false)
    await page.keyboard.press('Escape')
    await page
        .locator('.elevation-editor')
        .getByRole('button', { name: 'Help', exact: true })
        .hover()
    await page
        .locator('.elevation-editor')
        .getByRole('button', { name: 'Open Context Menu', exact: true })
        .click()
    expect(
        await page.evaluate(async () =>
            Boolean((await import('/src/editor/navigation.ts')).editorNavigation.value),
        ),
    ).toBe(true)
    await expect(page.getByRole('menu')).toBeVisible()
    expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toHaveLength(2)
})
