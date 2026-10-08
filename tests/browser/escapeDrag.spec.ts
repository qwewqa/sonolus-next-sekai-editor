import { expect, test, type Page } from '@playwright/test'
import type { CommandName } from '../../src/editor/commands'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Escape during a drag cancels only the drag; the release after it does nothing.

const pageErrors = new WeakMap<Page, string[]>()

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const snapshot = (page: Page) => page.evaluate(() => window.editorTest.snapshot())
const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const command = async (page: Page, name: CommandName) => {
    const shortcut = await page.evaluate(
        (name) => window.editorTest.settings.keyboardShortcuts[name],
        name,
    )
    expect(shortcut, `keyboard shortcut for ${name}`).toBeTruthy()
    await page.keyboard.press(shortcut!)
    await settle(page)
}

const undoCount = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        let count = 0
        while (history.canUndo.value) {
            history.undoState()
            count++
        }
        for (let i = 0; i < count; i++) history.redoState()
        return count
    })

const selectedBeats = async (page: Page) =>
    (await snapshot(page)).selected.map(({ beat }) => beat).sort((a, b) => a - b)

const select = (page: Page, beats: number[]) =>
    page.evaluate(async (beats) => {
        const { history, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()]
                .flat()
                .filter(({ beat }) => beats.includes(beat)),
        })
        await nextTick()
    }, beats)

const notice = (page: Page) =>
    page.evaluate(() => document.querySelector('.notification')?.textContent?.trim() ?? null)

// No box, ghost or drag notice is left over; a notice from before the drag stays.
const expectIdle = async (page: Page, before: string | null) => {
    expect([null, before]).toContain(await notice(page))
    expect(await page.evaluate(() => window.editorTest.view.selection)).toBeUndefined()
    expect((await snapshot(page)).creating).toEqual([])
}

/** Drags from one point to another, presses Escape, moves on and releases. */
const cancelDrag = async (
    page: Page,
    from: [number, number],
    to: [number, number],
    during?: () => Promise<void>,
) => {
    const notes = (await snapshot(page)).notes
    const selected = await selectedBeats(page)
    const undos = await undoCount(page)
    const before = await notice(page)
    const start = await point(page, ...from)
    const end = await point(page, ...to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    await during?.()
    await page.keyboard.press('Escape')
    await settle(page)
    await expectIdle(page, before)
    expect(await selectedBeats(page)).toEqual(selected)
    // The release after the cancel does nothing.
    await page.mouse.move(end.x + 40, end.y - 40, { steps: 4 })
    await page.mouse.up()
    await settle(page)
    expect((await snapshot(page)).notes).toEqual(notes)
    expect(await selectedBeats(page)).toEqual(selected)
    expect(await undoCount(page)).toBe(undos)
    expect([null, before]).toContain(await notice(page))
}

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    pageErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'selectContextMenu'
    })
    await settle(page)
    // Notes at beats 3 (lane -4), 5 (lane 0), 7 (lane 3) and 9 (lane -2), each 2 wide.
    expect((await snapshot(page)).notes.map(({ beat }) => beat)).toEqual([3, 5, 7, 9])
})

test.afterEach(({ page }) => {
    expect(pageErrors.get(page), 'uncaught browser errors').toEqual([])
})

test('Escape cancels a Select move of the selection', async ({ page }) => {
    await command(page, 'select')
    await select(page, [3, 5])
    await cancelDrag(page, [1, 5], [3, 6], async () => {
        await expect(page.locator('.notification')).toHaveText('Moving 2 objects')
    })
})

test('Escape cancels a Select move of an unselected note and keeps the selection', async ({
    page,
}) => {
    await command(page, 'select')
    await select(page, [9])
    await cancelDrag(page, [4, 7], [6, 8], async () => {
        expect(await selectedBeats(page)).toEqual([7])
    })
})

test('Escape cancels a box select and keeps the selection from before it', async ({ page }) => {
    await command(page, 'select')
    await select(page, [3])
    await cancelDrag(page, [-9, 4.5], [9, 7.5], async () => {
        expect(await selectedBeats(page)).toEqual([5, 7])
    })
})

test('Escape cancels a note placement drag', async ({ page }) => {
    await command(page, 'note')
    await select(page, [9])
    await cancelDrag(page, [-6, 11], [-2, 11], async () => {
        expect((await snapshot(page)).creating).toHaveLength(1)
    })
})

test('Escape cancels a resize', async ({ page }) => {
    await command(page, 'note')
    await select(page, [9])
    await cancelDrag(page, [4.8, 7], [7.5, 7], async () => {
        expect((await snapshot(page)).creating).toEqual([
            { type: 'note', beat: 7, left: 3, size: 5 },
        ])
    })
})

