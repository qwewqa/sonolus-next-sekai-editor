import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const layout of ['basic', 'composed'] as const)
    test(`${layout} copy/paste preserves authored attachment elevation, ghost geometry and undo`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (layout) => {
            const { appImport, fixtures, show, history, view, settings, point } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    stagePivotEvents: [
                        { ...fixtures.events.stagePivotEvents[0]!, beat: 0, pivotLane: 4 },
                    ],
                    slides: [
                        [
                            {
                                ...base,
                                beat: 2,
                                elevation: 0,
                                left: -1,
                                size: 2,
                                connectorEase: 'inQuad',
                            },
                            { ...base, beat: 2, elevation: 1, left: 99, size: 2, isAttached: true },
                            { ...base, beat: 2, elevation: 4, left: 2, size: 4 },
                        ],
                    ],
                },
                2,
            )
            settings.maxLane = 0
            view.layout = layout
            const source = history.state.value
            history.replaceState({
                ...source,
                selectedEntities: [...source.store.slides.note.values()].flat(),
            })
            // No hovered note: retain the existing first selected anchor.
            view.pointer = { ...view.pointer, ...point(30, 2) }
            const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
                '/src/editor/commands/copy/index.ts',
            )
            const { clipboardEntry } =
                await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
            const { paste, pasteAtPosition } = await appImport<
                typeof import('../../src/editor/tools/paste')
            >('/src/editor/tools/paste/index.ts')
            copy.execute()
            const copiedElevations = clipboardEntry
                .value!.data!.chart.slides.flat()
                .map((note) => note.elevation ?? 0)
            const lane = layout === 'composed' ? 6 : 2
            const target = point(lane, 6)
            paste.hover?.(target.x, target.y, { ctrl: false, shift: false })
            const snapshot = (notes: typeof source.selectedEntities) =>
                notes
                    .filter((note) => note.type === 'note')
                    .map((note) => ({
                        beat: note.beat,
                        center: note.left + note.size / 2,
                        size: note.size,
                        elevation: note.elevation,
                        attached: note.isAttached,
                    }))
            const ghost = snapshot(view.entities.creating)
            await pasteAtPosition(lane, 4, { ctrl: false, shift: false }, { composed: true })
            const committed = snapshot(history.state.value.selectedEntities)
            const { undoState, redoState } =
                await appImport<typeof import('../../src/history')>('/src/history/index.ts')
            undoState()
            const undo = snapshot([...history.state.value.store.slides.note.values()].flat())
            redoState()
            const redo = snapshot(history.state.value.selectedEntities)
            return { copiedElevations, ghost, committed, undo, redo }
        }, layout)
        expect(result.copiedElevations).toEqual([0, 1, 4])
        expect(result.ghost).toEqual(result.committed)
        expect(result.redo).toEqual(result.committed)
        expect(result.committed.map((note) => note.center)).toEqual([2, 2.25, 6])
        expect(result.committed.map((note) => note.elevation)).toEqual([0, 1, 4])
        expect(result.committed[1]!.size).toBe(2.125)
        expect(result.committed[1]!.attached).toBe(true)
        expect(result.undo.map((note) => note.center)).toEqual([0, 0.25, 4])
    })
