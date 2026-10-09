import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

for (const layout of ['basic', 'composed'] as const)
    for (const selectNote of [true, false])
        test(`${layout}: width scaling ${selectNote ? 'grabs a selected note edge above its pivot' : 'skips an unselected note above a selected pivot'}`, async ({
            page,
        }) => {
            await page.addInitScript(installCanvasCounters)
            await page.goto('/')
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
            await page.evaluate(installEditorFixture)
            const before = await page.evaluate(
                async ({ layout, selectNote }) => {
                    const { fixtures, show, view, settings, history, appImport } = window.editorTest
                    const base = fixtures.interaction.slides[0]![0]!
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: true,
                            // The note sits just after the pivot, within the same hit area,
                            // so the composed stage uses this control's outgoing value.
                            slides: [
                                [
                                    {
                                        ...base,
                                        beat: 4 + 1 / 64,
                                        left: layout === 'composed' ? -2 : 0,
                                        size: 2,
                                    },
                                ],
                            ],
                            stagePivotEvents: [
                                {
                                    ...fixtures.events.stagePivotEvents[0]!,
                                    beat: 4,
                                    pivotLane: 2,
                                    divisionSize: 2,
                                    divisionParity: 'even',
                                },
                            ],
                            stageTransformEvents: selectNote
                                ? []
                                : [
                                      {
                                          ...fixtures.events.stageTransformEvents[0]!,
                                          stageId: 2 as typeof base.stageId,
                                          beat: 6,
                                          xTranslation: -2,
                                      },
                                  ],
                        },
                        3,
                    )
                    view.layout = layout
                    view.laneDivision = 3
                    view.laneSnapping = 'relative'
                    settings.maxLane = 0
                    const source = history.state.value
                    const notes = [...source.store.slides.note.values()].flat()
                    const pivots = [...source.store.grid.stagePivotEventJoint.values()].flatMap(
                        (bucket) => [...bucket],
                    )
                    const transforms = [
                        ...source.store.grid.stageTransformEventJoint.values(),
                    ].flatMap((bucket) => [...bucket])
                    history.replaceState({
                        ...source,
                        selectedEntities: [...pivots, ...transforms, ...(selectNote ? notes : [])],
                    })
                    const { scaleWidth } = await appImport<
                        typeof import('../../src/editor/commands/scaleSelection')
                    >('/src/editor/commands/scaleSelection/index.ts')
                    void scaleWidth.execute()
                    return { left: notes[0]!.left, size: notes[0]!.size }
                },
                { layout, selectNote },
            )
            const panel = page.locator('.scaling-panel')
            await expect(panel).toBeVisible()
            const points = await page.evaluate(() => ({
                from: window.editorTest.point(1.95, 4 + 1 / 64),
                to: window.editorTest.point(3.95, 4 + 1 / 64),
            }))
            await page.mouse.move(points.from.x, points.from.y)
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        window.editorTest.view.entities.hovered.map((entity) => entity.type),
                    ),
                )
                .toEqual(selectNote ? ['note', 'stagePivotEventJoint'] : ['stagePivotEventJoint'])
            await page.mouse.down()
            await page.mouse.move(points.to.x, points.to.y, { steps: 4 })
            await page.mouse.up()
            const preview = await page.evaluate(async () => {
                const { history, appImport } = window.editorTest
                const { getPreviewState } =
                    await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
                const source = getPreviewState(history.state.value)
                const note = [...source.store.slides.note.values()].flat()[0]!
                const pivot = [...source.store.grid.stagePivotEventJoint.values()].flatMap(
                    (bucket) => [...bucket],
                )[0]!
                const transform = [...source.store.grid.stageTransformEventJoint.values()].flatMap(
                    (bucket) => [...bucket],
                )[0]
                const { createComposedLayout } =
                    await appImport<typeof import('../../src/editor/composed')>(
                        '/src/editor/composed.ts',
                    )
                const position = createComposedLayout(source).notePosition(note)
                return {
                    left: note.left,
                    size: note.size,
                    pivot: pivot.pivotLane,
                    translation: transform?.xTranslation,
                    displayedRight: position.left + position.size,
                }
            })
            if (selectNote) {
                // Basic: scale about raw lane 0 by 2. Composed: about raw lane -2,
                // edge position F(f) = (-2 + 2f) + (-2 + 4f) = -4 + 6f;
                // reaching displayed lane 4 therefore requires f = 4/3.
                expect(preview.left).toBe(before.left)
                expect(preview.size).toBeCloseTo(layout === 'composed' ? 8 / 3 : 4, 7)
                expect(preview.pivot).toBeCloseTo(layout === 'composed' ? 10 / 3 : 4, 7)
                if (layout === 'composed') expect(preview.displayedRight).toBeCloseTo(4, 7)
            } else {
                expect({ left: preview.left, size: preview.size }).toEqual(before)
                expect(preview.pivot).toBe(4)
                expect(preview.translation).toBe(0)
            }
            await panel.getByRole('button', { name: 'Apply', exact: true }).click()
            const committed = await page.evaluate(() => {
                const source = window.editorTest.history.state.value
                const note = [...source.store.slides.note.values()].flat()[0]!
                const pivot = [...source.store.grid.stagePivotEventJoint.values()].flatMap(
                    (bucket) => [...bucket],
                )[0]!
                return { left: note.left, size: note.size, pivot: pivot.pivotLane }
            })
            expect(committed).toEqual({
                left: preview.left,
                size: preview.size,
                pivot: preview.pivot,
            })
            await page.keyboard.press('z')
            expect(
                await page.evaluate(() => {
                    const note = [
                        ...window.editorTest.history.state.value.store.slides.note.values(),
                    ].flat()[0]!
                    return { left: note.left, size: note.size }
                }),
            ).toEqual(before)
        })
