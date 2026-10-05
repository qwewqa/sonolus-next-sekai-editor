import { expect, test, type Page } from '@playwright/test'
import type { CameraEventObject } from '../../src/chart/events/camera'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        cursorTest: {
            tools: typeof import('../../src/editor/tools')
            scene: typeof import('../../src/editor/elevation/scene')
        }
    }
}

const errors = new WeakMap<Page, string[]>()
const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const cursor = (page: Page, selector = '.editor') =>
    page.evaluate((selector) => {
        const element = document.querySelector(selector)
        if (!element) throw new Error(`Missing ${selector}`)
        return getComputedStyle(element).cursor
    }, selector)
const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })
const hover = async (page: Page, lane: number, beat: number) => {
    const target = await point(page, lane, beat)
    await page.mouse.move(target.x, target.y)
    await settle(page)
}
const expectCursor = async (page: Page, lane: number, beat: number, expected: string) => {
    await hover(page, lane, beat)
    expect(await cursor(page), `lane ${lane}, beat ${beat}`).toBe(expected)
}
const useTool = async (page: Page, name: string) => {
    await page.evaluate((name) => {
        window.cursorTest.tools.switchToolTo(name as never)
    }, name)
    await settle(page)
}
const notes = (page: Page) => page.evaluate(() => window.editorTest.snapshot().notes)

const camera = (beat: number): CameraEventObject => ({
    beat,
    cameraLeft: -8,
    cameraSize: 6,
    cameraZoom: 1,
    cameraZoomTargetLane: 0,
    cameraZoomTargetY: 0,
    cameraZoomVerticalAlign: 'default',
    cameraRotation: 0,
    cameraStageTilt: 0,
    eventEase: 'linear',
})

// A size-3 note at lanes 0-3, beat 5, and a BPM at beat 4.
const seed = (page: Page, extra?: { left: number; size: number; beat: number }) =>
    page.evaluate(async (extra) => {
        const { fixtures, show, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[1]![0]!
        show(
            {
                ...fixtures.interaction,
                bpms: [...fixtures.interaction.bpms, { beat: 4, bpm: 120 }],
                slides: [
                    [{ ...base, beat: 5, left: 0, size: 3 }],
                    ...(extra ? [[{ ...base, ...extra }]] : []),
                ],
            },
            3,
        )
        view.snapping = 'absolute'
        view.division = 4
        settings.width = 20
        settings.mouseSecondaryTool = 'selectContextMenu'
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        window.cursorTest = {
            tools: await import(
                urls.get('/src/editor/tools/index.ts') ?? '/src/editor/tools/index.ts'
            ),
            scene: await import(
                urls.get('/src/editor/elevation/scene.ts') ?? '/src/editor/elevation/scene.ts'
            ),
        }
        window.cursorTest.tools.switchToolTo('select')
    }, extra)

test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = []
    errors.set(page, pageErrors)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        // Keep the system clipboard out of paste tests.
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: () => Promise.resolve(''),
        })
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await seed(page)
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

test('select shows grab over a note body, ew-resize at its edges and default elsewhere', async ({
    page,
}) => {
    await expectCursor(page, 1.5, 5, 'move')
    await expectCursor(page, 0.2, 5, 'ew-resize')
    await expectCursor(page, 2.8, 5, 'ew-resize')
    await expectCursor(page, -6, 5, 'default')
})

test('an edge press keeps ew-resize through the drag and resizes the note', async ({ page }) => {
    await hover(page, 2.8, 5)
    await page.mouse.down()
    await settle(page)
    expect(await cursor(page)).toBe('ew-resize')
    const end = await point(page, 5.8, 5)
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    expect(await cursor(page)).toBe('ew-resize')
    await page.mouse.up()
    await settle(page)
    expect(await notes(page)).toEqual([{ type: 'note', beat: 5, left: 0, size: 6 }])
    // Recomputed for the new geometry: the release point is the new right edge.
    expect(await cursor(page)).toBe('ew-resize')
    await expectCursor(page, 3, 5, 'move')
})

test('a body drag shows grabbing, a plain press never does', async ({ page }) => {
    await hover(page, 1.5, 5)
    await page.mouse.down()
    await settle(page)
    expect(await cursor(page)).toBe('move')
    await page.mouse.up()
    await settle(page)
    expect(await cursor(page)).toBe('move')

    await page.mouse.down()
    const end = await point(page, 1.5, 6)
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    expect(await cursor(page)).toBe('move')
    await page.mouse.up()
    await settle(page)
    expect(await notes(page)).toEqual([{ type: 'note', beat: 6, left: 0, size: 3 }])
})

test('a box selection from empty space switches to crosshair', async ({ page }) => {
    await hover(page, -6, 6)
    await page.mouse.down()
    await settle(page)
    expect(await cursor(page)).toBe('default')
    const end = await point(page, 4, 4.5)
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    expect(await cursor(page)).toBe('crosshair')
    await page.mouse.up()
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual([
        { type: 'note', beat: 5, left: 0, size: 3 },
    ])
})

