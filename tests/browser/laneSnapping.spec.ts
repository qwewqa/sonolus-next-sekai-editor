import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('lane controls have their own default toolbar group and custom division leaves beat settings unchanged', async ({
    page,
}) => {
    const groups = await page.evaluate(() => window.editorTest.settings.toolbar)
    const lanes = groups.find((names) => names.includes('laneSnapping'))!
    expect(lanes).toContain('laneDivision1')
    expect(lanes).toContain('laneDivisionCustom')
    expect(lanes).not.toContain('snapping')
    expect(lanes).not.toContain('division4')
    await expect(page.getByRole('button', { name: '1/1 Lane Division', exact: true })).toBeVisible()
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['laneDivisionCustom'], ['laneSnapping']]
    })
    await page.getByRole('button', { name: 'Custom Lane Division', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Custom Lane Division')
    const input = dialog.getByRole('spinbutton', { name: 'Division', exact: true })
    await input.fill('0')
    expect(await input.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(false)
    await input.fill('1e20')
    expect(await input.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(false)
    await input.fill('7')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    expect(
        await page.evaluate(() => ({
            laneDivision: window.editorTest.view.laneDivision,
            beatDivision: window.editorTest.view.division,
            laneSnapping: window.editorTest.view.laneSnapping,
            beatSnapping: window.editorTest.view.snapping,
        })),
    ).toEqual({
        laneDivision: 7,
        beatDivision: 4,
        laneSnapping: 'relative',
        beatSnapping: 'absolute',
    })
    await page.getByRole('button', { name: 'Lane Snapping', exact: true }).click()
    expect(
        await page.evaluate(() => [
            window.editorTest.view.laneSnapping,
            window.editorTest.view.snapping,
        ]),
    ).toEqual(['absolute', 'absolute'])
})

test('main editor placement and resizing use fractional lane divisions and undo', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { show, fixtures, view } = window.editorTest
        show({ ...fixtures.interaction, slides: [] }, 3)
        view.laneDivision = 4
    })
    await page.keyboard.press('a')
    const add = await page.evaluate(() => window.editorTest.point(1.37, 4))
    await page.mouse.click(add.x, add.y)
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.left).toBe(1.25)
    await page.keyboard.press('f')
    const edge = await page.evaluate(() => window.editorTest.point(3.19, 4))
    const move = await page.evaluate(
        () => (window.editorTest.view.w / window.editorTest.settings.width) * 0.6,
    )
    await page.mouse.move(edge.x, edge.y)
    await page.mouse.down()
    await page.mouse.move(edge.x + move, edge.y, { steps: 4 })
    await page.mouse.up()
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.size).toBe(2.5)
    await page.keyboard.press('z')
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.size).toBe(2)
})

test('note size buttons use the lane division and keep the zero-size bound', async ({ page }) => {
    const sizes = await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        const { view } = window.editorTest
        view.laneDivision = 4
        view.noteSize = 2
        void commands.increaseNoteSize.execute()
        const increased = view.noteSize
        void commands.decreaseNoteSize.execute()
        const decreased = view.noteSize
        view.noteSize = 0.125
        void commands.decreaseNoteSize.execute()
        return [increased, decreased, view.noteSize]
    })
    expect(sizes).toEqual([2.25, 2, 0])
})

test('elevation placement and resizing use the same fractional lane grid', async ({ page }) => {
    await page.evaluate(() => {
        const { show, fixtures, view } = window.editorTest
        show({ ...fixtures.interaction, slides: [] }, 3)
        view.laneDivision = 4
    })
    await page.keyboard.press('t')
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('4')
    await beat.press('Tab')
    await page.locator('.elevation-editor').focus()
    await page.keyboard.press('a')
    const point = await page.evaluate(async () => {
        const { elevationLayout } = await import('/src/editor/elevation/scene.ts')
        const layout = elevationLayout.value
        const box = document.querySelector('canvas.elevation-canvas')!.getBoundingClientRect()
        return { x: box.x + layout.xAt(1.37), y: box.y + layout.yAt(2) }
    })
    await page.mouse.click(point.x, point.y)
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.left).toBe(1.25)
    const edge = await page.evaluate(async () => {
        const { elevationLayout } = await import('/src/editor/elevation/scene.ts')
        const layout = elevationLayout.value
        const row = layout.rows[0]!
        const box = document.querySelector('canvas.elevation-canvas')!.getBoundingClientRect()
        return { x: box.x + row.x + row.w / 2 - 3, y: box.y + row.y, dx: layout.laneScale * 0.6 }
    })
    await page.mouse.move(edge.x, edge.y)
    await page.mouse.down()
    await page.mouse.move(edge.x + edge.dx, edge.y, { steps: 4 })
    await page.mouse.up()
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.size).toBe(2.5)
    await page.keyboard.press('z')
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.size).toBe(2)
})

