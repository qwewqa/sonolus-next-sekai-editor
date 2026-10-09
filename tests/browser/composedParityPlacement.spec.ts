import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type Seed = {
    size?: number
    left?: number
    division?: number
    snapping?: 'absolute' | 'relative'
    changing?: boolean
}
const seed = async (
    page: Page,
    { size = 3, left, division = 1, snapping = 'absolute', changing = false }: Seed = {},
) => {
    await page.evaluate(
        async ({ size, left, division, snapping, changing }) => {
            const { fixtures, show, view, settings, appImport } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            const transform = fixtures.events.stageTransformEvents[0]!
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    stagePivotEvents: [
                        {
                            ...pivot,
                            beat: 0,
                            pivotLane: 1.25,
                            divisionSize: 3,
                            divisionParity: 'odd',
                            eventEase: 'inStep',
                        },
                        ...(changing
                            ? [
                                  {
                                      ...pivot,
                                      beat: 4,
                                      pivotLane: 3.25,
                                      divisionSize: 2,
                                      divisionParity: 'odd' as const,
                                      eventEase: 'linear' as const,
                                  },
                              ]
                            : []),
                    ],
                    stageTransformEvents: [{ ...transform, beat: 0, xTranslation: -0.25 }],
                    slides: left === undefined ? [] : [[{ ...base, beat: 4, left, size }]],
                },
                3,
            )
            view.layout = 'composed'
            view.noteSize = size
            view.laneDivision = division
            view.laneSnapping = snapping
            view.snapping = 'absolute'
            settings.maxLane = 0
            const { defaultNoteProperties } = await appImport<
                typeof import('../../src/editor/tools/note')
            >('/src/editor/tools/note/index.ts')
            const { defaultSlideProperties } = await appImport<
                typeof import('../../src/editor/tools/slide')
            >('/src/editor/tools/slide/index.ts')
            defaultNoteProperties.value = { copyProperties: false }
            defaultSlideProperties.value = { copyProperties: false }
        },
        { size, left, division, snapping, changing },
    )
}

const drag = async (page: Page, from: [number, number], to: [number, number]) => {
    const points = await page.evaluate(
        ({ from, to }) => ({
            from: window.editorTest.point(...from),
            to: window.editorTest.point(...to),
        }),
        { from, to },
    )
    await page.mouse.move(points.from.x, points.from.y)
    await page.mouse.down()
    await page.mouse.move(points.to.x, points.to.y, { steps: 4 })
}

const ghost = (page: Page) =>
    page.evaluate(async () => {
        const { appImport } = window.editorTest
        const { sceneState, isScenePreview } = await appImport<
            typeof import('../../src/editor/sceneState')
        >('/src/editor/sceneState.ts')
        return (
            isScenePreview.value
                ? sceneState.value.selectedEntities
                : window.editorTest.view.entities.creating
        )
            .filter((entity) => entity.type === 'note')
            .map(({ beat, left, size }) => ({ beat, left, size }))
    })
const notes = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.snapshot().notes.map(({ beat, left, size }) => ({ beat, left, size })),
    )

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const [name, shortcut] of [
    ['note', 'a'],
    ['slide', 's'],
] as const) {
    test(`${name}: odd stage divisions snap note edges for odd/even widths and subdivisions`, async ({
        page,
    }) => {
        for (const division of [1, 2, 3, 4, 5])
            for (const size of [1, 2, 3]) {
                await seed(page, { division, size })
                await page.keyboard.press(shortcut)
                const point = await page.evaluate(() => window.editorTest.point(2.5, 4))
                await page.mouse.move(point.x, point.y)
                await expect.poll(() => ghost(page)).toEqual([{ beat: 4, left: 1.5, size }])
                await page.mouse.click(point.x, point.y)
                expect(await notes(page)).toEqual([{ beat: 4, left: 1.5, size }])
            }
    })

    for (const snapping of ['absolute', 'relative'] as const) {
        test(`${name}: ${snapping} movement snaps the raw anchor without changing its width`, async ({
            page,
        }) => {
            await seed(page, { left: 0.2, snapping })
            await page.keyboard.press(shortcut)
            await drag(page, [2.7, 4], [3.9, 4])
            const expected = [{ beat: 4, left: snapping === 'absolute' ? 1.5 : 1.2, size: 3 }]
            expect(await ghost(page)).toEqual(expected)
            await page.mouse.up()
            expect(await notes(page)).toEqual(expected)
            await page.keyboard.press('z')
            expect(await notes(page)).toEqual([{ beat: 4, left: 0.2, size: 3 }])
        })
    }

    for (const side of ['left', 'right'] as const) {
        test(`${name}: ${side} resizing snaps the moving edge to odd parity and retains the fixed edge`, async ({
            page,
        }) => {
            await seed(page, { left: 0.5 })
            await page.keyboard.press(shortcut)
            await drag(page, [side === 'left' ? 1.55 : 4.45, 4], [side === 'left' ? -1.2 : 6.2, 6])
            const expected = [
                { beat: 4, left: side === 'left' ? -2.5 : 0.5, size: side === 'left' ? 6 : 5 },
            ]
            expect(await ghost(page)).toEqual(expected)
            await page.mouse.up()
            expect(await notes(page)).toEqual(expected)
        })
    }

    test(`${name}: drag creation keeps its fixed raw edge across pivot and parity changes`, async ({
        page,
    }) => {
        await seed(page, { changing: true })
        await page.keyboard.press(shortcut)
        await drag(page, [2.5, 2], [6.2, 6])
        const expected = [{ beat: 6, left: 1.5, size: 1.5 }]
        expect(await ghost(page)).toEqual(expected)
        await page.mouse.up()
        expect(await notes(page)).toEqual(expected)
    })
}
