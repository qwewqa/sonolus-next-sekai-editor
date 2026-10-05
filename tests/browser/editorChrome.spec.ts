import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const boot = async (page: Page) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
}

const tools = (page: Page) => page.locator('[data-editor-toolbar] > div > div > button')

const flyout = (page: Page) => page.locator('[data-editor-toolbar] .overflow-y-auto')

const focused = (page: Page) =>
    page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        visible: document.activeElement?.matches(':focus-visible') ?? false,
    }))

test.describe('dialogs', () => {
    test('a pointer open focuses the dialog, a keyboard open its first field', async ({ page }) => {
        await boot(page)
        // Settings sits in the last group, which opens on hover.
        const box = (await tools(page).last().boundingBox())!
        await page.mouse.move(box.x + 2, box.y + 2)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 })
        await flyout(page).locator('button[title="Settings"]').click()
        const dialog = page.locator('dialog[open]')
        await expect(dialog).toBeFocused()
        expect(await focused(page)).toEqual({ tag: 'DIALOG', visible: false })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)

        await page.mouse.click(400, 300)
        await page.keyboard.press(',')
        await expect(dialog).toBeVisible()
        await expect.poll(() => focused(page)).toEqual({ tag: 'SELECT', visible: true })
    })

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

        test('keep 8px from every screen edge', async ({ page }) => {
            await boot(page)
            await page.keyboard.press(',')
            const box = (await page.locator('dialog[open]').boundingBox())!
            expect(box.x).toBe(8)
            expect(box.y).toBe(8)
            expect(box.x + box.width).toBe(390 - 8)
            expect(box.y + box.height).toBe(844 - 8)
        })
    })
})

test.describe('shortcuts', () => {
    // Listens after the editor's window listener, so it sees the final state.
    const logDefaults = (page: Page) =>
        page.evaluate(() => {
            const log: string[] = []
            ;(window as unknown as { keyLog: string[] }).keyLog = log
            addEventListener('keydown', (event) => {
                if (['Control', 'Shift'].includes(event.key)) return
                log.push(`${event.ctrlKey ? 'Control+' : ''}${event.key}:${event.defaultPrevented}`)
            })
        })
    const keyLog = (page: Page) =>
        page.evaluate(() => (window as unknown as { keyLog: string[] }).keyLog.splice(0))

    test('plain shortcut keys suppress browser defaults such as Firefox quick find', async ({
        page,
    }) => {
        await boot(page)
        await page.mouse.click(400, 300)
        await logDefaults(page)
        for (const key of ['/', "'", 'Backspace', 'l', 'Control+s']) await page.keyboard.press(key)
        // Unbound keys and browser combinations keep their defaults.
        expect(await keyLog(page)).toEqual([
            '/:true',
            "':true",
            'Backspace:true',
            'l:false',
            'Control+s:false',
        ])

        // A field outside docks and dialogs still receives its characters.
        await page.evaluate(() => document.body.append(document.createElement('input')))
        const field = page.locator('body > input')
        await field.focus()
        await page.keyboard.type("/'")
        await expect(field).toHaveValue("/'")
        expect(await keyLog(page)).toEqual(['/:false', "':false"])
    })
})

test.describe('toolbar', () => {
    test('a clicked tool keeps no focus for Space to click it again', async ({ page }) => {
        await boot(page)
        const undo = page.locator('[data-editor-toolbar] button[title="Undo"]')
        await undo.evaluate((element) => {
            const clicks = { count: 0 }
            element.addEventListener('click', () => clicks.count++)
            ;(window as unknown as { clicks: typeof clicks }).clicks = clicks
        })
        await undo.click()
        await expect(undo).not.toBeFocused()
        await page.keyboard.press(' ')
        await page.keyboard.press('Backspace')
        expect(
            await page.evaluate(() => (window as unknown as { clicks: { count: number } }).clicks),
        ).toEqual({ count: 1 })
    })
})

