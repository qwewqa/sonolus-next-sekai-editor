import { expect, test, type Page } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const drag = async (page: Page, from: [number, number], to: [number, number]) => {
    const start = await page.evaluate(([lane, beat]) => window.editorTest.point(lane, beat), from)
    const end = await page.evaluate(([lane, beat]) => window.editorTest.point(lane, beat), to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 10 })
    await settle(page)
    await page.mouse.up()
    await settle(page)
}

const sizes = (page: Page) =>
    page.evaluate(() =>
        Object.fromEntries(
            [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
                entity.type === 'note' ? [[entity.noteType, entity.size]] : [],
            ),
        ),
    )

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const [setting, expected] of [
    ['off', { default: 1, anchor: 1 }],
    ['anchors', { default: 1, anchor: 0 }],
    ['all', { default: 0, anchor: 0 }],
] as const) {
    test(`dragging an edge onto the other edge with zero-width notes ${setting}`, async ({
        page,
    }) => {
        await page.evaluate((setting) => {
            const { fixtures, show, settings } = window.editorTest
            settings.zeroWidthNotes = setting
            const [[base]] = fixtures.interaction.slides as [
                [(typeof fixtures.interaction.slides)[0][0]],
            ]
            show({
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 3, left: -4, size: 2, noteType: 'default' }],
                    [{ ...base, beat: 5, left: 0, size: 2, noteType: 'anchor' }],
                ],
            })
        }, setting)
        await settle(page)

        // Right edges dragged onto the left edges; the fixture's lane division is 1.
        await drag(page, [-2.2, 3], [-4.2, 3])
        await drag(page, [1.8, 5], [-0.2, 5])
        expect(await sizes(page)).toEqual(expected)
    })
}
