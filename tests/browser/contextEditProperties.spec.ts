import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Edit Properties shows the selection in the shown panel and takes focus there, else a dialog.

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const openMenu = async (page: Page, shown: boolean) => {
    const point = await page.evaluate(async (shown) => {
        const { history, fixtures, show, settings } = window.editorTest
        settings.mouseSecondaryTool = 'selectContextMenu'
        settings.showSidebar = shown
        settings.propertiesSection = 'view'
        show(fixtures.interaction, 3)
        const note = [...history.state.value.store.slides.note.values()].flat()[0]!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        // The chart takes its new width first.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return window.editorTest.point(note.left + note.size / 2, note.beat)
    }, shown)
    await page.mouse.click(point.x, point.y, { button: 'right' })
    return page.getByRole('menu').getByRole('menuitem', { name: 'Edit Properties', exact: true })
}

const focused = (page: Page) =>
    page.evaluate(() => {
        const element = document.activeElement
        return {
            tag: element?.tagName.toLowerCase(),
            inSelection: !!element?.closest('#properties-section-selection'),
            section: window.editorTest.settings.propertiesSection,
        }
    })

const expectField = async (page: Page) => {
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect.poll(async () => (await focused(page)).tag).toMatch(/^(input|select)$/)
    expect(await focused(page)).toMatchObject({ inSelection: true, section: 'selection' })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(':focus')).toBeInViewport()
}

test('a click shows the selection in the panel and focuses its first field', async ({ page }) => {
    await (await openMenu(page, true)).click()
    await expectField(page)
})

test('from the keyboard it focuses the first field too', async ({ page }) => {
    const item = await openMenu(page, true)
    await item.focus()
    await page.keyboard.press('Enter')
    await expectField(page)
})

test('without the panel it opens the dialog', async ({ page }) => {
    await (await openMenu(page, false)).click()
    await expect(page.getByRole('dialog')).toBeVisible()
})

test.describe('on a touch screen', () => {
    test.use({ hasTouch: true })

    test('a tap focuses the heading, so no on-screen keyboard opens', async ({ page }) => {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
        await (await openMenu(page, true)).click()
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect
            .poll(() => focused(page))
            .toEqual({ tag: 'h3', inSelection: true, section: 'selection' })
        await expect(page.locator(':focus')).toBeInViewport()
    })
})
