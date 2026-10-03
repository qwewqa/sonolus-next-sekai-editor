import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test('note elevation supports editing, round trips, legacy defaults, and reset', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const result = await page.evaluate(async () => {
        const { createState } = await import('/src/state/index.ts')
        const { createEditedEntitiesState } = await import('/src/state/operations/edit.ts')
        const { serializeToLevelDataEntities } =
            await import('/src/levelData/entities/serialize/index.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const { buildPreviewChart } = await import('/src/preview/engine/chart.ts')
        const source = window.editorTest.fixtures.interaction
        const base = source.slides[0]![0]!
        const original = createState(
            { ...source, slides: [-0.5, 0, 1.25].map((elevation) => [{ ...base, elevation }]) },
            0,
        )
        const notes = [...original.store.slides.note.values()].flat()
        const edited = createEditedEntitiesState(original, [notes[0]!], { elevation: -1.5 })
        const serialize = (state: typeof original) =>
            serializeToLevelDataEntities(
                state.initialLife,
                state.isDynamicStages,
                state.store,
                state.groups,
                state.stages,
            )
        const first = serialize(edited)
        const imported = parseLevelDataChart(first)
        const second = parseLevelDataChart(serialize(createState(imported, 0)))
        const legacy = parseLevelDataChart(
            first.map((entity) => ({
                ...entity,
                data: entity.data.filter((item) => item.name !== 'elevation'),
            })),
        )
        const reset = createEditedEntitiesState(
            edited,
            [...edited.store.slides.note.values()].flat(),
            { elevation: 0 },
        )
        return {
            imported: imported.slides.flat().map((item) => item.elevation),
            second: second.slides.flat().map((item) => item.elevation),
            preview: buildPreviewChart(createState(imported, 0), 10).notes.map(
                (item) => item.elevation,
            ),
            legacy: legacy.slides.flat().map((item) => item.elevation),
            reset: [...reset.store.slides.note.values()].flat().map((item) => item.elevation),
        }
    })
    expect([...result.imported].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([-1.5, 0, 1.25])
    expect(result.second).toEqual(result.imported)
    expect(result.preview).toEqual(result.imported)
    expect(result.legacy).toEqual([0, 0, 0])
    expect(result.reset).toEqual([0, 0, 0])
})