test('Escape cancels a paste drag', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await command(page, 'select')
    await select(page, [3, 5])
    await command(page, 'copy')
    await command(page, 'paste')
    await cancelDrag(page, [0, 11], [2, 12], async () => {
        expect((await snapshot(page)).creating.length).toBeGreaterThan(0)
    })
})

test('Escape cancels an eraser stroke without erasing', async ({ page }) => {
    await command(page, 'eraser')
    await select(page, [9])
    await cancelDrag(page, [-9, 4.5], [9, 7.5], async () => {
        await expect(page.locator('.notification')).toHaveText('Erasing 2 objects')
    })
})

test('a held Escape that cancels a drag does nothing more as it repeats', async ({ page }) => {
    await command(page, 'select')
    await select(page, [3, 5])
    const start = await point(page, 1, 5)
    const end = await point(page, 3, 6)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    await page.keyboard.down('Escape')
    await page.keyboard.down('Escape')
    await page.keyboard.up('Escape')
    await page.mouse.up()
    await settle(page)
    expect(await selectedBeats(page)).toEqual([3, 5])
    expect((await snapshot(page)).notes.map(({ beat }) => beat)).toEqual([3, 5, 7, 9])
    // The next press deselects again.
    await page.keyboard.press('Escape')
    await settle(page)
    expect(await selectedBeats(page)).toEqual([])
})

test('a held Escape never cancels a drag started while it is held', async ({ page }) => {
    await command(page, 'select')
    const start = await point(page, 1, 5)
    const end = await point(page, 1, 6)
    const move = async () => {
        await select(page, [3, 5])
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(end.x, end.y, { steps: 8 })
        await settle(page)
        await expect(page.locator('.notification')).toHaveText('Moving 2 objects')
    }
    // Held after cancelling one drag, then held from before a drag.
    for (const cancelFirst of [true, false]) {
        if (cancelFirst) {
            await move()
            await page.keyboard.down('Escape')
            await page.mouse.up()
        } else {
            await page.keyboard.down('Escape')
        }
        await settle(page)
        await move()
        await page.keyboard.down('Escape')
        await settle(page)
        await expect(page.locator('.notification')).toHaveText('Moving 2 objects')
        await page.mouse.up()
        await page.keyboard.up('Escape')
        await settle(page)
        expect((await snapshot(page)).notes.map(({ beat }) => beat)).toEqual([4, 6, 7, 9])
        await command(page, 'undo')
    }
})

test('a dialog opened mid-drag cancels the drag', async ({ page }) => {
    await command(page, 'select')
    for (const key of ['h', ',']) {
        await select(page, [3, 5])
        const notes = (await snapshot(page)).notes
        const start = await point(page, 1, 5)
        const end = await point(page, 3, 6)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(end.x, end.y, { steps: 8 })
        await settle(page)
        await expect(page.locator('.notification')).toHaveText('Moving 2 objects')
        await page.keyboard.press(key)
        const dialog = page.locator('dialog[open]')
        await expect(dialog).toBeVisible()
        await settle(page)
        await expectIdle(page, null)
        expect(await selectedBeats(page)).toEqual([3, 5])
        await page.mouse.up()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await settle(page)
        expect((await snapshot(page)).notes).toEqual(notes)
        expect(await selectedBeats(page)).toEqual([3, 5])
        expect(await undoCount(page)).toBe(0)
    }
})

test('a paste drag whose release asks to enable dynamic stages still pastes', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(async () => {
        const { show, fixtures, history, store, nextTick } = window.editorTest
        show({ ...fixtures.events, isDynamicStages: true }, 3)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'stageMaskEventJoint',
            ),
        })
        await nextTick()
    })
    await command(page, 'copy')
    await page.evaluate(() => {
        const { show, fixtures } = window.editorTest
        show(fixtures.interaction, 3)
    })
    await command(page, 'paste')
    const start = await point(page, 0, 11)
    const end = await point(page, 2, 12)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.notification')).toHaveText('Pasted 4 objects')
    expect(await undoCount(page)).toBe(2)
})

test('Escape with no drag still deselects', async ({ page }) => {
    await command(page, 'select')
    await select(page, [3, 5])
    await page.keyboard.press('Escape')
    await settle(page)
    expect(await selectedBeats(page)).toEqual([])
})

