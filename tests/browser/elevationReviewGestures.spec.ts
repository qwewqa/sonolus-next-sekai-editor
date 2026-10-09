import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, settings, history, appImport } = window.editorTest
        const base = { ...fixtures.interaction.slides[0]![0]!, beat: 3, elevation: 2 }
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [
                        { ...base, left: -4, noteStyle: 'red' },
                        { ...base, left: -4, elevation: 4, noteStyle: 'green' },
                    ],
                    [{ ...base, left: 2, noteStyle: 'blue' }],
                ],
            },
            3,
        )
        settings.showSidebar = false
        settings.showPreview = false
        settings.elevationEditorSideBySide = 'disallow'
        const blue = [...history.state.value.store.slides.note.values()]
            .flat()
            .find((note) => note.noteStyle === 'blue')!
        history.replaceState({ ...history.state.value, selectedEntities: [blue] })
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('select')
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
})

for (const tool of ['select', 'elevation'] as const) {
    for (const modifier of ['Control', 'Shift']) {
        test(`${tool} ${modifier} drag of an unselected note moves only the grabbed note`, async ({
            page,
        }) => {
            await page.evaluate(async (tool) => {
                const { switchToolTo } = await window.editorTest.appImport<
                    typeof import('../../src/editor/tools')
                >('/src/editor/tools/index.ts')
                switchToolTo(tool)
            }, tool)
            const local = await page.evaluate(async () => {
                const { elevationLayout } = await window.editorTest.appImport<
                    typeof import('../../src/editor/elevation/scene')
                >('/src/editor/elevation/scene.ts')
                const row = elevationLayout.value.rows.find((row) => row.note.noteStyle === 'red')!
                return { x: row.x, y: row.y, delta: elevationLayout.value.laneScale }
            })
            const box = (await page.locator('.elevation-canvas').boundingBox())!
            await page.keyboard.down(modifier)
            await page.mouse.move(box.x + local.x, box.y + local.y)
            await page.mouse.down()
            await page.mouse.move(box.x + local.x + local.delta, box.y + local.y, { steps: 5 })
            await page.mouse.up()
            await page.keyboard.up(modifier)
            expect(
                await page.evaluate(() =>
                    [...window.editorTest.history.state.value.store.slides.note.values()]
                        .flat()
                        .map((note) => ({ style: note.noteStyle, left: note.left })),
                ),
            ).toEqual([
                { style: 'red', left: -3 },
                { style: 'green', left: -4 },
                { style: 'blue', left: 2 },
            ])
            expect(
                await page.evaluate(() =>
                    window.editorTest.history.state.value.selectedEntities.map(
                        (note) => note.type === 'note' && note.noteStyle,
                    ),
                ),
            ).toEqual(['red'])
            await page.evaluate(() => window.editorTest.history.undoState())
            expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        })
    }
}

for (const tool of ['select', 'brush'] as const) {
    test(`Escape cancels ${tool} modifier box and restores its original selection`, async ({
        page,
    }) => {
        const local = await page.evaluate(async (tool) => {
            const { appImport } = window.editorTest
            const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
                '/src/editor/tools/index.ts',
            )
            switchToolTo(tool)
            const { elevationLayout } = await appImport<
                typeof import('../../src/editor/elevation/scene')
            >('/src/editor/elevation/scene.ts')
            const layout = elevationLayout.value
            return {
                x1: layout.xAt(-6),
                x2: layout.xAt(-1),
                y1: layout.yAt(1),
                y2: layout.yAt(2.5),
            }
        }, tool)
        const box = (await page.locator('.elevation-canvas').boundingBox())!
        await page.keyboard.down('Control')
        await page.keyboard.down('Shift')
        await page.mouse.move(box.x + local.x1, box.y + local.y1)
        await page.mouse.down()
        await page.mouse.move(box.x + local.x2, box.y + local.y2, { steps: 5 })
        expect(
            await page.evaluate(() =>
                window.editorTest.history.state.value.selectedEntities.some(
                    (note) => note.type === 'note' && note.noteStyle === 'red',
                ),
            ),
        ).toBe(true)
        await page.keyboard.up('Shift')
        await page.keyboard.up('Control')
        await page.keyboard.press('Escape')
        await page.mouse.up()
        expect(
            await page.evaluate(() =>
                window.editorTest.history.state.value.selectedEntities.map(
                    (note) => note.type === 'note' && note.noteStyle,
                ),
            ),
        ).toEqual(['blue'])
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        await expect(page.locator('.elevation-canvas')).toBeVisible()
    })
}
