import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const name of [
    'note',
    'slide',
    'bpm',
    'timeScale',
    'cameraEvent',
    'stageMaskEvent',
    'stagePivotEvent',
    'stageStyleEvent',
    'stageTransformEvent',
] as const) {
    test(`${name} placement keeps preview time through tap, drag, cancellation, and undo`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (name) => {
            const toolsUrl = '/src/editor/tools/index.ts'
            const modalsUrl = '/src/modals/index.ts'
            const { tools } = (await import(toolsUrl)) as typeof import('../../src/editor/tools')
            const { modals } = (await import(modalsUrl)) as typeof import('../../src/modals')
            const { history, view, point, nextTick } = window.editorTest
            const tool = tools[name]
            const modifiers = { ctrl: false, shift: false }
            const original = history.state.value.store
            const times: number[] = []
            view.cursorTime = 2.25
            const start = point(0, 10)
            const end = point(1, 12)
            const closeProperties = async () => {
                for (const modal of modals.splice(0)) modal.resolve()
                await nextTick()
            }

            await tool.tap!(start.x, start.y, modifiers)
            times.push(view.cursorTime)
            const tapped = history.state.value.selectedEntities[0]?.beat
            await closeProperties()
            history.undoState()
            const tapUndone = history.state.value.store === original

            const started = tool.dragStart!(start.x, start.y, modifiers)
            times.push(view.cursorTime)
            tool.dragUpdate!(end.x, end.y, modifiers)
            times.push(view.cursorTime)
            const during = {
                ghostBeat: view.entities.creating[0]?.beat,
                sourceUnchanged: history.state.value.store === original,
                canUndo: history.canUndo.value,
            }
            tool.dragCancel!()
            times.push(view.cursorTime)
            const cancelled = history.state.value.store === original && !history.canUndo.value

            tool.dragStart!(start.x, start.y, modifiers)
            tool.dragUpdate!(end.x, end.y, modifiers)
            await tool.dragEnd!(end.x, end.y, modifiers)
            times.push(view.cursorTime)
            const dragged = history.state.value.selectedEntities[0]?.beat
            await closeProperties()
            history.undoState()
            times.push(view.cursorTime)
            return {
                tapped,
                tapUndone,
                started,
                during,
                cancelled,
                dragged,
                dragUndone: history.state.value.store === original && !history.canUndo.value,
                times,
            }
        }, name)

        expect(result).toEqual({
            tapped: 10,
            tapUndone: true,
            started: true,
            during: { ghostBeat: 12, sourceUnchanged: true, canUndo: false },
            cancelled: true,
            dragged: 12,
            dragUndone: true,
            times: [2.25, 2.25, 2.25, 2.25, 2.25, 2.25],
        })
    })
}

for (const name of ['note', 'slide'] as const) {
    test(`${name} edits preview connected notes during dragging without seeking or committing`, async ({
        page,
    }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        const result = await page.evaluate(async (name) => {
            const toolsUrl = '/src/editor/tools/index.ts'
            const previewUrl = '/src/preview/edit.ts'
            const { tools } = (await import(toolsUrl)) as typeof import('../../src/editor/tools')
            const { getPreviewState, previewEdit } = (await import(
                previewUrl
            )) as typeof import('../../src/preview/edit')
            const { history, view, fixtures, show, point } = window.editorTest
            const first = fixtures.interaction.slides[0]![0]!
            const last = fixtures.interaction.slides[2]![0]!
            show({ ...fixtures.interaction, slides: [[first, last]] }, 3)
            view.cursorTime = 2.25
            const tool = tools[name]
            const modifiers = { ctrl: false, shift: false }
            const brief = (state: (typeof history.state)['value']) => ({
                notes: [...state.store.slides.note.values()].flat().map(({ beat, left, size }) => ({
                    beat,
                    left,
                    size,
                })),
                connectors: [...state.store.slides.connector.values()]
                    .flat()
                    .map(({ head, tail }) => ({
                        head: { beat: head.beat, left: head.left, size: head.size },
                        tail: { beat: tail.beat, left: tail.left, size: tail.size },
                    })),
            })
            const start = point(-3, 3)
            await tool.tap?.(start.x, start.y, modifiers)
            const afterTap = view.cursorTime
            const original = brief(history.state.value)
            const target = point(-2, 4)
            tool.dragStart?.(start.x, start.y, modifiers)
            tool.dragUpdate?.(target.x, target.y, modifiers)
            const moving = brief(getPreviewState(history.state.value))
            const duringMove = {
                cursor: view.cursorTime,
                source: brief(history.state.value),
                canUndo: history.canUndo.value,
            }
            tool.dragCancel?.()
            const cancelled = {
                state: brief(getPreviewState(history.state.value)),
                noEdit: previewEdit.value === undefined,
                cursor: view.cursorTime,
            }

            tool.dragStart?.(start.x, start.y, modifiers)
            tool.dragUpdate?.(target.x, target.y, modifiers)
            await tool.dragEnd?.(target.x, target.y, modifiers)
            const moved = {
                state: brief(history.state.value),
                noEdit: previewEdit.value === undefined,
                cursor: view.cursorTime,
            }

            const edge = point(-3, 4)
            const resizedEdge = point(-4, 4)
            tool.dragStart?.(edge.x, edge.y, modifiers)
            tool.dragUpdate?.(resizedEdge.x, resizedEdge.y, modifiers)
            const resizing = brief(getPreviewState(history.state.value))
            const duringResize = view.cursorTime
            await tool.dragEnd?.(resizedEdge.x, resizedEdge.y, modifiers)
            const resized = brief(history.state.value)

            const empty = point(4, 10)
            await tool.tap?.(empty.x, empty.y, modifiers)
            return {
                original,
                afterTap,
                moving,
                duringMove,
                cancelled,
                moved,
                resizing,
                duringResize,
                resized,
                afterCreation: view.cursorTime,
            }
        }, name)

        expect(result.afterTap).toBe(2.25)
        expect(result.duringMove).toEqual({
            cursor: 2.25,
            source: result.original,
            canUndo: false,
        })
        expect(result.moving.notes[0]).toEqual({ beat: 4, left: -3, size: 2 })
        expect(result.moving.connectors[0]?.head).toEqual({ beat: 4, left: -3, size: 2 })
        expect(result.cancelled).toEqual({ state: result.original, noEdit: true, cursor: 2.25 })
        expect(result.moved).toEqual({ state: result.moving, noEdit: true, cursor: 2.25 })
        expect(result.resizing.notes[0]).toEqual({ beat: 4, left: -4, size: 3 })
        expect(result.resizing.connectors[0]?.head).toEqual({ beat: 4, left: -4, size: 3 })
        expect(result.duringResize).toBe(2.25)
        expect(result.resized).toEqual(result.resizing)
        expect(result.afterCreation).toBe(2.25)
        expect(errors).toEqual([])
    })
}