for (const mode of ['relative', 'absolute'] as const) {
    test(`${mode} lane snapping moves the selection as a unit in both editor panes`, async ({
        page,
    }) => {
        for (const elevation of [false, true]) {
            await page.evaluate(
                ({ mode, elevation }) => {
                    const { show, fixtures, history, view, settings } = window.editorTest
                    const chart = fixtures.interaction
                    const base = chart.slides[0]![0]!
                    show(
                        {
                            ...chart,
                            slides: [
                                [{ ...base, beat: 4, left: 1.15, elevation: 1 }],
                                [{ ...base, beat: elevation ? 4 : 6, left: -3.2, elevation: 3 }],
                            ],
                        },
                        3,
                    )
                    const source = history.state.value
                    history.replaceState({
                        ...source,
                        selectedEntities: [...source.store.slides.note.values()].flat(),
                    })
                    view.laneDivision = 4
                    view.laneSnapping = mode
                    settings.elevationEditorSideBySide = 'disallow'
                },
                { mode, elevation },
            )
            if (elevation) await page.keyboard.press('t')
            const point = await page.evaluate(async (elevation) => {
                const { view, settings, point } = window.editorTest
                if (!elevation) return { ...point(2.15, 4), dx: (view.w / settings.width) * 0.41 }
                const { elevationLayout } = await import('/src/editor/elevation/scene.ts')
                const row = elevationLayout.value.rows.find((row) => row.note.left === 1.15)!
                const box = document
                    .querySelector('canvas.elevation-canvas')!
                    .getBoundingClientRect()
                return {
                    x: box.x + row.x,
                    y: box.y + row.y,
                    dx: elevationLayout.value.laneScale * 0.41,
                }
            }, elevation)
            await page.mouse.move(point.x, point.y)
            await page.mouse.down()
            await page.mouse.move(point.x + point.dx, point.y, { steps: 4 })
            await page.mouse.up()
            const lefts = await page.evaluate(() =>
                [...window.editorTest.history.state.value.store.slides.note.values()]
                    .flat()
                    .map((note) => note.left),
            )
            expect(lefts[0]).toBeCloseTo(mode === 'relative' ? 1.65 : 1.5)
            expect(lefts[1]).toBeCloseTo(mode === 'relative' ? -2.7 : -2.85)
            expect(lefts[0]! - lefts[1]!).toBeCloseTo(4.35)
            await page.keyboard.press('z')
            expect(
                await page.evaluate(() =>
                    [...window.editorTest.history.state.value.store.slides.note.values()]
                        .flat()
                        .map((note) => note.left),
                ),
            ).toEqual([1.15, -3.2])
            const edge = await page.evaluate(async (elevation) => {
                const { view, settings, point } = window.editorTest
                if (!elevation) return { ...point(3.1, 4), dx: (view.w / settings.width) * 0.41 }
                const { elevationLayout } = await import('/src/editor/elevation/scene.ts')
                const layout = elevationLayout.value
                const row = layout.rows.find((row) => row.note.left === 1.15)!
                const box = document
                    .querySelector('canvas.elevation-canvas')!
                    .getBoundingClientRect()
                return {
                    x: box.x + row.x + row.w / 2 - 2,
                    y: box.y + row.y,
                    dx: layout.laneScale * 0.41,
                }
            }, elevation)
            await page.mouse.move(edge.x, edge.y)
            await page.mouse.down()
            await page.mouse.move(edge.x + edge.dx, edge.y, { steps: 4 })
            await page.mouse.up()
            const resized = await page.evaluate(
                () =>
                    [
                        ...window.editorTest.history.state.value.store.slides.note.values(),
                    ].flat()[0]!,
            )
            expect(resized.left).toBeCloseTo(1.15)
            expect(resized.size).toBeCloseTo(mode === 'relative' ? 2.5 : 2.35)
            await page.keyboard.press('z')
            expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.size).toBe(2)
        }
    })
}

test('elevation beat arrows step by the current division through empty beats and hide spinner arrows', async ({
    page,
}) => {
    await page.keyboard.press('t')
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('4')
    await beat.press('Tab')
    await page.getByRole('button', { name: 'Next beat', exact: true }).click()
    await expect(beat).toHaveValue('4.25')
    expect(
        await page.evaluate(async () => {
            const { elevationLayout } = await import('/src/editor/elevation/scene.ts')
            return elevationLayout.value.rows.length
        }),
    ).toBe(0)
    await page.getByRole('button', { name: 'Previous beat', exact: true }).click()
    await expect(beat).toHaveValue('4')
    await page.evaluate(() => {
        window.editorTest.view.division = 3
    })
    await page.getByRole('button', { name: 'Next beat', exact: true }).click()
    expect(Number(await beat.inputValue())).toBeCloseTo(4 + 1 / 3)
    await beat.fill('0')
    await beat.press('Tab')
    await expect(page.getByRole('button', { name: 'Previous beat', exact: true })).toBeDisabled()
    expect(await beat.evaluate((input) => getComputedStyle(input).appearance)).toBe('textfield')
})

test('lane controls and the compact beat field fit a phone in the elevation editor', async ({
    page,
}, testInfo) => {
    await page.keyboard.press('t')
    await expect(page.locator('canvas.elevation-canvas')).toBeVisible()
    for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
    ]) {
        await page.mouse.move(1, 200)
        await page.setViewportSize(viewport)
        const pane = page.locator('.elevation-editor')
        const lane = pane.getByRole('button', { name: '1/1 Lane Division', exact: true })
        await expect(lane).toBeVisible()
        const fraction = lane.locator('span')
        expect(
            await fraction.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
        ).toBeGreaterThanOrEqual(12)
        const bounds = await page.locator('.elevation-controls').boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
        await page.screenshot({ path: testInfo.outputPath(`lane-controls-${viewport.width}.png`) })
        await lane.hover()
        const custom = pane.getByRole('button', { name: 'Custom Lane Division', exact: true })
        await expect(custom).toBeVisible()
        const menu = await custom.boundingBox()
        expect(menu!.x).toBeGreaterThanOrEqual(0)
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width)
        expect(menu!.y).toBeGreaterThanOrEqual(0)
        await page.screenshot({ path: testInfo.outputPath(`lane-menu-${viewport.width}.png`) })
        await page.mouse.move(1, 200)
    }
})
