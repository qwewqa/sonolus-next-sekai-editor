import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const click = async (page: Page, lane: number, beat: number) => {
    const p = await point(page, lane, beat)
    await page.mouse.click(p.x, p.y)
    await settle(page)
}

const snapshot = (page: Page) =>
    page.evaluate(async () => {
        const entry = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/preview/edit.ts')
        const { getPreviewState, previewEdit } = (await import(
            entry?.name ?? '/src/preview/edit.ts'
        )) as typeof import('../../src/preview/edit')
        const { history, view } = window.editorTest
        const preview = getPreviewState(history.state.value)
        return {
            ...window.editorTest.snapshot(),
            cursor: view.cursorTime,
            canUndo: history.canUndo.value,
            hasEdit: !!previewEdit.value,
            previewNotes: [...preview.store.slides.note.values()]
                .flat()
                .map(({ beat, left, size }) => ({ beat, left, size }))
                .sort((a, b) => a.beat - b.beat),
        }
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
})

test('selecting objects preserves preview time, while empty clicks still seek', async ({
    page,
}) => {
    await click(page, -3, 3)
    expect((await snapshot(page)).cursor).toBe(3)
    expect((await snapshot(page)).selected.map((entity) => entity.beat)).toEqual([3])
    await page.keyboard.down('Control')
    await click(page, 1, 5)
    await page.keyboard.up('Control')
    expect((await snapshot(page)).cursor).toBe(3)
    expect((await snapshot(page)).selected.map((entity) => entity.beat)).toEqual([3, 5])
    await click(page, -7, 8)
    expect((await snapshot(page)).cursor).toBe(4)
    expect((await snapshot(page)).selected).toEqual([])
})

test('dragged selection appears in preview before commit without seeking or adding undo steps', async ({
    page,
}) => {
    await click(page, -3, 3)
    const start = await point(page, -3, 3)
    const end = await point(page, -2, 4)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    const during = await snapshot(page)
    expect(during.cursor).toBe(3)
    expect(during.canUndo).toBe(false)
    expect(during.hasEdit).toBe(true)
    expect(during.notes).toContainEqual({ type: 'note', beat: 3, left: -4, size: 2 })
    expect(during.previewNotes).toContainEqual({ beat: 4, left: -3, size: 2 })
    expect(during.previewNotes.map((note) => note.beat)).not.toContain(3)

    // A small pointer change within the same snapped position must preserve the
    // resolved state, so it cannot rebuild the preview chart on every pixel.
    const before = await page.evaluate(async () => {
        const { previewEdit } = await import('/src/preview/edit.ts')
        const edit = previewEdit.value
        ;(window as unknown as { heldPreviewEdit: unknown }).heldPreviewEdit = edit
        return !!edit
    })
    expect(before).toBe(true)
    await page.mouse.move(end.x + 2, end.y + 1)
    await settle(page)
    expect(
        await page.evaluate(async () => {
            const { previewEdit } = await import('/src/preview/edit.ts')
            return (
                previewEdit.value ===
                (window as unknown as { heldPreviewEdit: unknown }).heldPreviewEdit
            )
        }),
    ).toBe(true)

    await page.mouse.up()
    await settle(page)
    const after = await snapshot(page)
    expect(after.cursor).toBe(3)
    expect(after.hasEdit).toBe(false)
    expect(after.canUndo).toBe(true)
    expect(after.previewNotes).toEqual(during.previewNotes)
    await page.keyboard.press('z')
    await settle(page)
    expect((await snapshot(page)).canUndo).toBe(false)
    expect((await snapshot(page)).notes.map((note) => note.beat)).toEqual([3, 5, 7, 9])
})

test('dragging an unselected note edge resizes the preview without changing its time', async ({
    page,
}) => {
    const start = await point(page, -4, 3)
    const end = await point(page, -5, 4)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    const during = await snapshot(page)
    expect(during.cursor).toBe(3)
    expect(during.previewNotes).toContainEqual({ beat: 3, left: -5, size: 3 })
    expect(during.notes).toContainEqual({ type: 'note', beat: 3, left: -4, size: 2 })
    await page.mouse.up()
    await settle(page)
    expect((await snapshot(page)).cursor).toBe(3)
    expect((await snapshot(page)).previewNotes).toEqual(during.previewNotes)
})

