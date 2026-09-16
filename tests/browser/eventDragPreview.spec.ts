import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const cases = [
    { tool: 'cameraEvent', start: [0, 2], end: [1, 3], operation: 'move' },
    { tool: 'cameraEvent', start: [6, 2], end: [5, 2], operation: 'resize' },
    { tool: 'stageMaskEvent', start: [0, 2.5], end: [1, 3.5], operation: 'move' },
    { tool: 'stageMaskEvent', start: [5, 2.5], end: [4, 2.5], operation: 'resize' },
    { tool: 'stagePivotEvent', start: [-3, 3], end: [-2, 4], operation: 'move' },
    { tool: 'stageStyleEvent', start: [-8, 3.5], end: [-7, 4.5], operation: 'move' },
    { tool: 'stageTransformEvent', start: [7, 4], end: [8, 5], operation: 'move' },
] as const

for (const scenario of cases) {
    test(`${scenario.tool} ${scenario.operation} previews immediately, keeps time, and cancels cleanly`, async ({
        page,
    }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.addInitScript(installCanvasCounters)
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)

        const result = await page.evaluate(async (scenario) => {
            const moduleUrls = new Map(
                performance
                    .getEntriesByType('resource')
                    .map((entry) => [new URL(entry.name).pathname, entry.name]),
            )
            const appImport = <T>(pathname: string): Promise<T> =>
                import(moduleUrls.get(pathname) ?? pathname)
            const { tools } = await appImport<typeof import('../../src/editor/tools')>(
                '/src/editor/tools/index.ts',
            )
            const { getPreviewState, previewEdit } =
                await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
            const { history, view, point, show, fixtures, nextTick } = window.editorTest
            show(fixtures.events, 3)
            view.cursorTime = 3.125
            await nextTick()

            const tool = tools[scenario.tool]
            const modifiers = { ctrl: false, shift: false }
            const start = point(...scenario.start)
            const end = point(...scenario.end)
            const serialize = (value: unknown) =>
                JSON.stringify(value, (_, item: unknown) =>
                    item instanceof Map ? [...item.entries()] : item,
                )

            await tool.tap!(start.x, start.y, modifiers)
            const tapTime = view.cursorTime
            const selectedType = history.state.value.selectedEntities[0]?.type
            const started = tool.dragStart!(start.x, start.y, modifiers)
            const source = history.state.value
            tool.dragUpdate!(end.x, end.y, modifiers)
            const preview = getPreviewState(source)
            const previewStore = serialize(preview.store)
            const updatedTime = view.cursorTime
            const during = {
                changed: preview.store !== source.store,
                sourceUnchanged: history.state.value === source,
                canUndo: history.canUndo.value,
                beat: preview.selectedEntities[0]?.beat,
                memoized: getPreviewState(source) === preview,
            }

            tool.dragUpdate!(end.x, end.y, modifiers)
            const pendingEdit = previewEdit.value
            tool.dragCancel!()
            const cancelled = {
                cleared: previewEdit.value === undefined,
                original: getPreviewState(source) === source,
                sourceUnchanged: history.state.value === source,
                canUndo: history.canUndo.value,
            }
            // The previous callback may still exist when cancelled. It must own
            // its inputs and remain safe after the tool clears its active drag.
            const capturedPreview = serialize(pendingEdit?.resolve().store) === previewStore

            tool.dragStart!(start.x, start.y, modifiers)
            tool.dragUpdate!(end.x, end.y, modifiers)
            await tool.dragEnd!(end.x, end.y, modifiers)
            const committed = {
                matchingStore: serialize(history.state.value.store) === previewStore,
                cleared: previewEdit.value === undefined,
                canUndo: history.canUndo.value,
                time: view.cursorTime,
            }
            history.undoState()
            const undoStore = history.state.value.store === source.store
            const empty = point(0, 10)
            await tool.tap!(empty.x, empty.y, modifiers)

            return {
                started,
                selectedType,
                tapTime,
                updatedTime,
                during,
                cancelled,
                capturedPreview,
                committed,
                undoStore,
                emptyTime: view.cursorTime,
            }
        }, scenario)

        expect(result.started).toBe(true)
        expect(result.selectedType).toBe(`${scenario.tool}Joint`)
        expect(result.tapTime).toBe(3.125)
        expect(result.updatedTime).toBe(3.125)
        expect(result.during).toEqual({
            changed: true,
            sourceUnchanged: true,
            canUndo: false,
            beat: scenario.end[1],
            memoized: true,
        })
        expect(result.cancelled).toEqual({
            cleared: true,
            original: true,
            sourceUnchanged: true,
            canUndo: false,
        })
        expect(result.capturedPreview).toBe(true)
        expect(result.committed).toEqual({
            matchingStore: true,
            cleared: true,
            canUndo: true,
            time: 3.125,
        })
        expect(result.undoStore).toBe(true)
        expect(result.emptyTime).toBe(5)
        expect(errors).toEqual([])
    })
}