test.describe('touch', () => {
    test.use({ hasTouch: true })

    test('Escape cancels a touch drag, and the finger lifts without effect', async ({ page }) => {
        await page.evaluate(() => {
            window.editorTest.settings.touchQuickScrollZone = 0
        })
        await command(page, 'select')
        await select(page, [7])
        const touch = (type: string, x: number, y: number) =>
            page.evaluate(
                ({ type, x, y }) => {
                    const target = document.querySelector('.editor')!
                    target.dispatchEvent(
                        new TouchEvent(type, {
                            changedTouches: [
                                new Touch({ identifier: 1, target, clientX: x, clientY: y }),
                            ],
                            bubbles: true,
                            cancelable: true,
                        }),
                    )
                },
                { type, x, y },
            )
        const notes = (await snapshot(page)).notes
        const start = await point(page, 4, 7)
        const end = await point(page, 6, 8)
        await touch('touchstart', start.x, start.y)
        for (let step = 1; step <= 5; step++)
            await touch(
                'touchmove',
                start.x + ((end.x - start.x) * step) / 5,
                start.y + ((end.y - start.y) * step) / 5,
            )
        await settle(page)
        await expect(page.locator('.notification')).toHaveText('Moving 1 object')
        await page.keyboard.press('Escape')
        await settle(page)
        await expectIdle(page, null)
        for (let step = 1; step <= 5; step++)
            await touch('touchmove', end.x - step * 20, end.y + step * 20)
        await touch('touchend', end.x - 100, end.y + 100)
        await settle(page)
        expect((await snapshot(page)).notes).toEqual(notes)
        expect(await selectedBeats(page)).toEqual([7])
        expect(await undoCount(page)).toBe(0)
        expect(
            await page.evaluate(() => [
                window.editorTest.view.scrollingX,
                window.editorTest.view.scrollingY,
            ]),
        ).toEqual([undefined, undefined])
    })
})

test.describe('a drag that leaves the chart pane', () => {
    const pane = async (page: Page) => (await page.locator('.editor').first().boundingBox())!

    test('continues outside and lands only on release', async ({ page }) => {
        await command(page, 'select')
        const start = await point(page, 1, 5)
        const end = await point(page, 3, 6)
        const drag = async (outside?: { x: number; y: number }) => {
            await select(page, [3, 5])
            await page.mouse.move(start.x, start.y)
            await page.mouse.down()
            await page.mouse.move(end.x, end.y, { steps: 8 })
            if (outside) {
                await page.mouse.move(outside.x, outside.y, { steps: 4 })
                await settle(page)
                await expect(page.locator('.notification')).toHaveText('Moving 2 objects')
                expect(await undoCount(page)).toBe(0)
                await page.mouse.move(end.x, end.y, { steps: 4 })
            }
            await page.mouse.up()
            await settle(page)
            return (await snapshot(page)).notes
        }
        const moved = await drag()
        await command(page, 'undo')
        const box = await pane(page)
        expect(await drag({ x: box.x + box.width + 60, y: end.y })).toEqual(moved)
        await expect(page.locator('.notification')).toHaveText('Moved 2 objects')
        expect(await undoCount(page)).toBe(1)
    })

    test('cancels on Escape outside, and its release does nothing', async ({ page }) => {
        await command(page, 'select')
        await select(page, [3, 5])
        const box = await pane(page)
        await cancelDrag(page, [1, 5], [3, 6], async () => {
            await page.mouse.move(box.x + box.width + 60, (await point(page, 3, 6)).y)
            await settle(page)
        })
    })

    test('a paste drag pans past the top edge and pastes at the edge on release', async ({
        page,
        context,
    }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.evaluate(() => {
            window.editorTest.settings.dragToPanY = true
        })
        await command(page, 'select')
        await select(page, [3])
        await command(page, 'copy')
        await command(page, 'paste')
        const start = await point(page, 0, 6)
        const box = await pane(page)
        const time = () => page.evaluate(() => window.editorTest.view.time)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(start.x, start.y - 40, { steps: 4 })
        const before = await time()
        await page.mouse.move(start.x, box.y - 30, { steps: 4 })
        await expect.poll(time).toBeGreaterThan(before + 1)
        expect(await undoCount(page)).toBe(0)
        expect((await snapshot(page)).notes).toHaveLength(4)
        await page.mouse.up()
        await settle(page)
        expect(await undoCount(page)).toBe(1)
        expect((await snapshot(page)).notes).toHaveLength(5)
    })

    test('a release outside the window lands the drag', async ({ page }) => {
        await command(page, 'select')
        await select(page, [3, 5])
        const start = await point(page, 1, 5)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(start.x + 80, start.y, { steps: 8 })
        const viewport = page.viewportSize()!
        await page.mouse.move(viewport.width + 40, start.y, { steps: 4 })
        await page.mouse.up()
        await settle(page)
        expect(await undoCount(page)).toBe(1)
        expect(await page.evaluate(() => window.editorTest.view.selection)).toBeUndefined()
    })
})