test('a mixed selection moves instead of resizing at a note edge', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' || (entity.type === 'bpm' && entity.beat === 4),
            ),
        })
    })
    expect(
        await page.evaluate(() =>
            window.editorTest.snapshot().selected.map((entity) => entity.type),
        ),
    ).toEqual(expect.arrayContaining(['note', 'bpm']))
    await expectCursor(page, 0.2, 5, 'move')
})

test('a tool shortcut updates the cursor without moving the mouse', async ({ page }) => {
    await expectCursor(page, -6, 5, 'default')
    await page.keyboard.press('a')
    await settle(page)
    expect(await cursor(page)).toBe('crosshair')
    await expectCursor(page, 0.2, 5, 'ew-resize')
    await expectCursor(page, 1.5, 5, 'move')
})

test('bpm edits show ns-resize on an existing BPM beat and crosshair elsewhere', async ({
    page,
}) => {
    await useTool(page, 'bpm')
    await expectCursor(page, -6, 4, 'ns-resize')
    await expectCursor(page, -6, 4.5, 'crosshair')
})

test('timescale and point events grab existing objects and place elsewhere', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        const base = fixtures.interaction.slides[1]![0]!
        show(
            {
                ...fixtures.interaction,
                timeScales: [{ ...fixtures.events.timeScales[0]!, beat: 6, editorLane: 4 }],
                slides: [[{ ...base, beat: 5, left: 0, size: 3 }]],
            },
            3,
        )
    })
    await useTool(page, 'timeScale')
    // Any lane at an existing timescale's beat edits it.
    await expectCursor(page, -6, 6, 'move')
    await expectCursor(page, -6, 6.5, 'crosshair')
    await useTool(page, 'stagePivotEvent')
    await expectCursor(page, -6, 6, 'crosshair')
})

test('camera joints resize at their edges and move from their body', async ({ page }) => {
    await page.evaluate((event) => {
        const { fixtures, show } = window.editorTest
        const base = fixtures.interaction.slides[1]![0]!
        show(
            {
                ...fixtures.interaction,
                cameraEvents: [event],
                slides: [[{ ...base, beat: 5, left: 0, size: 3 }]],
            },
            3,
        )
    }, camera(7))
    await useTool(page, 'cameraEvent')
    await expectCursor(page, -5, 7, 'move')
    await expectCursor(page, -7.8, 7, 'ew-resize')
    await expectCursor(page, -2.2, 7, 'ew-resize')
    await expectCursor(page, -5, 8, 'crosshair')
})

test('eraser, brush and generate point at a tap target and draw a box elsewhere', async ({
    page,
}) => {
    for (const tool of ['eraser', 'brush', 'generateSlideNotes']) {
        await useTool(page, tool)
        await expectCursor(page, 1.5, 5, 'pointer')
        await expectCursor(page, -6, 5, 'crosshair')
    }
    await useTool(page, 'eraser')
    await hover(page, 1.5, 5)
    await page.mouse.down()
    const end = await point(page, -6, 6)
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    expect(await cursor(page)).toBe('crosshair')
    await page.mouse.up()
})

test('paste shows copy only with clipboard data; offset shows ns-resize', async ({ page }) => {
    await useTool(page, 'paste')
    await expectCursor(page, -6, 5, 'default')
    await useTool(page, 'select')
    const selected = await point(page, 1.5, 5)
    await page.mouse.click(selected.x, selected.y)
    await page.keyboard.press('c')
    await useTool(page, 'paste')
    await expectCursor(page, -6, 6, 'copy')
    await useTool(page, 'offset')
    await expectCursor(page, -6, 6, 'ns-resize')
})

test('the cursor resets outside the canvas and for pen input', async ({ page }) => {
    await expectCursor(page, 1.5, 5, 'move')
    const box = await page.locator('canvas.editor-chart').boundingBox()
    if (!box) throw new Error('Missing chart canvas')
    await page.mouse.move(box.x + box.width / 2, box.y - 5)
    await settle(page)
    expect(await cursor(page)).toBe('auto')

    await expectCursor(page, 1.5, 5, 'move')
    const target = await point(page, 1.5, 5)
    await page.evaluate((target) => {
        const element = document.querySelector('.editor')!
        const init = { bubbles: true, clientX: target.x, clientY: target.y }
        element.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerType: 'pen' }))
        element.dispatchEvent(new MouseEvent('mousemove', init))
    }, target)
    await settle(page)
    expect(await cursor(page)).toBe('auto')
})

test('wheel scrolling under a still mouse updates the cursor', async ({ page }) => {
    await expectCursor(page, 1.5, 7, 'default')
    // Two beats at 120 BPM and 120 px per second.
    await page.mouse.wheel(0, 120)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.view.time)).toBe(2)
    expect(await cursor(page)).toBe('move')
})

