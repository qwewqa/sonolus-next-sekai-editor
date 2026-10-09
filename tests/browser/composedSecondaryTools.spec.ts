import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

for (const mode of ['basic-dynamic', 'composed-dynamic', 'composed-static'] as const) {
    for (const name of ['brush', 'eraser', 'generateSlideNotes'] as const) {
        for (const gesture of ['tap', 'box'] as const) {
            test(`${mode}: ${name} ${gesture} uses visible note geometry and supports undo`, async ({
                page,
            }) => {
                await page.addInitScript(installCanvasCounters)
                await page.goto('/')
                await expect(page.locator('canvas.editor-chart')).toBeVisible()
                await page.evaluate(installEditorFixture)
                const result = await page.evaluate(
                    async ({ mode, name, gesture }) => {
                        const { fixtures, show, view, point, history, appImport } =
                            window.editorTest
                        const base = fixtures.interaction.slides[0]![0]!
                        const pivot = fixtures.events.stagePivotEvents[0]!
                        show(
                            {
                                ...fixtures.interaction,
                                isDynamicStages: mode !== 'composed-static',
                                stagePivotEvents: [{ ...pivot, beat: 0, pivotLane: 4 }],
                                slides: [
                                    [4, 6].map((beat) => ({ ...base, beat, left: 0, size: 1 })),
                                    [4, 6].map((beat) => ({ ...base, beat, left: 4, size: 1 })),
                                ],
                            },
                            3,
                        )
                        view.layout = mode === 'basic-dynamic' ? 'basic' : 'composed'
                        view.division = 1
                        const source = history.state.value
                        const [targetId, decoyId] = [...source.store.slides.note.keys()]
                        const { tools } = await appImport<typeof import('../../src/editor/tools')>(
                            '/src/editor/tools/index.ts',
                        )
                        const { brushProperties } = await appImport<
                            typeof import('../../src/editor/tools/brush')
                        >('/src/editor/tools/brush/index.ts')
                        brushProperties.value = { isCritical: true }
                        const tool = tools[name]
                        const lane = mode === 'composed-dynamic' ? 4.5 : 0.5
                        const modifiers = { ctrl: false, shift: false }
                        if (gesture === 'tap') {
                            const p = point(lane, 4)
                            await tool.tap!(p.x, p.y, modifiers)
                        } else {
                            const start = point(lane - 0.6, 3.8)
                            const end = point(lane + 0.6, 4.2)
                            tool.dragStart!(start.x, start.y, modifiers)
                            tool.dragUpdate!(end.x, end.y, modifiers)
                            await tool.dragEnd!(end.x, end.y, modifiers)
                        }
                        const notes = history.state.value.store.slides.note
                        const target = notes.get(targetId!) ?? []
                        const targetResult = target.map((note) => ({
                            beat: note.beat,
                            critical: note.isCritical,
                            attached: note.isAttached,
                        }))
                        const decoyUnchanged =
                            notes.get(decoyId!) === source.store.slides.note.get(decoyId!)
                        const undoAvailable = history.canUndo.value
                        history.undoState()
                        const restored = history.state.value.store === source.store
                        return { targetResult, decoyUnchanged, undoAvailable, restored }
                    },
                    { mode, name, gesture },
                )
                const plain = (beat: number) => ({ beat, critical: false, attached: false })
                const targetResult =
                    name === 'eraser'
                        ? [plain(6)]
                        : name === 'brush'
                          ? [{ ...plain(4), critical: true }, plain(6)]
                          : [plain(4), { ...plain(5), attached: true }, plain(6)]
                expect(result).toEqual({
                    targetResult,
                    decoyUnchanged: true,
                    undoAvailable: true,
                    restored: true,
                })
            })
        }
    }
}
