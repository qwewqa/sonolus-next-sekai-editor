import { expect, test, type Page } from '@playwright/test'
import type { CommandName } from '../../src/editor/commands'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

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

const move = async (page: Page, lane: number, beat: number) => {
    const position = await point(page, lane, beat)
    await page.mouse.move(position.x, position.y)
    await settle(page)
}

const click = async (page: Page, lane: number, beat: number) => {
    const position = await point(page, lane, beat)
    await page.mouse.click(position.x, position.y)
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

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    pageErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
    expect((await snapshot(page)).notes).toHaveLength(4)
})

test.afterEach(({ page }) => {
    expect(pageErrors.get(page), 'uncaught browser errors').toEqual([])
})

test('create, select and move notes with mouse input, then undo and redo', async ({ page }) => {
    await command(page, 'note')
    await move(page, 3, 11)
    expect((await snapshot(page)).creating).toEqual([{ type: 'note', beat: 11, left: 3, size: 2 }])
    await click(page, 3, 11)
    expect((await snapshot(page)).notes).toHaveLength(5)

    await command(page, 'select')
    await click(page, 4, 11)
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 11, left: 3, size: 2 }])
    const start = await point(page, 4, 11)
    const end = await point(page, 5, 12)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await settle(page)
    expect((await snapshot(page)).creating).toEqual([{ type: 'note', beat: 12, left: 4, size: 2 }])
    await page.mouse.up()
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 12, left: 4, size: 2 }])
    expect((await snapshot(page)).creating).toEqual([])

    await command(page, 'undo')
    expect((await snapshot(page)).notes).toContainEqual({
        type: 'note',
        beat: 11,
        left: 3,
        size: 2,
    })
    expect((await snapshot(page)).notes.map((note) => note.beat)).not.toContain(12)
    await command(page, 'redo')
    expect((await snapshot(page)).notes).toContainEqual({
        type: 'note',
        beat: 12,
        left: 4,
        size: 2,
    })
    await command(page, 'undo')
    await command(page, 'undo')
    expect((await snapshot(page)).notes.map((note) => note.beat)).toEqual([3, 5, 7, 9])
})

test('idle canvases stay untouched and pointer movement redraws only the overlay', async ({
    page,
}) => {
    const initial = await page.evaluate(() => window.editorFrames)
    expect(initial.chart).toBeGreaterThan(0)
    expect(initial.overlay).toBeGreaterThan(0)
    await move(page, 7, 8)
    // Activity-dependent labels intentionally redraw once at their 0.5s expiry.
    await page.waitForTimeout(750)
    await page.evaluate(() => {
        window.editorFrames = { chart: 0, overlay: 0 }
    })
    await page.waitForTimeout(1100)
    expect(await page.evaluate(() => window.editorFrames)).toEqual({ chart: 0, overlay: 0 })

    // Warm the active-label state before counting changes from hover alone.
    await move(page, 7, 8.25)
    await page.evaluate(() => {
        window.editorFrames = { chart: 0, overlay: 0 }
    })
    for (const beat of [8.5, 8.75, 9, 9.25]) await move(page, 7, beat)
    const emptyHover = await page.evaluate(() => window.editorFrames)
    expect((await snapshot(page)).hovered).toEqual([])
    expect(emptyHover.chart).toBe(0)
    expect(emptyHover.overlay).toBeGreaterThanOrEqual(4)

    await move(page, -3, 3)
    await page.evaluate(() => {
        window.editorFrames = { chart: 0, overlay: 0 }
    })
    for (const beat of [3.05, 3.1, 3.15]) await move(page, -3, beat)
    const noteHover = await page.evaluate(() => window.editorFrames)
    expect((await snapshot(page)).hovered.map((entity) => entity.beat)).toEqual([3])
    expect(noteHover.chart).toBe(0)
    expect(noteHover.overlay).toBeGreaterThanOrEqual(3)
})

const expectSurfaces = async (page: Page) => {
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const { view } = window.editorTest
                    const canvases = [
                        ...document.querySelectorAll<HTMLCanvasElement>('.editor canvas'),
                    ]
                    return (
                        canvases.length === 2 &&
                        canvases.every((canvas) => {
                            const rect = canvas.getBoundingClientRect()
                            return (
                                canvas.width === Math.round(view.w * devicePixelRatio) &&
                                canvas.height === Math.round(view.h * devicePixelRatio) &&
                                rect.width === view.w &&
                                rect.height === view.h
                            )
                        })
                    )
                }),
            {
                message:
                    'both Canvas backing buffers match their CSS dimensions and device pixel ratio',
            },
        )
        .toBe(true)
}

test('viewport and device pixel ratio changes resize both surfaces and preserve hit testing', async ({
    page,
    context,
}) => {
    await page.setViewportSize({ width: 1300, height: 820 })
    await expectSurfaces(page)
    await click(page, -3, 3)
    expect((await snapshot(page)).selected.map((entity) => entity.beat)).toEqual([3])

    const cdp = await context.newCDPSession(page)
    // Include a real viewport change: CDP on Edge can omit the resize event for
    // a DPR-only override, unlike an actual browser zoom/display change.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1301,
        height: 820,
        deviceScaleFactor: 2,
        mobile: false,
    })
    await page.waitForFunction(() => devicePixelRatio === 2)
    await expectSurfaces(page)
    await click(page, 1, 5)
    expect((await snapshot(page)).selected.map((entity) => entity.beat)).toEqual([5])
    await cdp.detach()
})

test('chart reset clears old selection pixels after ghost, connector and event scenes', async ({
    page,
}) => {
    // The native Chromium regression requires presented frames after sprite
    // drawImage and selection transitions. A simple select/reset test misses it.
    // Do not read Canvas pixels until the final assertion: that flushes the
    // deferred backend and can conceal the bug.
    const present = async () => {
        await settle(page)
        await page.waitForTimeout(650)
        await page.locator('.editor').screenshot()
    }
    await page.evaluate(() => {
        const editor = window.editorTest
        editor.settings.pps = 80
        editor.settings.width = 24
        editor.show(editor.fixtures.notes)
    })
    await present()
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
    })
    await present()
    await page.evaluate(() => {
        const { history, view, fixtures } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        view.groupId = fixtures.notes.groups.keys().next().value
    })
    await present()
    await page.evaluate(() => {
        const { view, store } = window.editorTest
        view.entities = {
            hovered: [],
            creating: [...store.getAllEntities()].filter((entity) => entity.type === 'note'),
        }
    })
    await present()
    await page.evaluate(() => {
        const editor = window.editorTest
        editor.show(editor.fixtures.connectors)
    })
    await present()
    await page.evaluate(() => {
        const { view, store, fixtures } = window.editorTest
        view.groupId = fixtures.connectors.groups.keys().next().value
        view.entities = {
            hovered: [...store.getAllEntities()]
                .filter((entity) => entity.type === 'connector')
                .slice(0, 3),
            creating: [],
        }
    })
    await present()
    await page.evaluate(() => {
        const editor = window.editorTest
        editor.show(editor.fixtures.events)
    })
    await present()
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((entity) =>
                entity.type.endsWith('Joint'),
            ),
        })
    })
    await present()
    expect((await snapshot(page)).selected).toHaveLength(20)
    await page.evaluate(async () => {
        const editor = window.editorTest
        editor.show(editor.fixtures.notes)
        await editor.addWaveform()
    })
    await present()
    expect((await snapshot(page)).selected).toEqual([])
    const opaquePixels = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-overlay')!
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        let count = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++
        return count
    })
    expect(opaquePixels, 'reset overlay must contain no old outlines or ghost pixels').toBe(0)
})