test('cancelling a touch drag restores the committed preview and original selection', async ({
    page,
}) => {
    const start = await point(page, -3, 3)
    const end = await point(page, -2, 4)
    const touch = (type: string, p: { x: number; y: number }) =>
        page.evaluate(
            ({ type, p }) => {
                const target = document.querySelector('.editor')!
                const contact = new Touch({
                    identifier: 1,
                    target,
                    clientX: p.x,
                    clientY: p.y,
                })
                target.dispatchEvent(
                    new TouchEvent(type, {
                        changedTouches: [contact],
                        bubbles: true,
                        cancelable: true,
                    }),
                )
            },
            { type, p },
        )
    await touch('touchstart', start)
    await touch('touchmove', end)
    await settle(page)
    expect((await snapshot(page)).previewNotes).toContainEqual({ beat: 4, left: -3, size: 2 })
    await touch('touchcancel', end)
    await settle(page)
    const after = await snapshot(page)
    expect(after.hasEdit).toBe(false)
    expect(after.canUndo).toBe(false)
    expect(after.cursor).toBe(3)
    expect(after.selected).toEqual([])
    expect(after.previewNotes).toContainEqual({ beat: 3, left: -4, size: 2 })
})

const startMove = async (page: Page) => {
    const start = await point(page, -3, 3)
    const end = await point(page, -2, 4)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    expect((await snapshot(page)).hasEdit).toBe(true)
}

test('switching tools mid-drag cancels the preview and cannot commit on mouse release', async ({
    page,
}) => {
    await startMove(page)
    await page.keyboard.press('a')
    await settle(page)
    expect((await snapshot(page)).hasEdit).toBe(false)
    expect((await snapshot(page)).creating).toEqual([])
    await page.mouse.up()
    await settle(page)
    expect((await snapshot(page)).canUndo).toBe(false)
    expect((await snapshot(page)).notes.map((note) => note.beat)).toEqual([3, 5, 7, 9])
    await click(page, -7, 8)
    expect((await snapshot(page)).notes.map((note) => note.beat)).toEqual([3, 5, 7, 8, 9])
})

test('undo during a drag cancels its draft and preserves the restored history state', async ({
    page,
}) => {
    await page.keyboard.press('a')
    await click(page, -7, 8)
    const selectKey = await page.evaluate(() => window.editorTest.settings.keyboardShortcuts.select)
    await page.keyboard.press(selectKey!)
    await startMove(page)
    await page.keyboard.press('z')
    await settle(page)
    expect((await snapshot(page)).hasEdit).toBe(false)
    expect((await snapshot(page)).canUndo).toBe(false)
    expect((await snapshot(page)).creating).toEqual([])
    await page.mouse.up()
    await settle(page)
    const after = await snapshot(page)
    expect(after.canUndo).toBe(false)
    expect(after.notes.map((note) => note.beat)).toEqual([3, 5, 7, 9])
    expect(after.previewNotes).toContainEqual({ beat: 3, left: -4, size: 2 })
})

for (const boundary of ['blur', 'unmount'] as const) {
    test(`${boundary} cancels active editor gestures and clears their draft`, async ({ page }) => {
        await startMove(page)
        await page.evaluate((boundary) => {
            if (boundary === 'blur') {
                window.dispatchEvent(new Event('blur'))
            } else {
                const root = document.querySelector('#app') as Element & {
                    __vue_app__: { unmount: () => void }
                }
                root.__vue_app__.unmount()
            }
        }, boundary)
        const after = await snapshot(page)
        expect(after.hasEdit).toBe(false)
        expect(after.canUndo).toBe(false)
        expect(after.creating).toEqual([])
        expect(
            await page.evaluate(async () => {
                const { isDragging } =
                    await import('/src/editor/controls/gestures/recognizers/drag.ts')
                return isDragging.value
            }),
        ).toBe(0)
        if (boundary === 'blur') {
            await page.evaluate(() => window.dispatchEvent(new Event('focus')))
            await page.mouse.up()
            await settle(page)
            expect((await snapshot(page)).canUndo).toBe(false)
        }
    })
}
