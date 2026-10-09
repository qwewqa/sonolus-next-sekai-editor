import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

for (const layout of ['basic', 'composed'] as const)
    for (const sameBeat of [false, true])
        test(`${layout}: brushing attachment elevation respects its domain and a hidden overlapping stage (${sameBeat})`, async ({
            page,
        }) => {
            await page.addInitScript(installCanvasCounters)
            await page.goto('/')
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
            await page.evaluate(installEditorFixture)
            const result = await page.evaluate(
                async ({ layout, sameBeat }) => {
                    const { fixtures, show, history, view, point, appImport } = window.editorTest
                    const base = fixtures.interaction.slides[0]![0]!
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: true,
                            stagePivotEvents: [
                                { ...fixtures.events.stagePivotEvents[0]!, beat: 0, pivotLane: 4 },
                                {
                                    ...fixtures.events.stagePivotEvents[0]!,
                                    stageId: 2 as never,
                                    beat: 0,
                                    pivotLane: 4,
                                },
                            ],
                            slides: [
                                [
                                    {
                                        ...base,
                                        beat: sameBeat ? 3 : 2,
                                        left: -0.1,
                                        size: 0.2,
                                        elevation: 0,
                                        connectorEase: 'inQuad',
                                    },
                                    {
                                        ...base,
                                        beat: 3,
                                        left: 0,
                                        size: 0.2,
                                        elevation: 1,
                                        isAttached: true,
                                    },
                                    {
                                        ...base,
                                        beat: sameBeat ? 3 : 4,
                                        left: 3.9,
                                        size: 0.2,
                                        elevation: 4,
                                    },
                                ],
                                [
                                    {
                                        ...base,
                                        stageId: 2 as never,
                                        beat: 3,
                                        left: sameBeat ? 0.15 : 0.9,
                                        size: 0.2,
                                        elevation: 9,
                                    },
                                ],
                            ],
                        },
                        2,
                    )
                    view.layout = layout
                    view.stageVisibility = new Map([[2 as never, 'hidden']])
                    const source = history.state.value
                    const ids = [...source.store.slides.note.keys()]
                    const tick = source.store.slides.note.get(ids[0]!)![1]!
                    history.replaceState({ ...source, selectedEntities: [tick] })
                    const selected = history.state.value
                    const { brush, brushProperties } = await appImport<
                        typeof import('../../src/editor/tools/brush')
                    >('/src/editor/tools/brush/index.ts')
                    brushProperties.value = { elevation: 2 }
                    const p = point(tick.left + tick.size / 2 + (layout === 'composed' ? 4 : 0), 3)
                    brush.hover?.(p.x, p.y, { ctrl: false, shift: false })
                    const hiddenHovered = view.entities.hovered.some(
                        (entity) => 'stageId' in entity && entity.stageId === 2,
                    )
                    brush.tap?.(p.x, p.y, { ctrl: false, shift: false })
                    const current = history.state.value
                    const actual = current.store.slides.note.get(ids[0]!)![1]!
                    const updated = point(
                        actual.left + actual.size / 2 + (layout === 'composed' ? 4 : 0),
                        3,
                    )
                    brush.tap?.(updated.x, updated.y, { ctrl: false, shift: false })
                    const outcome = {
                        hiddenHovered,
                        beforeCenter: tick.left + tick.size / 2,
                        height: actual.elevation,
                        center: actual.left + actual.size / 2,
                        attached: actual.isAttached,
                        decoyUnchanged:
                            current.store.slides.note.get(ids[1]!) ===
                            source.store.slides.note.get(ids[1]!),
                        canUndo: history.canUndo.value,
                        repeatIsNoOp: history.state.value.store === current.store,
                    }
                    history.undoState()
                    return {
                        ...outcome,
                        originalStore: history.state.value.store === selected.store,
                    }
                },
                { layout, sameBeat },
            )
            expect(result).toEqual({
                hiddenHovered: false,
                beforeCenter: sameBeat ? 0.25 : 1,
                // Brush preserves its legacy raw-field writes for time-based attachments.
                height: 2,
                center: 1,
                attached: true,
                decoyUnchanged: true,
                canUndo: true,
                repeatIsNoOp: true,
                originalStore: true,
            })
        })
