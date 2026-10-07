import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

const prefix = 'sonolus-next-sekai-editor.'
const panelKeys = [
    'showPreview',
    'showSidebar',
    'showGroups',
    'showStages',
    'panelRecency',
    'leftDockCollapsed',
    'rightDockCollapsed',
    'topDockCollapsed',
]

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

const dock = (page: Page, side: 'left' | 'right' | 'top') =>
    page.locator(`[data-workspace-dock="${side}"]`)

const tab = (page: Page, side: 'left' | 'right' | 'top', name: string) =>
    dock(page, side).getByRole('tab', { name, exact: true })

const stored = (page: Page) =>
    page.evaluate(
        ({ prefix, keys }) =>
            Object.fromEntries(
                keys.flatMap((key) => {
                    const value = localStorage.getItem(prefix + key)
                    return value === null ? [] : [[key, JSON.parse(value) as unknown]]
                }),
            ),
        { prefix, keys: panelKeys },
    )

const expectShown = async (
    page: Page,
    side: 'left' | 'top',
    shown: Record<'Preview' | 'Groups' | 'Stages', boolean>,
) => {
    for (const [name, value] of Object.entries(shown))
        await expect(tab(page, side, name)).toHaveAttribute('aria-selected', String(value))
}

// Boots with the given panel state saved, or none, as a first visit has.
const boot = async (
    page: Page,
    viewport: { width: number; height: number },
    saved: Record<string, unknown> = {},
) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.setViewportSize(viewport)
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(
        ({ prefix, keys, saved }) => {
            // Undo the closed Preview and Properties the counters seed.
            localStorage.removeItem(prefix + 'showPreview')
            localStorage.removeItem(prefix + 'showSidebar')
            if (sessionStorage.getItem('booted')) return
            sessionStorage.setItem('booted', '1')
            for (const key of keys) localStorage.removeItem(prefix + key)
            for (const [key, value] of Object.entries(saved))
                localStorage.setItem(prefix + key, JSON.stringify(value))
        },
        { prefix, keys: panelKeys, saved },
    )
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
}

for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
])
    test(`Groups and Stages open beside Preview by default at ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        await boot(page, viewport)
        await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })
        await expect(tab(page, 'right', 'Properties')).toHaveAttribute('aria-selected', 'true')
        // Preview keeps its natural letterboxed size above them.
        const body = (await dock(page, 'left').locator('.workspace-dock-body').boundingBox())!
        const tile = (await dock(page, 'left').locator('.workspace-tile').first().boundingBox())!
        expect(Math.abs(tile.height - (body.width * 9) / 16 - 52)).toBeLessThan(2)
        expect(await stored(page)).toEqual({})
    })

for (const viewport of [
    { width: 1280, height: 600 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
])
    test(`only Preview opens by default at ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        await boot(page, viewport)
        await expectShown(page, 'left', { Preview: true, Groups: false, Stages: false })
    })

for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
])
    test(`portrait ${viewport.width}x${viewport.height} keeps managers closed in the top dock`, async ({
        page,
    }) => {
        await boot(page, viewport)
        await expectShown(page, 'top', { Preview: true, Groups: false, Stages: false })
    })

test('the default follows the window until the user acts on panels', async ({ page }) => {
    await boot(page, { width: 1280, height: 600 })
    await expectShown(page, 'left', { Preview: true, Groups: false, Stages: false })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await settle(page)
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })

    // Rotating to portrait and back shows each shape's default and saves nothing.
    await page.setViewportSize({ width: 820, height: 1180 })
    await settle(page)
    await expectShown(page, 'top', { Preview: true, Groups: false, Stages: false })
    await page.setViewportSize({ width: 1600, height: 1000 })
    await settle(page)
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })
    expect(await stored(page)).toEqual({})

    // The first panel action saves what the default showed, so shrinking the
    // window no longer closes Groups.
    await tab(page, 'left', 'Stages').click()
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: false })
    expect(await stored(page)).toMatchObject({ showGroups: true, showStages: false })
    await page.setViewportSize({ width: 1280, height: 600 })
    await settle(page)
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: false })
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: false })
})

test('dismissing a drawer saves the default too', async ({ page }) => {
    await boot(page, { width: 390, height: 844 }, { previewPosition: 'left' })
    await expect(tab(page, 'left', 'Preview')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'top', 'Groups')).toHaveAttribute('aria-selected', 'false')
    await expect(dock(page, 'left').locator('.workspace-dock-body')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dock(page, 'left').locator('.workspace-dock-body')).toHaveCount(0)
    expect(await stored(page)).toEqual({
        leftDockCollapsed: true,
        showGroups: false,
        showStages: false,
    })
})

test('a saved choice wins over the default', async ({ page }) => {
    await boot(page, { width: 1600, height: 1000 }, { showGroups: false, showStages: true })
    await expectShown(page, 'left', { Preview: true, Groups: false, Stages: true })
})

test('panel state saved under the old default keeps managers closed', async ({ page }) => {
    // Opening a manager reordered the tabs; closing it again saved nothing else.
    await boot(
        page,
        { width: 1600, height: 1000 },
        { panelRecency: ['groups', 'preview', 'properties', 'stages'] },
    )
    await expectShown(page, 'left', { Preview: true, Groups: false, Stages: false })
})

test('an older saved open manager stays open alone', async ({ page }) => {
    await boot(page, { width: 1600, height: 1000 }, { showGroups: true })
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: false })
})

test('Reset Settings brings back the default', async ({ page }) => {
    await boot(page, { width: 1600, height: 1000 }, { showGroups: false, showStages: false })
    await expectShown(page, 'left', { Preview: true, Groups: false, Stages: false })
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Reset Settings' }).click()
    await page.keyboard.press('Escape')
    await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })
    expect(await stored(page)).toEqual({})
})

test.describe('touch', () => {
    test.use({ isMobile: true, hasTouch: true })

    for (const viewport of [
        { width: 390, height: 844 },
        { width: 820, height: 1180 },
    ])
        test(`portrait ${viewport.width}x${viewport.height} keeps managers closed`, async ({
            page,
        }) => {
            await boot(page, viewport)
            await expectShown(page, 'top', { Preview: true, Groups: false, Stages: false })
        })

    test('a landscape phone keeps managers closed', async ({ page }) => {
        await boot(page, { width: 844, height: 390 })
        await expectShown(page, 'left', { Preview: true, Groups: false, Stages: false })
    })

    test('a landscape tablet opens managers and an on-screen keyboard keeps them', async ({
        page,
    }) => {
        await boot(page, { width: 1180, height: 820 })
        await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })
        // Renaming a group raises the keyboard, which shortens the window.
        const name = dock(page, 'left').locator('.manager-name').filter({ hasText: 'Other group' })
        await name.dblclick()
        await name.dblclick()
        const rename = dock(page, 'left').locator('.manager-rename')
        await expect(rename).toBeFocused()
        await page.setViewportSize({ width: 1180, height: 470 })
        await settle(page)
        await expect(rename).toBeFocused()
        await expect(tab(page, 'left', 'Groups')).toHaveAttribute('aria-selected', 'true')
        await page.setViewportSize({ width: 1180, height: 820 })
        await settle(page)
        await expectShown(page, 'left', { Preview: true, Groups: true, Stages: true })
    })
})
