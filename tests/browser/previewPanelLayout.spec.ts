import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const dock = (page: Page, side: 'left' | 'right' | 'top') =>
    page.locator(`[data-workspace-dock="${side}"]`)

const previewTab = (page: Page, side: 'left' | 'right' | 'top') =>
    dock(page, side).getByRole('tab', { name: 'Preview', exact: true })

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

// Elevation header controls stay visible, unobstructed and aligned, below the
// dock rather than under any preview chrome.
const expectElevationControlsClear = async (page: Page, split: boolean) => {
    await settle(page)
    const header = (await page.locator('.elevation-header').boundingBox())!
    const top = (await dock(page, 'top').count()) ? await dock(page, 'top').boundingBox() : null
    if (top) expect(top.y + top.height).toBeLessThanOrEqual(header.y + 0.5)
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    const snap = page.getByRole('combobox', { name: 'Elevation Snapping', exact: true })
    const close = page.getByRole('button', { name: 'Close Elevation Editor', exact: true })
    for (const control of [beat, snap, close]) {
        const box = (await control.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(header.x)
        expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width + 0.5)
        expect(
            await control.evaluate((element) => {
                const r = element.getBoundingClientRect()
                return element.contains(
                    document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
                )
            }),
        ).toBe(true)
    }
    const beatBox = (await beat.boundingBox())!
    const snapBox = (await snap.boundingBox())!
    expect(beatBox.height).toBe(snapBox.height)
    // Snap shares Beat's row, or wraps to its own row below rather than squeezing.
    expect(snapBox.y === beatBox.y || snapBox.y >= beatBox.y + beatBox.height).toBe(true)
    if (!split) {
        expect(
            await page
                .locator('.elevation-title')
                .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true)
    }
}

for (const { width, height } of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 820, height: 1180 },
]) {
    for (const split of [false, true]) {
        test(`top preview leaves elevation controls clear at ${width}px (${split ? 'split' : 'replacement'})`, async ({
            page,
        }, testInfo) => {
            await page.setViewportSize({ width, height })
            await page.evaluate((split) => {
                const { settings } = window.editorTest
                settings.previewPosition = 'top'
                settings.topDockHeight = 200
                settings.showPreview = true
                settings.elevationEditorSideBySide = split ? 'allow' : 'disallow'
            }, split)
            await expect(page.locator('.preview')).toBeVisible()
            await page.keyboard.press('t')
            await expect(page.locator('.elevation-editor')).toBeVisible()
            await expectElevationControlsClear(page, split)

            // The dock tab closes and reopens the preview; elevation edits continue.
            await previewTab(page, 'top').click()
            await expect(page.locator('.preview')).toHaveCount(0)
            await expectElevationControlsClear(page, split)
            await page.getByRole('spinbutton', { name: 'Beat', exact: true }).fill('7')
            await page.getByRole('spinbutton', { name: 'Beat', exact: true }).press('Tab')
            await page
                .getByRole('combobox', { name: 'Elevation Snapping', exact: true })
                .selectOption('4')
            await previewTab(page, 'top').click()
            await expect(page.locator('.preview')).toBeVisible()

            // Growing the dock grows the preview without covering the header.
            const before = (await page.locator('.preview').boundingBox())!
            const handle = (await dock(page, 'top')
                .getByRole('separator', { name: /^Resize (Top )?Panels$/i })
                .boundingBox())!
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
            await page.mouse.down()
            await page.mouse.move(handle.x + handle.width / 2, handle.y + 70, { steps: 4 })
            await page.mouse.up()
            await expect
                .poll(async () => (await page.locator('.preview').boundingBox())!.height)
                .toBeGreaterThan(before.height)
            await expectElevationControlsClear(page, split)
            // Playback and settings remain reachable in the taller panel.
            for (const name of ['Show Preview Settings']) {
                await expect(page.getByRole('button', { name, exact: true })).toBeInViewport()
            }
            await page.screenshot({
                path: testInfo.outputPath('top-preview-elevation.png'),
                style: '.notification { visibility:hidden }',
            })
            await page.getByRole('button', { name: 'Close Elevation Editor', exact: true }).click()
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
        })
    }
}

