import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const boot = async (page: Page, settings: Record<string, unknown>) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript((values) => {
        for (const [key, value] of Object.entries(values))
            localStorage.setItem(`sonolus-next-sekai-editor.${key}`, JSON.stringify(value))
    }, settings)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
}

const toolDialog = (page: Page) => page.locator('.editor-tool-modal')
const selectedTab = (page: Page) =>
    page.locator('[data-workspace-dock] [role="tab"][aria-selected="true"]')

test.describe('phone with Preview covering Properties', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('tool presets and selected-note taps both open a dialog without switching tabs', async ({
        page,
    }) => {
        await boot(page, {
            showPreview: true,
            showSidebar: true,
            panelRecency: ['preview', 'properties', 'groups', 'stages'],
        })
        await page.keyboard.press('a')
        await page.keyboard.press('a')
        await expect(toolDialog(page)).toHaveCount(1)
        await expect(selectedTab(page)).toHaveText('Preview')
        await page.keyboard.press('Escape')
        await expect(toolDialog(page)).toHaveCount(0)

        const point = await page.evaluate(() => window.editorTest.point(0.5, 5))
        await page.touchscreen.tap(point.x, point.y)
        await page.touchscreen.tap(point.x, point.y)
        await expect(toolDialog(page)).toHaveCount(1)
        await expect(selectedTab(page)).toHaveText('Preview')
    })
})

test.describe('phone with a drawer', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('Escape closes the drawer before reaching editor shortcuts', async ({ page }) => {
        await boot(page, {
            propertiesPosition: 'right',
            showSidebar: true,
            panelRecency: ['properties', 'groups', 'preview', 'stages'],
        })
        await page.evaluate(() => {
            const { history } = window.editorTest
            const source = history.state.value
            history.replaceState({
                ...source,
                selectedEntities: [...source.store.slides.note.values()].flat().slice(0, 1),
            })
        })
        const body = page.locator('[data-workspace-dock="right"] .workspace-dock-body')
        await expect(body).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(body).toHaveCount(0)
        // The selection survives: Escape closed the drawer rather than deselecting.
        expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toHaveLength(1)
    })

    test('a held Escape that stops selecting groups leaves the drawer open', async ({ page }) => {
        await boot(page, {
            groupsPosition: 'right',
            showSidebar: true,
            panelRecency: ['groups', 'properties', 'preview', 'stages'],
        })
        const body = page.locator('[data-workspace-dock="right"] .workspace-dock-body')
        const list = page.locator('#workspace-panel-groups .manager-list')
        await page.getByRole('tab', { name: 'Groups', exact: true }).click()
        await expect(body).toBeVisible()
        await list.locator('.manager-name').first().focus()
        await page.keyboard.press('ControlOrMeta+a')
        await expect(list).toHaveClass(/manager-list-selecting/)
        await page.keyboard.down('Escape')
        await page.keyboard.down('Escape')
        await page.keyboard.down('Escape')
        await page.keyboard.up('Escape')
        await expect(list).not.toHaveClass(/manager-list-selecting/)
        await expect(body).toBeVisible()
        // The next press closes it.
        await page.keyboard.press('Escape')
        await expect(body).toHaveCount(0)
    })
})

test.describe('phone with a drawer being resized', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('Escape cancels the resize and leaves the drawer open', async ({ page }) => {
        await boot(page, {
            propertiesPosition: 'right',
            showSidebar: true,
            panelRecency: ['properties', 'groups', 'preview', 'stages'],
        })
        const body = page.locator('[data-workspace-dock="right"] .workspace-dock-body')
        await expect(body).toBeVisible()
        const handle = page.locator('[data-workspace-dock="right"] .resize-handle').first()
        const box = (await handle.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 3 })
        await expect(page.locator('.resize-handle.is-dragging')).toHaveCount(1)
        await page.keyboard.press('Escape')
        await expect(page.locator('.resize-handle.is-dragging')).toHaveCount(0)
        await expect(body).toBeVisible()
        await page.mouse.up()
    })
})

test('panel chrome suppresses the browser menu while text fields keep it', async ({ page }) => {
    await boot(page, { showSidebar: true })
    const prevented = (selector: string) =>
        page.evaluate((selector) => {
            const target = document.querySelector(selector)!
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
            target.dispatchEvent(event)
            return event.defaultPrevented
        }, selector)
    expect(await prevented('#workspace-panel-properties h2, #workspace-panel-properties p')).toBe(
        true,
    )
    expect(await prevented('#workspace-panel-properties input')).toBe(false)
})

test('a right click on a manager row opens its menu without toggling it closed', async ({
    page,
}) => {
    await boot(page, { showGroups: true })
    const name = page.locator('#workspace-panel-groups .manager-row .manager-name').nth(1)
    await name.click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(1)
    await name.click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
})

test.describe('touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('a long press on a manager row name opens its menu without choosing the row', async ({
        page,
        browserName,
    }) => {
        test.skip(browserName !== 'chromium', 'Touch is driven through CDP.')
        await boot(page, {
            showGroups: true,
            panelRecency: ['groups', 'preview', 'properties', 'stages'],
        })
        const name = page.locator('#workspace-panel-groups .manager-row .manager-name').nth(2)
        const before = await page
            .locator('#workspace-panel-groups [aria-current="true"]')
            .textContent()
        const box = (await name.boundingBox())!
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const client = await page.context().newCDPSession(page)
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await page.waitForTimeout(700)
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(page.getByRole('menu')).toHaveCount(1)
        expect(
            await page.locator('#workspace-panel-groups [aria-current="true"]').textContent(),
        ).toBe(before)
    })
})
