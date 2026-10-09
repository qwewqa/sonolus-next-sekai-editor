import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 4 },
                    { ...pivot, stageId: 2 as typeof pivot.stageId, beat: 0, pivotLane: -4 },
                ],
                slides: [
                    [
                        { ...base, beat: 2, left: 0, size: 2 },
                        { ...base, beat: 4, left: 0, size: 2, isAttached: true },
                        { ...base, stageId: 2 as typeof base.stageId, beat: 6, left: 0, size: 4 },
                    ],
                ],
            },
            4,
        )
        view.layout = 'composed'
        view.snapping = 'absolute'
        settings.maxLane = 0
    })
})

for (const tool of ['select', 'note', 'slide'] as const) {
    for (const targetBeat of [0, 2, 4, 6, 8]) {
        test(`${tool} moves an attached note to beat ${targetBeat} with stable endpoint geometry`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ toolName, targetBeat }) => {
                    const { appImport, history, point } = window.editorTest
                    const source = history.state.value
                    const note = [...source.store.slides.note.values()]
                        .flat()
                        .find((note) => note.isAttached)!
                    history.replaceState({ ...source, selectedEntities: [note] })
                    const module = await appImport<
                        Record<string, import('../../src/editor/tools').Tool>
                    >(`/src/editor/tools/${toolName}${toolName === 'select' ? '.ts' : '/index.ts'}`)
                    const tool = module[toolName]!
                    const { sceneState } = await appImport<
                        typeof import('../../src/editor/sceneState')
                    >('/src/editor/sceneState.ts')
                    const { createComposedLayout } =
                        await appImport<typeof import('../../src/editor/composed')>(
                            '/src/editor/composed.ts',
                        )
                    const modifiers = { ctrl: false, shift: false }
                    const start = point(1.5, 4)
                    const end = point(1.5, targetBeat)
                    tool.dragStart!(start.x, start.y, modifiers)
                    tool.dragUpdate!(end.x, end.y, modifiers)
                    const preview = sceneState.value
                    const previewNote = preview.selectedEntities.find(
                        (entity) => entity.type === 'note',
                    )!
                    const previewPosition = createComposedLayout(preview).notePosition(previewNote)
                    await tool.dragEnd!(end.x, end.y, modifiers)
                    const final = history.state.value
                    const selected = final.selectedEntities.find(
                        (entity) => entity.type === 'note',
                    )!
                    return {
                        previewPosition,
                        position: createComposedLayout(final).notePosition(selected),
                        beat: selected.beat,
                        unchanged: !history.canUndo.value,
                    }
                },
                { toolName: tool, targetBeat },
            )
            const position =
                targetBeat === 2
                    ? { left: 4, size: 2 }
                    : targetBeat === 6
                      ? { left: -4, size: 4 }
                      : { left: 0, size: 3 }
            expect(result).toEqual({
                previewPosition: position,
                position,
                beat: targetBeat,
                unchanged: targetBeat === 4,
            })
        })
    }
}

test('select predicts attached endpoints after multiple selected notes cross an unselected tail', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { history, appImport, point } = window.editorTest
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        history.replaceState({ ...source, selectedEntities: notes.slice(0, 2) })
        const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
            '/src/editor/tools/select.ts',
        )
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        const start = point(5, 2)
        const end = point(5, 8)
        const modifiers = { ctrl: false, shift: false }
        select.dragStart!(start.x, start.y, modifiers)
        select.dragUpdate!(end.x, end.y, modifiers)
        await select.dragEnd!(end.x, end.y, modifiers)
        const final = history.state.value
        const layout = createComposedLayout(final)
        return final.selectedEntities
            .filter((entity) => entity.type === 'note')
            .sort((a, b) => a.beat - b.beat)
            .map((note) => ({ beat: note.beat, ...layout.notePosition(note) }))
    })
    expect(result).toEqual([
        { beat: 8, left: 4, size: 2 },
        // The grabbed head anchors the raw move. Its attached companion keeps
        // the same authored lane when it becomes the new endpoint.
        { beat: 10, left: 4, size: 3 },
    ])
})
