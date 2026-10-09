import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const setup = (
    page: Page,
    options: {
        layout?: 'basic' | 'composed'
        selected?: number[]
        tailBeat?: number
        tailStageElevation?: number
        reverse?: boolean
        elevations?: [number, number, number]
    } = {},
) =>
    page.evaluate((options) => {
        const { fixtures, show, view, settings, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stageTransformEvents: [
                    { ...transform, beat: 0, xTranslation: 0, elevation: 0 },
                    {
                        ...transform,
                        stageId: 2 as typeof transform.stageId,
                        beat: 0,
                        xTranslation: 0,
                        elevation: options.tailStageElevation ?? 4,
                    },
                ],
                slides: [
                    [
                        {
                            ...base,
                            beat: 6,
                            left: -4,
                            size: 2,
                            elevation: options.elevations?.[0] ?? (options.reverse ? 4 : 0),
                            connectorEase: 'inQuad',
                        },
                        {
                            ...base,
                            beat: 6,
                            left: 0,
                            size: 2,
                            elevation: options.elevations?.[1] ?? (options.reverse ? 3 : 1),
                            isAttached: true,
                        },
                        {
                            ...base,
                            beat: options.tailBeat ?? 6,
                            left: 4,
                            size: 2,
                            elevation: options.elevations?.[2] ?? (options.reverse ? 0 : 4),
                            stageId: 2 as typeof base.stageId,
                        },
                    ],
                ],
            },
            3,
        )
        view.layout = options.layout ?? 'basic'
        view.cursorTime = 3
        view.snapping = 'relative'
        settings.maxLane = 0
        Object.assign(settings, { elevationSnap: 0 })
        settings.elevationEditorSideBySide = 'disallow'
        settings.showSidebar = true
        settings.showPreview = false
        settings.propertiesSection = 'selection'
        settings.propertiesCollapsed = ['tool', 'view']
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({
            ...history.state.value,
            selectedEntities: (options.selected ?? [1]).map((index) => notes[index]!),
        })
    }, options)

const values = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()]
            .flat()
            .map((note) => ({
                left: note.left,
                size: note.size,
                elevation: note.elevation,
                attached: note.isAttached,
            })),
    )

const open = async (page: Page) => {
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
}

const geometry = (page: Page, index = 1) =>
    page.evaluate(async (index) => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const layout = elevationLayout.value
        const row = layout.rows.find((row) => row.order === index)!
        const box = document.querySelector('.elevation-canvas')!.getBoundingClientRect()
        return {
            x: box.x + row.x,
            y: box.y + row.y,
            elevation: row.elevation,
            scale: layout.elevationScale,
            width: row.w,
        }
    }, index)

const move = async (page: Page, delta: number, x = 0, edge = false) => {
    const start = await geometry(page)
    const grabX = start.x + (edge ? start.width / 2 - 3 : 0)
    await page.mouse.move(grabX, start.y)
    await page.mouse.down()
    await page.mouse.move(grabX + x, start.y - delta * start.scale, { steps: 5 })
    return start
}

for (const layout of ['basic', 'composed'] as const) {
    test(`${layout}: same-beat attached numeric elevation commits, blurs, and supports Escape`, async ({
        page,
    }) => {
        await setup(page, { layout })
        const elevation = page.getByRole('spinbutton', { name: 'Elevation', exact: true })
        await expect(elevation).toBeVisible()
        await expect(page.getByRole('spinbutton', { name: 'Lane', exact: true })).toHaveCount(0)
        await elevation.fill('2')
        await page.keyboard.press('Enter')
        await expect(elevation).not.toBeFocused()
        expect((await values(page))[1]!.elevation).toBe(2)
        // The stored lane remains derived with connector easing (fraction .5 -> .25).
        expect((await values(page))[1]!.left).toBe(-2)
        await page.keyboard.press('Escape')
        expect(
            await page.evaluate(
                () => window.editorTest.history.state.value.selectedEntities.length,
            ),
        ).toBe(0)
        await page.keyboard.press('ControlOrMeta+z')
        expect((await values(page))[1]!.elevation).toBe(1)
    })

    test(`${layout}: dragging an attached edge moves elevation without resizing and follows stage height`, async ({
        page,
    }) => {
        await setup(page, { layout })
        await open(page)
        const initial = await values(page)
        await move(page, 1.5, 50, true)
        const draft = await geometry(page)
        expect(draft.elevation).toBeCloseTo(3.5, 1)
        expect((await values(page))[1]!.elevation).toBe(1)
        await page.mouse.up()
        const final = await values(page)
        expect(final[1]!.elevation).toBeCloseTo(1.75, 1)
        expect(final[1]!.size).toBe(initial[1]!.size)
        expect(final[0]).toEqual(initial[0])
        expect(final[2]).toEqual(initial[2])
        expect((await geometry(page)).elevation).toBeCloseTo(draft.elevation, 5)
        await page.keyboard.press('ControlOrMeta+z')
        expect(await values(page)).toEqual(initial)
    })
}

