import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Adding a BPM or time scale edits it in the visible Properties panel, else in a dialog.

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const selected = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities.map(({ type, beat }) => ({
            type,
            beat,
        })),
    )

const panel = (page: Page) => page.locator('#workspace-panel-properties')

for (const [type, key, title] of [
    ['bpm', 'q', 'BPM'],
    ['timeScale', 'w', 'Time Scale'],
] as const)
    for (const shown of [true, false])
        test(`adding a ${title} ${shown ? 'edits it in the shown panel' : 'opens a dialog without the panel'}`, async ({
            page,
        }) => {
            await page.evaluate(
                ({ shown }) => {
                    const { settings, show, fixtures } = window.editorTest
                    settings.showSidebar = shown
                    show(fixtures.interaction, 3)
                },
                { shown },
            )
            await page.keyboard.press(key)
            const dialog = page.getByRole('dialog')
            const expectEditor = async (beat: number) => {
                expect(await selected(page)).toEqual([{ type, beat }])
                if (shown) {
                    await expect(dialog).toHaveCount(0)
                    await expect(panel(page)).toBeVisible()
                } else {
                    await expect(dialog).toBeVisible()
                    await page.keyboard.press('Escape')
                    await expect(dialog).toHaveCount(0)
                }
            }

            // A tap on empty space.
            const tap = await point(page, 0, 7)
            await page.mouse.click(tap.x, tap.y)
            await expectEditor(7)

            // A drag ending on empty space.
            const start = await point(page, 0, 5)
            const end = await point(page, 0, 6)
            await page.mouse.move(start.x, start.y)
            await page.mouse.down()
            await page.mouse.move(start.x, (start.y + end.y) / 2)
            await page.mouse.move(end.x, end.y)
            await page.mouse.up()
            await expectEditor(6)

            // A drag ending on an existing one selects it.
            const from = await point(page, 0, 4)
            const to = await point(page, 0, 6)
            await page.mouse.move(from.x, from.y)
            await page.mouse.down()
            await page.mouse.move(to.x, to.y)
            await page.mouse.up()
            await expectEditor(6)
        })

for (const [type, key] of [
    ['bpm', 'q'],
    ['timeScale', 'w'],
] as const)
    test(`a ${type} added with the panel scrolled away shows its first rows, focus left alone`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 560 })
        await page.evaluate(() => {
            const { settings, show, fixtures } = window.editorTest
            settings.showSidebar = true
            show(fixtures.interaction, 3)
        })
        await page.keyboard.press(key)
        const first = await point(page, 0, 7)
        await page.mouse.click(first.x, first.y)
        await expect(
            panel(page).locator('#properties-section-selection input').first(),
        ).toBeVisible()
        const scroller = panel(page).locator('.properties-scroller-sections')
        await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
        await expect
            .poll(() =>
                scroller.evaluate(
                    (element) =>
                        element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
                ),
            )
            .toBe(true)
        const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))

        const second = await point(page, 0, 5)
        await page.mouse.click(second.x, second.y)
        expect(await selected(page)).toEqual([{ type, beat: 5 }])
        const header = panel(page).locator('#properties-section-selection-header')
        const field = panel(page).locator('#properties-section-selection input').first()
        await expect
            .poll(async () => {
                const below = (await header.boundingBox())!
                const box = (await field.boundingBox())!
                const view = (await scroller.boundingBox())!
                return box.y >= below.y + below.height && box.y + box.height <= view.y + view.height
            })
            .toBe(true)
        expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))).toBe(
            focused,
        )
    })
