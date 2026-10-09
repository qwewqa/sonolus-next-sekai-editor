import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test('mixed stage and tempo flips round-trip projected geometry and preserve selection identities', async ({
    page,
}) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const failures = await page.evaluate(async () => {
        const { appImport, fixtures, show, view, history, store, settings } = window.editorTest
        const { flip } = await appImport<typeof import('../../src/editor/commands/flip')>(
            '/src/editor/commands/flip/index.ts',
        )
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        const failures: string[] = []
        settings.maxLane = 0
        for (const includeEvents of [false, true]) {
            for (const includeBpm of [false, true]) {
                for (const selection of [
                    'all',
                    'interior',
                    'head-interior',
                    'tail-interior',
                ] as const) {
                    for (const connectorEase of ['linear', 'inOutBack', 'inOutStep'] as const) {
                        show({
                            ...fixtures.events,
                            isDynamicStages: true,
                            bpms: [
                                { beat: 0, bpm: 123, meter: 4 },
                                { beat: 3, bpm: 217, meter: 4 },
                            ],
                            stagePivotEvents: [
                                {
                                    ...pivot,
                                    stageId: base.stageId,
                                    beat: 0,
                                    pivotLane: 3,
                                    eventEase: 'linear',
                                },
                                {
                                    ...pivot,
                                    stageId: base.stageId,
                                    beat: 8,
                                    pivotLane: -2,
                                    eventEase: 'linear',
                                },
                                {
                                    ...pivot,
                                    stageId: 2 as never,
                                    beat: 0,
                                    pivotLane: -4,
                                    eventEase: 'linear',
                                },
                                {
                                    ...pivot,
                                    stageId: 2 as never,
                                    beat: 8,
                                    pivotLane: 2,
                                    eventEase: 'linear',
                                },
                            ],
                            stageTransformEvents: [
                                {
                                    ...transform,
                                    stageId: base.stageId,
                                    beat: 0,
                                    xTranslation: 2.25,
                                },
                                { ...transform, stageId: 2 as never, beat: 0, xTranslation: -3.75 },
                            ],
                            slides: [
                                [
                                    { ...base, beat: 2, left: -2, size: 1.5, connectorEase },
                                    { ...base, beat: 3.125, left: 0, size: 2, isAttached: true },
                                    { ...base, beat: 5.25, left: 0, size: 2, isAttached: true },
                                    {
                                        ...base,
                                        beat: 7,
                                        left: 1.25,
                                        size: 3.5,
                                        stageId: 2 as never,
                                    },
                                ],
                            ],
                        })
                        view.layout = 'composed'
                        const selected = [...store.getAllEntities()].filter((entity) => {
                            if (entity.type === 'note')
                                return (
                                    selection === 'all' ||
                                    entity.isAttached ||
                                    (selection === 'head-interior' && entity.beat === 2) ||
                                    (selection === 'tail-interior' && entity.beat === 7)
                                )
                            return (
                                (includeEvents && entity.type.endsWith('Joint')) ||
                                (includeBpm && entity.type === 'bpm')
                            )
                        })
                        history.replaceState({ ...history.state.value, selectedEntities: selected })
                        const positions = () => {
                            const source = history.state.value
                            const layout = createComposedLayout(source)
                            return [...source.store.slides.note.values()]
                                .flat()
                                .map((note) => ({ beat: note.beat, ...layout.notePosition(note) }))
                        }
                        const before = positions()
                        flip.execute()
                        flip.execute()
                        const after = positions()
                        const label = `${includeEvents}/${includeBpm}/${selection}/${connectorEase}`
                        if (
                            before.some(
                                (note, index) =>
                                    Math.abs(note.left - after[index]!.left) > 1e-5 ||
                                    Math.abs(note.size - after[index]!.size) > 1e-5,
                            )
                        )
                            failures.push(label)
                        const live = new Set(store.getAllEntities())
                        if (
                            history.state.value.selectedEntities.some((entity) => !live.has(entity))
                        )
                            failures.push(`${label}: stale selection`)
                    }
                }
            }
        }
        return failures
    })
    expect(failures).toEqual([])
})