for (const selected of [
    [0, 1],
    [1, 2],
    [0, 1, 2],
]) {
    test(`attached drag keeps a shared raw edit with selected notes ${selected.join(',')}`, async ({
        page,
    }) => {
        await setup(page, { selected })
        await open(page)
        const before = await values(page)
        const head = selected.includes(0) ? 0.5 : 0
        const tail = selected.includes(2) ? 4.5 : 4
        const target = head + (tail + 4 - head) * ((1.5 - head) / (tail - head))
        await move(page, target - 2)
        await page.mouse.up()
        const after = await values(page)
        for (let index = 0; index < 3; index++) {
            expect(after[index]!.elevation).toBeCloseTo(
                before[index]!.elevation + (selected.includes(index) ? 0.5 : 0),
                1,
            )
            expect(after[index]!.size).toBe(before[index]!.size)
        }
        expect((await geometry(page)).elevation).toBeCloseTo(target, 1)
    })
}

test('attached drag cancels exactly and leaves no undo entry', async ({ page }) => {
    await setup(page)
    await open(page)
    const before = await values(page)
    await move(page, 1)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await values(page)).toEqual(before)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('nearby but distinct beats retain attached selection-only behavior', async ({ page }) => {
    await setup(page, { tailBeat: 6 + 1e-8 })
    await expect(page.getByRole('spinbutton', { name: 'Elevation', exact: true })).toHaveCount(0)
    await open(page)
    const before = await values(page)
    await move(page, 1)
    await page.mouse.up()
    expect(await values(page)).toEqual(before)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('singular stage-height projection does not author an invisible attached edit', async ({
    page,
}) => {
    await setup(page, { tailStageElevation: -4 })
    await open(page)
    const before = await values(page)
    await move(page, 1)
    await page.mouse.up()
    expect(await values(page)).toEqual(before)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('descending attachment follows the pointer', async ({ page }) => {
    await setup(page, { reverse: true, tailStageElevation: -4 })
    await open(page)
    await move(page, -1.5)
    await page.mouse.up()
    expect((await values(page))[1]!.elevation).toBeCloseTo(2.25, 1)
    expect((await geometry(page)).elevation).toBeCloseTo(0.5, 1)
})

test('an authored out-of-range attached height moves inward from its displayed endpoint', async ({
    page,
}) => {
    await setup(page, { elevations: [0, 10, 4] })
    await open(page)
    await move(page, -2)
    await page.mouse.up()
    expect((await values(page))[1]!.elevation).toBeCloseTo(3, 1)
    expect((await geometry(page)).elevation).toBeCloseTo(6, 1)
    await page.keyboard.press('ControlOrMeta+z')
    expect((await values(page))[1]!.elevation).toBe(10)
})

for (const elevations of [
    [0, 0, 0],
    [0, 0.5, 1],
] as [number, number, number][]) {
    test(`a co-selected endpoint can open or reverse heights ${elevations.join(',')}`, async ({
        page,
    }) => {
        await setup(page, { elevations, selected: [0, 1], tailStageElevation: 0 })
        await open(page)
        const before = await geometry(page)
        await move(page, 2 - before.elevation)
        await page.mouse.up()
        expect((await geometry(page)).elevation).toBeCloseTo(2, 1)
        expect((await values(page))[0]!.elevation).toBeCloseTo(2, 1)
        expect((await values(page))[1]!.elevation).toBeCloseTo(elevations[1] + 2, 1)
    })
}

test('dragging an independent anchor moves eligible attached elevations but keeps their widths derived', async ({
    page,
}) => {
    await setup(page, { selected: [0, 1, 2], tailStageElevation: 0 })
    await open(page)
    const initial = await values(page)
    const start = await geometry(page, 0)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 40, start.y - start.scale, { steps: 5 })
    await page.mouse.up()
    const final = await values(page)
    for (let index = 0; index < 3; index++) {
        expect(final[index]!.elevation).toBeCloseTo(initial[index]!.elevation + 1, 1)
        expect(final[index]!.size).toBe(initial[index]!.size)
    }
    expect(final[1]!.left - initial[1]!.left).toBeCloseTo(final[0]!.left - initial[0]!.left, 5)
})

test('nearby pane beat uses the rendered stage sample when grabbing an attached note', async ({
    page,
}) => {
    await setup(page)
    await page.evaluate(() => {
        const { history, show, fixtures } = window.editorTest
        // Rebuild from the fixture chart, retaining authored same-beat notes just after a step.
        const base = fixtures.interaction.slides[0]![0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stageTransformEvents: [
                    {
                        ...transform,
                        stageId: 2 as typeof transform.stageId,
                        beat: 0,
                        xTranslation: 0,
                        elevation: 0,
                        eventEase: 'none',
                    },
                    {
                        ...transform,
                        stageId: 2 as typeof transform.stageId,
                        beat: 6 + 2e-8,
                        xTranslation: 0,
                        elevation: 4,
                    },
                ],
                slides: [
                    [
                        { ...base, beat: 6 + 5e-8, left: -4, size: 2, elevation: 0 },
                        {
                            ...base,
                            beat: 6 + 5e-8,
                            left: 0,
                            size: 2,
                            elevation: 1,
                            isAttached: true,
                        },
                        {
                            ...base,
                            beat: 6 + 5e-8,
                            left: 4,
                            size: 2,
                            elevation: 4,
                            stageId: 2 as typeof base.stageId,
                        },
                    ],
                ],
            },
            3,
        )
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: [notes[1]!] })
    })
    await open(page)
    await page.evaluate(async () => {
        const { elevationBeat } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        elevationBeat.value = 6
        await window.editorTest.nextTick()
    })
    const before = await values(page)
    await move(page, 0, 40)
    await page.mouse.up()
    expect(await values(page)).toEqual(before)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
