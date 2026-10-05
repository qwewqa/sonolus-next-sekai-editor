import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
})

const toolName = (page: Page) =>
    page.evaluate(async () => {
        const { toolName } = await import('/src/editor/tools/index.ts')
        return toolName.value
    })

test('deselecting with nothing selected switches to the select tool', async ({ page }) => {
    await page.keyboard.press('a')
    expect(await toolName(page)).toBe('note')
    await page.keyboard.press('Escape')
    expect(await toolName(page)).toBe('select')

    await page.evaluate(() => (window.editorTest.settings.deselectSwitchesToSelect = false))
    await page.keyboard.press('a')
    await page.keyboard.press('Escape')
    expect(await toolName(page)).toBe('note')
})

test('deselecting a selection keeps the current tool', async ({ page }) => {
    await page.keyboard.press('a')
    await page.evaluate(() => {
        const { history } = window.editorTest
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()].flat().slice(0, 1),
        })
    })
    await page.keyboard.press('Escape')
    expect(await toolName(page)).toBe('note')
    expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual([])
})

test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

    const sessions = new WeakMap<Page, CDPSession>()
    const touch = async (
        page: Page,
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        x: number,
        y: number,
    ) => {
        let client = sessions.get(page)
        if (!client) {
            client = await page.context().newCDPSession(page)
            sessions.set(page, client)
        }
        await client.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
        })
    }

    test('holding a finger still opens the context menu', async ({ page }) => {
        const { x, y } = await page.evaluate(() => window.editorTest.point(-3, 3))
        await touch(page, 'touchStart', x, y)
        await page.waitForTimeout(700)
        await expect(page.getByRole('menu')).toBeVisible()
        await touch(page, 'touchEnd', x, y)
        await expect(page.getByRole('menu')).toBeVisible()
        expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toHaveLength(1)
    })

    test('moving or disabling the option does not open the menu', async ({ page }) => {
        const { x, y } = await page.evaluate(() => window.editorTest.point(-3, 3))
        await touch(page, 'touchStart', x, y)
        await touch(page, 'touchMove', x, y + 30)
        await page.waitForTimeout(700)
        await touch(page, 'touchEnd', x, y + 30)
        await expect(page.getByRole('menu')).toHaveCount(0)

        await page.evaluate(() => (window.editorTest.settings.touchLongPressContextMenu = false))
        await touch(page, 'touchStart', x, y)
        await page.waitForTimeout(700)
        await touch(page, 'touchEnd', x, y)
        await expect(page.getByRole('menu')).toHaveCount(0)
    })
})
