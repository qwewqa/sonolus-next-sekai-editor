import { expect, test, type Page } from '@playwright/test'
import type { CommandName } from '../../src/editor/commands'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Real pointer and keyboard input for tools and commands that other specs only
// drive through direct calls, on a desktop mouse.

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

const click = async (
    page: Page,
    lane: number,
    beat: number,
    modifiers: ('Control' | 'Shift')[] = [],
) => {
    const { x, y } = await point(page, lane, beat)
    for (const key of modifiers) await page.keyboard.down(key)
    await page.mouse.click(x, y)
    for (const key of modifiers) await page.keyboard.up(key)
    await settle(page)
}

const drag = async (
    page: Page,
    from: [number, number],
    to: [number, number],
    modifiers: ('Control' | 'Shift')[] = [],
) => {
    const start = await point(page, ...from)
    const end = await point(page, ...to)
    for (const key of modifiers) await page.keyboard.down(key)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 10 })
    await settle(page)
    await page.mouse.up()
    for (const key of modifiers) await page.keyboard.up(key)
    await settle(page)
}

const command = async (page: Page, name: CommandName) => {
    const shortcut = await page.evaluate(
        (name) => window.editorTest.settings.keyboardShortcuts[name],
        name,
    )
    expect(shortcut, `keyboard shortcut for ${name}`).toBeTruthy()
    await page.keyboard.press(shortcut!)
    await settle(page)
}

const run = (page: Page, name: CommandName) =>
    page.evaluate(async (name) => {
        const path = '/src/editor/commands/index.ts'
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { commands } = (await import(
            urls.get(path) ?? path
        )) as typeof import('../../src/editor/commands')
        void commands[name].execute()
    }, name)

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

const beats = async (page: Page) => (await snapshot(page)).notes.map(({ beat }) => beat)
const selectedBeats = async (page: Page) =>
    (await snapshot(page)).selected.map(({ beat }) => beat).sort((a, b) => a - b)

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
    expect(await beats(page)).toEqual([3, 5, 7, 9])
})

test.afterEach(({ page }) => {
    expect(pageErrors.get(page), 'uncaught browser errors').toEqual([])
})

test('Ctrl+click adds and removes notes; a plain click replaces the selection', async ({
    page,
}) => {
    await command(page, 'select')
    await click(page, -3, 3)
    expect(await selectedBeats(page)).toEqual([3])
    await click(page, 1, 5, ['Control'])
    expect(await selectedBeats(page)).toEqual([3, 5])
    await click(page, -3, 3, ['Control'])
    expect(await selectedBeats(page)).toEqual([5])
    await click(page, 4, 7)
    expect(await selectedBeats(page)).toEqual([7])
    // Empty space deselects.
    await click(page, 8, 6)
    expect(await selectedBeats(page)).toEqual([])
    expect(await undoCount(page)).toBe(0)
})

test('box selection replaces, and with Ctrl adds to, the selection', async ({ page }) => {
    await command(page, 'select')
    await drag(page, [-8, 2.5], [8, 5.5])
    expect(await selectedBeats(page)).toEqual([3, 5])
    await drag(page, [-8, 8.5], [8, 9.5], ['Control'])
    expect(await selectedBeats(page)).toEqual([3, 5, 9])
    await drag(page, [-8, 6.5], [8, 7.5])
    expect(await selectedBeats(page)).toEqual([7])
    expect(await undoCount(page)).toBe(0)
    expect(await page.evaluate(() => window.editorTest.view.selection)).toBeUndefined()
})

test('Escape deselects in another tool', async ({ page }) => {
    await command(page, 'select')
    await click(page, -3, 3)
    await command(page, 'note')
    await command(page, 'deselect')
    expect(await selectedBeats(page)).toEqual([])
})

test('the eraser removes a clicked note, a dragged box, and undoes', async ({ page }) => {
    await command(page, 'eraser')
    await click(page, 1, 5)
    expect(await beats(page)).toEqual([3, 7, 9])
    await drag(page, [-8, 6.5], [8, 9.5])
    expect(await beats(page)).toEqual([3])
    expect(await undoCount(page)).toBe(2)
    await command(page, 'undo')
    expect(await beats(page)).toEqual([3, 7, 9])
    // A click on empty space changes nothing.
    await click(page, 8, 4)
    expect(await beats(page)).toEqual([3, 7, 9])
    expect(await undoCount(page)).toBe(1)
})

