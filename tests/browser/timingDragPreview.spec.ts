import { expect, test, type Page } from '@playwright/test'
import type { GroupId } from '../../src/chart/groups'
import type { TimeScaleObject } from '../../src/chart/timeScale'
import type { State } from '../../src/state'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    pageErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(({ page }) => {
    expect(pageErrors.get(page), 'uncaught browser errors').toEqual([])
})

test('BPM drag previews preserve the initial tempo, replace overlaps and leave preview time unchanged', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const moduleUrls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(moduleUrls.get(pathname) ?? pathname)
        const { bpm } = await appImport<typeof import('../../src/editor/tools/bpm')>(
            '/src/editor/tools/bpm/index.ts',
        )
        const { getPreviewState, previewEdit } =
            await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
        const { show, fixtures, history, view, point } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 4, bpm: 180 },
                ],
            },
            2,
        )
        view.cursorTime = 1.125
        const modifiers = { ctrl: false, shift: false }
        const bpmsOf = (current: State) =>
            [...current.store.grid.bpm.values()]
                .flatMap((entities) => [...entities])
                .map(({ beat, bpm }) => ({ beat, bpm }))
                .sort((a, b) => a.beat - b.beat)
        const start = point(6.5, 0)
        await bpm.tap!(start.x, start.y, modifiers)
        const cursorAfterTap = view.cursorTime
        const started = bpm.dragStart!(start.x, start.y, modifiers)
        const target = point(6.5, 4)
        bpm.dragUpdate!(target.x, target.y, modifiers)
        const sourceDuringDrag = history.state.value
        const during = {
            preview: bpmsOf(getPreviewState(sourceDuringDrag)),
            source: bpmsOf(sourceDuringDrag),
            cursorTime: view.cursorTime,
            canUndo: history.canUndo.value,
        }
        await bpm.dragEnd!(target.x, target.y, modifiers)
        const after = {
            committed: bpmsOf(history.state.value),
            cursorTime: view.cursorTime,
            previewCleared: previewEdit.value === undefined,
            previewUsesHistory: getPreviewState(history.state.value) === history.state.value,
            canUndo: history.canUndo.value,
        }

        // Cancelling a second move must restore the committed chart without
        // adding an undo entry or leaving the temporary tempo in the preview.
        const secondStart = point(6.5, 4)
        bpm.dragStart!(secondStart.x, secondStart.y, modifiers)
        const beforeCancel = history.state.value
        const cancelTarget = point(6.5, 2)
        bpm.dragUpdate!(cancelTarget.x, cancelTarget.y, modifiers)
        const cancelledPreview = bpmsOf(getPreviewState(history.state.value))
        bpm.dragCancel!()
        const cancelled = {
            preview: bpmsOf(getPreviewState(history.state.value)),
            cursorTime: view.cursorTime,
            sameHistory: history.state.value === beforeCancel,
            previewCleared: previewEdit.value === undefined,
        }
        history.undoState()
        return {
            started,
            cursorAfterTap,
            during,
            after,
            cancelledPreview,
            cancelled,
            undone: bpmsOf(history.state.value),
            canUndoAfterUndo: history.canUndo.value,
        }
    })

    const original = [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 180 },
    ]
    const moved = [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 120 },
    ]
    expect(result.started).toBe(true)
    expect(result.cursorAfterTap).toBe(1.125)
    expect(result.during).toEqual({
        preview: moved,
        source: original,
        cursorTime: 1.125,
        canUndo: false,
    })
    expect(result.after).toEqual({
        committed: result.during.preview,
        cursorTime: 1.125,
        previewCleared: true,
        previewUsesHistory: true,
        canUndo: true,
    })
    expect(result.cancelledPreview).toEqual([
        { beat: 0, bpm: 120 },
        { beat: 2, bpm: 120 },
    ])
    expect(result.cancelled).toEqual({
        preview: moved,
        cursorTime: 1.125,
        sameHistory: true,
        previewCleared: true,
    })
    expect(result.undone).toEqual(original)
    expect(result.canUndoAfterUndo).toBe(false)
})

