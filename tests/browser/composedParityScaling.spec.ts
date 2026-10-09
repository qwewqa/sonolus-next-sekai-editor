import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const mode of ['composed-dynamic', 'basic-dynamic', 'composed-static'] as const) {
    for (const edge of [true, false]) {
        test(`${mode}: width ${edge ? 'edge scaling' : 'center translation'} snaps one raw anchor`, async ({
            page,
        }) => {
            await page.evaluate(
                async ({ mode }) => {
                    const { fixtures, show, view, settings, history, appImport } = window.editorTest
                    const base = fixtures.interaction.slides[0]![0]!
                    const pivot = fixtures.events.stagePivotEvents[0]!
                    const transform = fixtures.events.stageTransformEvents[0]!
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: mode !== 'composed-static',
                            stagePivotEvents: [
                                {
                                    ...pivot,
                                    beat: 0,
                                    pivotLane: 2,
                                    divisionSize: 3,
                                    divisionParity: 'odd',
                                },
                                {
                                    ...pivot,
                                    stageId: 2 as typeof pivot.stageId,
                                    beat: 0,
                                    pivotLane: -3.25,
                                    divisionSize: 2,
                                    divisionParity: 'even',
                                },
                            ],
                            stageTransformEvents: [{ ...transform, beat: 0, xTranslation: 0.25 }],
                            slides: [
                                [{ ...base, beat: 4, left: 0.5, size: 3 }],
                                [
                                    {
                                        ...base,
                                        stageId: 2 as typeof base.stageId,
                                        beat: 6,
                                        left: 2,
                                        size: 2,
                                    },
                                ],
                            ],
                        },
                        3,
                    )
                    view.layout = mode === 'basic-dynamic' ? 'basic' : 'composed'
                    view.laneDivision = 1
                    view.laneSnapping = 'absolute'
                    settings.maxLane = 0
                    history.replaceState({
                        ...history.state.value,
                        selectedEntities: [
                            ...history.state.value.store.slides.note.values(),
                        ].flat(),
                    })
                    const { scaleWidth } = await appImport<
                        typeof import('../../src/editor/commands/scaleSelection')
                    >('/src/editor/commands/scaleSelection/index.ts')
                    void scaleWidth.execute()
                },
                { mode },
            )
            const panel = page.locator('.scaling-panel')
            await expect(panel).toBeVisible()
            const projection = mode === 'composed-dynamic' ? 2.25 : 0
            const origin = mode === 'composed-dynamic' ? 0.5 : 0
            const anchor = edge ? 3.5 : 0.5
            const from = projection + (edge ? 3.4 : 2)
            const distance = edge ? 1.45 : 1.2
            const points = await page.evaluate(
                ({ from, distance }) => ({
                    from: window.editorTest.point(from, 4),
                    to: window.editorTest.point(from + distance, 4),
                }),
                { from, distance },
            )
            await page.mouse.move(points.from.x, points.from.y)
            await page.mouse.down()
            await page.mouse.move(points.to.x, points.to.y, { steps: 4 })
            await page.mouse.up()
            const actual = await page.evaluate(async () => {
                const { appImport, history } = window.editorTest
                const { getPreviewState } =
                    await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
                return [...getPreviewState(history.state.value).store.slides.note.values()]
                    .flat()
                    .map(({ left, size }) => ({ left, size }))
            })
            const delta = origin + Math.round(anchor + distance - origin) - anchor
            const factor = edge ? (3 + delta) / 3 : 1
            const expected = edge
                ? [
                      { left: 0.5, size: 3 * factor },
                      { left: 0.5 + 1.5 * factor, size: 2 * factor },
                  ]
                : [
                      { left: 0.5 + delta, size: 3 },
                      { left: 2 + delta, size: 2 },
                  ]
            for (const [index, note] of expected.entries()) {
                expect(actual[index]!.left).toBeCloseTo(note.left, 7)
                expect(actual[index]!.size).toBeCloseTo(note.size, 7)
            }
            await panel.getByRole('button', { name: 'Apply', exact: true }).click()
            const committed = await page.evaluate(() =>
                window.editorTest.snapshot().notes.map(({ left, size }) => ({ left, size })),
            )
            expect(committed).toEqual(actual)
            await page.keyboard.press('z')
            expect(
                await page.evaluate(() =>
                    window.editorTest.snapshot().notes.map(({ left, size }) => ({ left, size })),
                ),
            ).toEqual([
                { left: 0.5, size: 3 },
                { left: 2, size: 2 },
            ])
        })
    }
}