test('the brush applies its properties to a clicked note and a dragged box', async ({ page }) => {
    await page.evaluate(async () => {
        const path = '/src/editor/tools/brush/index.ts'
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { brushProperties } = (await import(
            urls.get(path) ?? path
        )) as typeof import('../../src/editor/tools/brush')
        brushProperties.value = { isCritical: true }
    })
    await command(page, 'brush')
    const critical = () =>
        page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()]
                .filter((entity) => entity.type === 'note' && entity.isCritical)
                .map(({ beat }) => beat)
                .sort((a, b) => a - b),
        )
    await click(page, 1, 5)
    expect(await critical()).toEqual([5])
    await drag(page, [-8, 6.5], [8, 9.5])
    expect(await critical()).toEqual([5, 7, 9])
    expect(await undoCount(page)).toBe(2)
})

test('generate slide notes fills a slide at the division; a lone note adds no undo step', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view } = window.editorTest
        const [[a], [b]] = fixtures.interaction.slides as [
            [(typeof fixtures.interaction.slides)[number][number]],
            [(typeof fixtures.interaction.slides)[number][number]],
        ]
        show({ ...fixtures.interaction, slides: [[{ ...a }, { ...b }], [{ ...b, beat: 9 }]] }, 3)
        view.division = 2
    })
    await settle(page)
    await command(page, 'generateSlideNotes')
    await click(page, -3, 3)
    expect(await beats(page)).toEqual([3, 3.5, 4, 4.5, 5, 9])
    expect(await undoCount(page)).toBe(1)

    // A single-note slide has nothing to fill.
    await click(page, 1, 9)
    expect(await beats(page)).toEqual([3, 3.5, 4, 4.5, 5, 9])
    expect(await undoCount(page)).toBe(1)
})

test('dragging notes back to where they started adds no undo step', async ({ page }) => {
    await command(page, 'select')
    const there = async (from: [number, number], via: [number, number]) => {
        const start = await point(page, ...from)
        const away = await point(page, ...via)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(away.x, away.y, { steps: 6 })
        await settle(page)
        expect((await snapshot(page)).creating).not.toEqual([])
        await page.mouse.move(start.x, start.y, { steps: 6 })
        await page.mouse.up()
        await settle(page)
    }
    // The body, then the right edge, of the note at lane 3 (3..5), beat 7.
    await there([4, 7], [6, 8])
    await there([4.9, 7], [7, 7])
    expect((await snapshot(page)).notes).toContainEqual({ type: 'note', beat: 7, left: 3, size: 2 })
    expect((await snapshot(page)).creating).toEqual([])
    expect(await selectedBeats(page)).toEqual([7])
    expect(await undoCount(page)).toBe(0)

    // A real move still commits once.
    await drag(page, [4, 7], [4, 8])
    expect(await beats(page)).toEqual([3, 5, 8, 9])
    expect(await undoCount(page)).toBe(1)
})

test('flip mirrors the selection and supports undo', async ({ page }) => {
    await command(page, 'select')
    await click(page, 4, 7)
    await command(page, 'flip')
    expect((await snapshot(page)).notes.find(({ beat }) => beat === 7)).toEqual({
        type: 'note',
        beat: 7,
        left: -5,
        size: 2,
    })
    await command(page, 'undo')
    expect((await snapshot(page)).notes.find(({ beat }) => beat === 7)?.left).toBe(3)
})

test('copy, cut and paste through shortcuts place the clipboard where clicked', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await command(page, 'select')
    await click(page, -3, 3)
    await click(page, 1, 5, ['Control'])
    await command(page, 'copy')
    await command(page, 'paste')
    // The clipboard is anchored at the last clicked note.
    await click(page, 0, 11)
    expect(await beats(page)).toEqual([3, 5, 7, 9, 9, 11])
    expect(await undoCount(page)).toBe(1)

    await command(page, 'select')
    await click(page, 4, 7)
    await command(page, 'cut')
    expect(await beats(page)).toEqual([3, 5, 9, 9, 11])
    await command(page, 'paste')
    await click(page, 4, 12)
    expect(await beats(page)).toEqual([3, 5, 9, 9, 11, 12])
    expect(await undoCount(page)).toBe(3)
})