test('time scale drag previews preserve hidden notes and replace only the matching group', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const moduleUrls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(moduleUrls.get(pathname) ?? pathname)
        const { timeScale } = await appImport<typeof import('../../src/editor/tools/timeScale')>(
            '/src/editor/tools/timeScale/index.ts',
        )
        const { getPreviewState, previewEdit } =
            await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
        const { show, fixtures, history, view, point } = window.editorTest
        const hidden: TimeScaleObject = {
            groupId: 1 as GroupId,
            beat: 2,
            editorLane: 3,
            timeScale: -1,
            skip: 0.5,
            timeScaleEase: 'inQuad',
            timeScaleTransition: 'scroll',
            hideNotes: true,
        }
        show(
            {
                ...fixtures.interaction,
                timeScales: [
                    hidden,
                    { ...hidden, beat: 4, timeScale: 2, hideNotes: false },
                    { ...hidden, groupId: 2 as GroupId, beat: 4, timeScale: 3 },
                ],
            },
            2,
        )
        view.cursorTime = 1.125
        const modifiers = { ctrl: false, shift: false }
        const timeScalesOf = (current: State) =>
            [...current.store.grid.timeScale.values()]
                .flatMap((entities) => [...entities])
                .map(({ type: _type, hitbox: _hitbox, ...object }) => object)
                .sort((a, b) => a.groupId - b.groupId || a.beat - b.beat)
        const original = timeScalesOf(history.state.value)
        const start = point(3, 2)
        await timeScale.tap!(start.x, start.y, modifiers)
        const cursorAfterTap = view.cursorTime
        timeScale.dragStart!(start.x, start.y, modifiers)
        const target = point(5, 4)
        timeScale.dragUpdate!(target.x, target.y, modifiers)
        const during = {
            preview: timeScalesOf(getPreviewState(history.state.value)),
            source: timeScalesOf(history.state.value),
            ghost: view.entities.creating.map(({ hitbox: _hitbox, ...entity }) => entity),
            cursorTime: view.cursorTime,
            canUndo: history.canUndo.value,
        }
        await timeScale.dragEnd!(target.x, target.y, modifiers)
        const after = {
            committed: timeScalesOf(history.state.value),
            cursorTime: view.cursorTime,
            previewCleared: previewEdit.value === undefined,
            previewUsesHistory: getPreviewState(history.state.value) === history.state.value,
        }

        const secondStart = point(5, 4)
        timeScale.dragStart!(secondStart.x, secondStart.y, modifiers)
        const beforeCancel = history.state.value
        const cancelTarget = point(-2, 3)
        timeScale.dragUpdate!(cancelTarget.x, cancelTarget.y, modifiers)
        const cancelledPreview = timeScalesOf(getPreviewState(history.state.value))
        timeScale.dragCancel!()
        const cancelled = {
            preview: timeScalesOf(getPreviewState(history.state.value)),
            sameHistory: history.state.value === beforeCancel,
            cursorTime: view.cursorTime,
            previewCleared: previewEdit.value === undefined,
        }
        history.undoState()
        return {
            original,
            hidden,
            cursorAfterTap,
            during,
            after,
            cancelledPreview,
            cancelled,
            undone: timeScalesOf(history.state.value),
            canUndoAfterUndo: history.canUndo.value,
        }
    })

    const moved = { ...result.hidden, beat: 4, editorLane: 5 }
    const otherGroup = result.original.find(({ groupId }) => groupId === 2)!
    expect(result.cursorAfterTap).toBe(1.125)
    expect(result.during).toEqual({
        preview: [moved, otherGroup],
        source: result.original,
        ghost: [{ type: 'timeScale', ...moved }],
        cursorTime: 1.125,
        canUndo: false,
    })
    expect(result.after).toEqual({
        committed: result.during.preview,
        cursorTime: 1.125,
        previewCleared: true,
        previewUsesHistory: true,
    })
    expect(result.cancelledPreview).toEqual([{ ...moved, beat: 3, editorLane: -2 }, otherGroup])
    expect(result.cancelled).toEqual({
        preview: result.after.committed,
        sameHistory: true,
        cursorTime: 1.125,
        previewCleared: true,
    })
    expect(result.undone).toEqual(result.original)
    expect(result.canUndoAfterUndo).toBe(false)
})
