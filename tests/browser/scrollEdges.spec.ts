import { expect, test, type Locator } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const edges = (locator: Locator) =>
    locator.evaluate((element) => ({
        before: element.hasAttribute('data-scroll-before'),
        after: element.hasAttribute('data-scroll-after'),
        mask: getComputedStyle(element).maskImage || getComputedStyle(element).webkitMaskImage,
    }))

test('scrollable dialog bodies fade only toward hidden content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.keyboard.press(',')
    const body = page.getByRole('dialog').locator('.scroll-edges')
    await expect(body).toBeVisible()
    const height = await body.evaluate((element) => element.clientHeight)

    expect(await edges(body)).toMatchObject({ before: false, after: true })
    expect((await edges(body)).mask).not.toBe('none')

    await body.evaluate((element) => element.scrollTo(0, element.scrollHeight / 2))
    await expect.poll(() => edges(body)).toMatchObject({ before: true, after: true })

    await body.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => edges(body)).toMatchObject({ before: true, after: false })

    // The fade is a mask: it never changes the scroller's size.
    expect(await body.evaluate((element) => element.clientHeight)).toBe(height)
})

test('content that fits shows no fade', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.evaluate(() => (window.editorTest.settings.groupsPosition = 'disabled'))
    await page.keyboard.press('e')
    const body = page.getByRole('dialog').locator('.scroll-edges')
    await expect(body).toBeVisible()
    expect(await edges(body)).toMatchObject({ before: false, after: false, mask: 'none' })
})

test('menus fade their items without fading their own chrome on short screens', async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 240 })
    await page.evaluate(() => (window.editorTest.settings.showGroups = true))
    await page
        .locator('.manager-entry')
        .first()
        .getByRole('button', { name: /More Actions/ })
        .click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const items = menu.locator('.scroll-edges')
    expect(await menu.evaluate((element) => getComputedStyle(element).maskImage)).toBe('none')
    await expect.poll(() => edges(items)).toMatchObject({ after: true })
})

test('the fade reaches past the gap between rows, so a clip at a gap still shows it', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
        const { history, store, settings } = window.editorTest
        Object.assign(settings, {
            showPreview: false,
            showGroups: false,
            showStages: false,
            showSidebar: true,
            propertiesSection: 'selection',
        })
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
    })
    const scroller = page.locator('.properties-scroller')
    await expect.poll(() => edges(scroller)).toMatchObject({ after: true })
    const { fade, gap } = await scroller.evaluate((element) => {
        const rows = [...element.querySelectorAll('.form-field')].map((row) =>
            row.getBoundingClientRect(),
        )
        const gaps = rows.slice(1).map((row, i) => row.top - rows[i]!.bottom)
        return {
            fade:
                parseFloat(getComputedStyle(element).getPropertyValue('--scroll-fade')) *
                parseFloat(getComputedStyle(document.documentElement).fontSize),
            gap: Math.min(...gaps.filter((gap) => gap > 0)),
        }
    })
    expect(gap).toBeGreaterThan(0)
    expect(fade).toBeGreaterThanOrEqual(gap * 1.5)
})