test('division, snapping, note size and zoom keys change only the view', async ({ page }) => {
    const view = () =>
        page.evaluate(() => {
            const { view, settings } = window.editorTest
            return {
                division: view.division,
                snapping: view.snapping,
                noteSize: view.noteSize,
                width: settings.width,
                pps: settings.pps,
            }
        })
    const initial = await view()
    await command(page, 'division8')
    expect((await view()).division).toBe(8)
    await command(page, 'division3')
    expect((await view()).division).toBe(3)
    await command(page, 'snapping')
    expect((await view()).snapping).not.toBe(initial.snapping)
    await command(page, 'zoomXOut')
    expect((await view()).width).toBeCloseTo(initial.width * 1.1)
    await command(page, 'zoomXIn')
    expect((await view()).width).toBeCloseTo(initial.width)
    await command(page, 'zoomYIn')
    expect((await view()).pps).toBeCloseTo(initial.pps * 1.1)
    await command(page, 'zoomYOut')
    expect((await view()).pps).toBeCloseTo(initial.pps)
    await run(page, 'increaseNoteSize')
    expect((await view()).noteSize).toBeGreaterThan(initial.noteSize)
    await run(page, 'decreaseNoteSize')
    expect((await view()).noteSize).toBe(initial.noteSize)
    expect(await undoCount(page)).toBe(0)
})

test('scroll keys move the view and keep the chart', async ({ page }) => {
    const position = () =>
        page.evaluate(() => ({
            time: window.editorTest.view.time,
            lane: window.editorTest.view.lane,
        }))
    await page.evaluate(() => {
        window.editorTest.settings.mouseSmoothScrolling = false
        window.editorTest.settings.maxScrollX = 10
    })
    const initial = await position()
    await command(page, 'scrollUp')
    await expect.poll(async () => (await position()).time).toBeGreaterThan(initial.time)
    await command(page, 'scrollDown')
    await command(page, 'scrollDown')
    await expect.poll(async () => (await position()).time).toBeLessThan(initial.time)
    await command(page, 'scrollRight')
    await expect.poll(async () => (await position()).lane).toBeGreaterThan(initial.lane)
    await command(page, 'scrollLeft')
    await command(page, 'scrollLeft')
    await expect.poll(async () => (await position()).lane).toBeLessThan(initial.lane)
    expect(await undoCount(page)).toBe(0)
})

test('the offset tool drags the BGM offset and undoes', async ({ page }) => {
    await run(page, 'offset')
    const offset = () => page.evaluate(() => window.editorTest.history.state.value.bgm.offset)
    const before = await offset()
    await drag(page, [0, 4], [0, 6])
    expect(await offset()).not.toBe(before)
    expect(await undoCount(page)).toBe(1)
    await command(page, 'undo')
    expect(await offset()).toBe(before)
})

test('note, slide, BPM, time scale and event tools place with the mouse', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
    })
    const count = (type: string) =>
        page.evaluate(
            (type) =>
                [...window.editorTest.store.getAllEntities()].filter(
                    (entity) => entity.type === type,
                ).length,
            type,
        )
    const dismiss = async () => {
        const dialog = page.locator('dialog[open], .editor-tool-modal')
        if (await dialog.count()) await dialog.press('Escape')
        await expect(dialog).toHaveCount(0)
    }

    await command(page, 'note')
    await click(page, 6, 11)
    expect(await count('note')).toBe(5)

    // A slide grows by tapping while its last note is selected; a drag sets the width.
    await command(page, 'slide')
    await drag(page, [-6, 12], [-3, 12])
    await click(page, -4, 14)
    expect(await count('note')).toBe(7)
    expect(await count('connector')).toBeGreaterThan(0)

    // Each on its own beat, clear of the others' hitboxes.
    for (const [tool, type, beat] of [
        ['bpm', 'bpm', 10],
        ['timeScale', 'timeScale', 10.5],
        ['cameraEvent', 'cameraEventJoint', 11.5],
        ['stageMaskEvent', 'stageMaskEventJoint', 12],
        ['stagePivotEvent', 'stagePivotEventJoint', 12.5],
        ['stageStyleEvent', 'stageStyleEventJoint', 13],
        ['stageTransformEvent', 'stageTransformEventJoint', 13.5],
    ] as const) {
        await page.evaluate((beat) => (window.editorTest.view.time = beat / 2), beat)
        await settle(page)
        const before = await count(type)
        await run(page, tool)
        await settle(page)
        await click(page, 0, beat)
        await dismiss()
        expect(await count(type), tool).toBe(before + 1)
    }
})

test('play and stop move the cursor and return', async ({ page }) => {
    const cursor = () => page.evaluate(() => window.editorTest.view.cursorTime)
    await page.evaluate(() => (window.editorTest.settings.playStartPosition = 'cursor'))
    const start = await cursor()
    await command(page, 'play')
    await page.waitForTimeout(500)
    await command(page, 'stop')
    await settle(page)
    expect(await cursor()).toBeCloseTo(start, 1)
    expect(await undoCount(page)).toBe(0)
})