test('scaling width shows ew-resize over selected objects only', async ({ page }) => {
    await seed(page, { left: -8, size: 2, beat: 7 })
    await page.evaluate(() => {
        const { history } = window.editorTest
        const current = history.state.value
        history.replaceState({
            ...current,
            selectedEntities: [...current.store.slides.note.values()].flat(),
        })
    })
    await settle(page)
    const target = await point(page, 1.5, 5)
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Scale Width', exact: true }).click()
    await expect(page.locator('.scaling-panel')).toBeVisible()
    await settle(page)
    await expectCursor(page, 1.5, 5, 'ew-resize')
    await expectCursor(page, -7, 7, 'ew-resize')
    await expectCursor(page, -6, 5, 'default')
})

test.describe('elevation editor', () => {
    const rowPoint = async (page: Page, offset: number) => {
        const row = await page.evaluate(() => {
            const [row] = window.cursorTest.scene.elevationLayout.value.rows
            return row && { x: row.x, y: row.y, w: row.w }
        })
        const box = await page.locator('.elevation-canvas').boundingBox()
        if (!row || !box) throw new Error('Missing elevation row')
        return { x: box.x + row.x + offset * (row.w / 2 - 5), y: box.y + row.y }
    }
    const expectRowCursor = async (page: Page, offset: number, expected: string) => {
        const target = await rowPoint(page, offset)
        await page.mouse.move(target.x, target.y)
        await settle(page)
        expect(await cursor(page, '.elevation-editor .editor'), `offset ${offset}`).toBe(expected)
    }

    test('rows use the panel hit test and its own drag rules', async ({ page }) => {
        await page.evaluate(() => {
            window.editorTest.settings.elevationEditorSideBySide = 'disallow'
            window.editorTest.view.cursorTime = 2.5
        })
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await settle(page)
        await expectRowCursor(page, 0, 'move')
        await expectRowCursor(page, -1, 'ew-resize')
        await expectRowCursor(page, 1, 'ew-resize')

        const empty = await rowPoint(page, 0)
        await page.mouse.move(empty.x, empty.y + 120)
        await settle(page)
        expect(await cursor(page, '.elevation-editor .editor')).toBe('default')
        await page.keyboard.press('a')
        await settle(page)
        expect(await cursor(page, '.elevation-editor .editor')).toBe('crosshair')
        await page.keyboard.press('g')
        await expectRowCursor(page, 0, 'pointer')
    })

    test('attached rows only select, so they keep the pointer cursor', async ({ page }) => {
        await page.evaluate(() => {
            const { fixtures, show, view, settings } = window.editorTest
            const base = fixtures.interaction.slides[1]![0]!
            show(
                {
                    ...fixtures.interaction,
                    slides: [
                        [
                            { ...base, beat: 4, left: 0, size: 3, elevation: 0 },
                            { ...base, beat: 6, left: 0, size: 3, elevation: 4, isAttached: true },
                            { ...base, beat: 8, left: 0, size: 3, elevation: 1 },
                        ],
                    ],
                },
                3,
            )
            view.cursorTime = 3
            settings.elevationEditorSideBySide = 'disallow'
        })
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await settle(page)
        expect(
            await page.evaluate(() =>
                window.cursorTest.scene.elevationLayout.value.rows.map((row) => row.attached),
            ),
        ).toEqual([true])
        await expectRowCursor(page, 0, 'pointer')
        await page.mouse.down()
        const target = await rowPoint(page, 0)
        await page.mouse.move(target.x + 60, target.y - 60, { steps: 5 })
        await settle(page)
        expect(await cursor(page, '.elevation-editor .editor')).toBe('pointer')
        await page.mouse.up()
    })
})

test.describe('touch', () => {
    test.use({ hasTouch: true })

    test('touch input leaves the cursor untouched', async ({ page }) => {
        await expectCursor(page, 1.5, 5, 'move')
        const target = await point(page, 1.5, 5)
        await page.evaluate((target) => {
            const element = document.querySelector('.editor')!
            element.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    pointerType: 'touch',
                    clientX: target.x,
                    clientY: target.y,
                }),
            )
            const touches = [
                new Touch({
                    identifier: 1,
                    target: element,
                    clientX: target.x,
                    clientY: target.y,
                }),
            ]
            element.dispatchEvent(
                new TouchEvent('touchstart', {
                    changedTouches: touches,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        }, target)
        await settle(page)
        expect(await cursor(page)).toBe('auto')
        await page.evaluate((target) => {
            const element = document.querySelector('.editor')!
            const touches = [
                new Touch({
                    identifier: 1,
                    target: element,
                    clientX: target.x,
                    clientY: target.y,
                }),
            ]
            element.dispatchEvent(
                new TouchEvent('touchend', {
                    changedTouches: touches,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        }, target)
    })
})