test.describe('toolbar flyouts', () => {
    test('Escape closes an open flyout and returns focus to its tool', async ({ page }) => {
        await boot(page)
        const first = tools(page).first()
        await first.focus()
        await page.keyboard.press('Enter')
        await expect(flyout(page)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(flyout(page)).toHaveCount(0)
        await expect(first).toBeFocused()
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })

    test.describe('on a portrait tablet', () => {
        test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })

        test('stay attached to the tool that opened them', async ({ page }) => {
            await boot(page)
            const pane = (await page.locator('[data-editor-toolbar]').boundingBox())!
            const count = await tools(page).count()
            for (const index of [0, count - 1]) {
                const tool = tools(page).nth(index)
                await tool.tap()
                await expect(flyout(page)).toBeVisible()
                const button = (await tool.boundingBox())!
                const box = (await flyout(page).boundingBox())!
                // Over the tool horizontally, rising from its top edge.
                expect(box.x).toBeLessThanOrEqual(button.x)
                expect(box.x + box.width).toBeGreaterThanOrEqual(button.x + button.width)
                expect(Math.abs(box.y + box.height - button.y)).toBeLessThan(1)
                // Never clipped by the pane.
                expect(box.x).toBeGreaterThanOrEqual(pane.x + 8)
                expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width - 8)
                await page.keyboard.press('Escape')
                await expect(flyout(page)).toHaveCount(0)
            }
        })
    })
})

test.describe('status bar on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('truncates a long group name and keeps every item on screen', async ({ page }) => {
        await boot(page)
        await page.evaluate(async () => {
            const urls = new Map(
                performance
                    .getEntriesByType('resource')
                    .map((entry) => [new URL(entry.name).pathname, entry.name]),
            )
            const path = '/src/editor/workspace/manager/groups.ts'
            const groups = (await import(
                urls.get(path) ?? path
            )) as typeof import('../../src/editor/workspace/manager/groups')
            const groupId = groups.addGroup()
            groups.renameGroup(groupId, 'A Very Long Group Name That Never Fits On A Phone')
            window.editorTest.view.groupId = groupId
        })
        const bar = page.locator('.status-chip').last().locator('..')
        await expect(bar).toContainText('A Very Long Group Name')
        const items = await bar.evaluate((element) =>
            [...element.children].map((child) => {
                const rect = child.getBoundingClientRect()
                return { left: rect.left, right: rect.right, width: rect.width }
            }),
        )
        for (const item of items) {
            expect(item.left).toBeGreaterThanOrEqual(0)
            expect(item.right).toBeLessThanOrEqual(390)
        }
        // The tool title keeps room to be read.
        expect(items[0]!.width).toBeGreaterThanOrEqual(48)
    })
})

test.describe('notifications with the elevation editor', () => {
    test('stay in the main pane beside it, off the divider', async ({ page }) => {
        await boot(page)
        await page.evaluate(() => {
            window.editorTest.settings.elevationEditorSideBySide = 'allow'
        })
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-editor')).toBeVisible()
        await page.keyboard.press('a')
        const toast = page.locator('.notification')
        await expect(toast).toBeVisible()
        const box = (await toast.boundingBox())!
        const main = (await page.locator('canvas.editor-chart').boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(main.x)
        expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width)
    })

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

        test('show below the elevation header when it replaces the editor', async ({ page }) => {
            await boot(page)
            await page.evaluate(() => {
                window.editorTest.settings.elevationEditorSideBySide = 'disallow'
            })
            await page.keyboard.press('t')
            await expect(page.locator('.elevation-editor')).toBeVisible()
            await page.keyboard.press('a')
            const toast = page.locator('.notification')
            await expect(toast).toBeVisible()
            const box = (await toast.boundingBox())!
            const header = (await page.locator('.elevation-header').boundingBox())!
            expect(box.y).toBeGreaterThanOrEqual(header.y + header.height)
        })
    })
})