for (const [device, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 820, height: 1180 }],
] as const) {
    test.describe(`touch on a ${device}`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true })

        const touch = (page: Page, type: string, at: { x: number; y: number }) =>
            page.evaluate(
                ({ type, at }) => {
                    const target = document.querySelector('.editor')!
                    const changedTouches = [
                        new Touch({ identifier: 1, target, clientX: at.x, clientY: at.y }),
                    ]
                    target.dispatchEvent(
                        new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
                    )
                },
                { type, at },
            )
        const tap = async (page: Page, lane: number, beat: number) => {
            const at = await point(page, lane, beat)
            await touch(page, 'touchstart', at)
            await touch(page, 'touchend', at)
            await settle(page)
        }
        const swipe = async (page: Page, from: [number, number], to: [number, number]) => {
            const start = await point(page, ...from)
            const end = await point(page, ...to)
            await touch(page, 'touchstart', start)
            for (let i = 1; i <= 5; i++) {
                await touch(page, 'touchmove', {
                    x: start.x + ((end.x - start.x) * i) / 5,
                    y: start.y + ((end.y - start.y) * i) / 5,
                })
            }
            await settle(page)
            await touch(page, 'touchend', end)
            await settle(page)
        }

        test.beforeEach(async ({ page }) => {
            // Keep every gesture clear of the quick scroll zone at the right edge.
            await page.evaluate(() => {
                window.editorTest.settings.width = 24
                window.editorTest.settings.touchQuickScrollZone = 0
            })
            await settle(page)
        })

        test('select taps, moves and box-selects', async ({ page }) => {
            await run(page, 'select')
            await tap(page, 1, 5)
            expect(await selectedBeats(page)).toEqual([5])
            await tap(page, 4, 7)
            expect(await selectedBeats(page)).toEqual([7])
            await swipe(page, [4, 7], [4, 8])
            expect(await beats(page)).toEqual([3, 5, 8, 9])
            await swipe(page, [-9, 2.5], [9, 5.5])
            expect(await selectedBeats(page)).toEqual([3, 5])
            expect(await undoCount(page)).toBe(1)
        })

        test('note, slide, eraser, brush, generate and paste tools work by touch', async ({
            page,
            context,
        }) => {
            await context.grantPermissions(['clipboard-read', 'clipboard-write'])
            await run(page, 'note')
            await tap(page, 6, 11)
            expect(await beats(page)).toEqual([3, 5, 7, 9, 11])

            await run(page, 'eraser')
            await tap(page, 7, 11)
            expect(await beats(page)).toEqual([3, 5, 7, 9])
            await swipe(page, [-9, 6.5], [9, 7.5])
            expect(await beats(page)).toEqual([3, 5, 9])

            await run(page, 'slide')
            await tap(page, -6, 10)
            await tap(page, -4, 11)
            expect(await beats(page)).toEqual([3, 5, 9, 10, 11])
            expect((await snapshot(page)).selected).toHaveLength(1)

            await page.evaluate(() => (window.editorTest.view.division = 2))
            await run(page, 'generateSlideNotes')
            await tap(page, -3, 11)
            expect(await beats(page)).toEqual([3, 5, 9, 10, 10.5, 11])

            await page.evaluate(async () => {
                const path = '/src/editor/tools/brush/index.ts'
                const urls = new Map(
                    performance
                        .getEntriesByType('resource')
                        .map((entry) => [new URL(entry.name).pathname, entry.name]),
                )
                const { brushProperties } = (await import(
                    urls.get(path) ?? path
                )) as typeof import('../../src/editor/tools/brush')
                brushProperties.value = { isCritical: true }
            })
            await run(page, 'brush')
            await tap(page, 1, 5)
            expect(
                await page.evaluate(() =>
                    [...window.editorTest.store.getAllEntities()]
                        .filter((entity) => entity.type === 'note' && entity.isCritical)
                        .map(({ beat }) => beat),
                ),
            ).toEqual([5])

            await run(page, 'select')
            await tap(page, -3, 3)
            await run(page, 'copy')
            await run(page, 'paste')
            await page.waitForTimeout(200)
            await tap(page, 6, 4)
            expect(await beats(page)).toEqual([3, 4, 5, 9, 10, 10.5, 11])
        })
    })
}