for (const side of ['left', 'right'] as const) {
    test(`${side} preview on a landscape phone keeps playback, settings and elevation usable`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize({ width: 844, height: 390 })
        await page.evaluate((side) => {
            const { settings } = window.editorTest
            settings.previewPosition = side
            settings.leftDockWidth = 260
            settings.rightDockWidth = 260
            settings.showPreview = true
        }, side)
        await settle(page)
        const preview = (await page.locator('.preview').boundingBox())!
        const chart = (await page.locator('canvas.editor-chart').boundingBox())!
        const tab = (await previewTab(page, side).boundingBox())!
        // The tile sits between its rail and the editor, which it never covers.
        if (side === 'left') {
            expect(Math.abs(preview.x - (tab.x + tab.width))).toBeLessThanOrEqual(1)
            expect(chart.x).toBeGreaterThanOrEqual(preview.x + preview.width - 0.5)
        } else {
            expect(Math.abs(preview.x + preview.width - tab.x)).toBeLessThanOrEqual(1)
            expect(chart.x + chart.width).toBeLessThanOrEqual(preview.x + 0.5)
        }
        // A narrow tall tile docks the bar below the image and keeps the clock.
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(
            page.getByRole('group', { name: 'Preview Playback Controls', exact: true }),
        ).toBeInViewport()
        await expect(page.locator('.transport-corner-time')).toBeVisible()

        // Touch devices start with settings collapsed; they open beside the dock.
        const toggle = page.getByRole('button', { name: 'Show Preview Settings', exact: true })
        await toggle.tap()
        const settings = (await page.locator('.preview-controls').boundingBox())!
        if (side === 'left') expect(settings.x).toBeGreaterThanOrEqual(preview.x + preview.width)
        else expect(settings.x + settings.width).toBeLessThanOrEqual(preview.x)
        expect(settings.y + settings.height).toBeLessThanOrEqual(390)
        await page.screenshot({
            path: testInfo.outputPath(`landscape-${side}-settings.png`),
            style: '.notification { visibility:hidden }',
        })
        await page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }).tap()

        await previewTab(page, side).click()
        await expect(page.locator('.preview')).toHaveCount(0)
        await previewTab(page, side).click()
        await expect(page.locator('.preview')).toBeVisible()
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-editor')).toBeVisible()
        const beat = (await page
            .getByRole('spinbutton', { name: 'Beat', exact: true })
            .boundingBox())!
        const snap = (await page
            .getByRole('combobox', { name: 'Elevation Snapping', exact: true })
            .boundingBox())!
        expect(beat.height).toBe(snap.height)
        expect(beat.y).toBe(snap.y)
        await expectElevationControlsClear(page, false)
        await page.screenshot({
            path: testInfo.outputPath(`landscape-${side}-elevation.png`),
            style: '.notification { visibility:hidden }',
        })
    })
}

for (const { width, height, side, timeInStrip, compact } of [
    { width: 390, height: 844, side: 'top', timeInStrip: true, compact: false },
    { width: 844, height: 390, side: 'left', timeInStrip: false, compact: true },
] as const) {
    test(`touch playback controls keep a 44 px Play and 40 px steppers in one row in a ${side} preview at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'auto'
            settings.leftDockWidth = 260
            settings.showPreview = true
        })
        await settle(page)
        await expect(dock(page, side).locator('.preview')).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        const geometry = await page.evaluate(() => {
            const box = (element: Element) => element.getBoundingClientRect()
            const buttons = [...document.querySelectorAll('.preview-transport button')].map(box)
            const play = box(document.querySelector('.transport-play')!)
            const clock = document.querySelector('.transport-corner-time')
            const toggle = box(document.querySelector('.preview-settings-toggle')!)
            return {
                bar: box(document.querySelector('.preview-transport')!).height,
                smallest: Math.min(...buttons.flatMap(({ width, height }) => [width, height])),
                play: [play.width, play.height],
                rows: new Set(buttons.map(({ top, height }) => Math.round(top + height / 2))).size,
                stripTime: !!document.querySelector('.transport-time'),
                clockOffset: clock
                    ? box(clock).top + box(clock).height / 2 - (toggle.top + toggle.height / 2)
                    : undefined,
                toggle: toggle.width,
                // Steppers take touches over the track's full height and the gaps between them.
                stepperHits: [...document.querySelectorAll('.transport-track button')].every(
                    (button, index, buttons) => {
                        const { left, right, top, bottom } = box(button)
                        const x = (left + right) / 2
                        const next = buttons[index + 1]
                        const gap =
                            next &&
                            document.elementFromPoint(
                                (right + box(next).left) / 2,
                                (top + bottom) / 2,
                            )
                        return (
                            document.elementFromPoint(x, top - 1.5) === button &&
                            document.elementFromPoint(x, bottom + 1.5) === button &&
                            (!next || gap === button || gap === next)
                        )
                    },
                ),
            }
        })
        // Play is the frequent control; the steppers and the settings toggle,
        // used less often, are a little smaller. A narrow strip uses the
        // compact stepper rather than wrapping.
        expect(geometry.play).toEqual([44, 44])
        expect(geometry.smallest).toBeGreaterThanOrEqual(40)
        expect(geometry.rows).toBe(1)
        expect(geometry.bar).toBe(52)
        expect(geometry.toggle).toBe(36)
        expect(geometry.stepperHits).toBe(true)
        await expect(page.getByRole('button', { name: /^Step Size: 10 ms$/i })).toBeVisible({
            visible: compact,
        })
        // The time sits in the strip where it fits, else in the image's corner,
        // centered on the settings toggle's line.
        expect(geometry.stripTime).toBe(timeInStrip)
        if (timeInStrip) expect(geometry.clockOffset).toBeUndefined()
        else expect(geometry.clockOffset).toBeCloseTo(0, 1)
    })
}

test('on a portrait phone the settings span the screen with even margins', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => Object.assign(window.editorTest.settings, { showPreview: true }))
    await settle(page)
    await page.getByRole('button', { name: 'Show Preview Settings' }).click()
    const form = page.locator('.preview-controls')
    await expect(form).toBeVisible()
    await settle(page)
    const box = (await form.boundingBox())!
    expect(box.x).toBeCloseTo(8, 0)
    expect(390 - box.x - box.width).toBeCloseTo(8, 0)
})
