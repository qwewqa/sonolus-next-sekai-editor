import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const touch = (
    page: Page,
    type: string,
    points: { id: number; x: number; y: number }[],
    modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
) =>
    page.evaluate(
        ({ type, points, modifiers }) => {
            const target = document.querySelector('.editor')!
            const changedTouches = points.map(
                ({ id, x, y }) => new Touch({ identifier: id, target, clientX: x, clientY: y }),
            )
            target.dispatchEvent(
                new TouchEvent(type, {
                    changedTouches,
                    bubbles: true,
                    cancelable: true,
                    ...modifiers,
                }),
            )
        },
        { type, points, modifiers },
    )

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
})

test('leaving the editor restores a temporary secondary mouse tool', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'eraser'
    })
    await page.locator('.editor').click({ position: { x: 100, y: 100 } })
    await page.keyboard.press('a')
    const position = await page.evaluate(() => window.editorTest.point(-7, 8))
    await page.mouse.move(position.x, position.y)
    await page.mouse.down({ button: 'right' })
    const bounds = await page.locator('.editor').boundingBox()
    await page.mouse.move(position.x, bounds!.y + bounds!.height + 2)
    await page.mouse.up({ button: 'right' })
    await page.mouse.move(position.x, position.y)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([
        { type: 'note', beat: 8, left: -7, size: 2 },
    ])
})

test('cancelled touch taps and drags do not create notes or leave previews', async ({ page }) => {
    await page.locator('.editor').click({ position: { x: 100, y: 100 } })
    await page.keyboard.press('a')
    const position = await page.evaluate(() => window.editorTest.point(-5, 8))
    const start = { ...position, id: 1 }
    await touch(page, 'touchstart', [start])
    await touch(page, 'touchcancel', [start])
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().notes.length)).toBe(4)

    await touch(page, 'touchstart', [start])
    const end = { ...start, x: start.x + 100 }
    await touch(page, 'touchmove', [end])
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().creating.length)).toBeGreaterThan(
        0,
    )
    await touch(page, 'touchcancel', [end])
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().notes.length)).toBe(4)
    expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([])
    expect(await page.evaluate(() => window.editorTest.view.selection)).toBeUndefined()

    // A cancelled gesture must not poison subsequent input.
    await touch(page, 'touchstart', [start])
    await touch(page, 'touchend', [start])
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().notes.length)).toBe(5)
})

test('Cmd taps toggle objects in and out of the selection, as Ctrl taps do', async ({ page }) => {
    await page.locator('.editor').click({ position: { x: 100, y: 100 } })
    await page.keyboard.press('f')
    const tap = async (lane: number, beat: number, modifiers = {}) => {
        const at = await page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), {
            lane,
            beat,
        })
        const point = { ...at, id: 1 }
        await touch(page, 'touchstart', [point], modifiers)
        await touch(page, 'touchend', [point], modifiers)
        await settle(page)
    }
    const selected = () =>
        page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)
    await tap(-3, 3)
    expect(await selected()).toBe(1)
    for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) {
        await tap(1, 5, modifiers)
        expect(await selected()).toBe(2)
        await tap(1, 5, modifiers)
        expect(await selected()).toBe(1)
    }
})

test('pinches starting with aligned fingers keep zoom continuous and finite', async ({ page }) => {
    const position = await page.evaluate(() => window.editorTest.point(0, 8))
    await page.evaluate(() => {
        window.editorTest.settings.pps = 1000
        window.editorTest.settings.width = 40
    })
    const left = { id: 1, x: position.x - 100, y: position.y }
    const right = { id: 2, x: position.x + 100, y: position.y }
    await touch(page, 'touchstart', [left, right])
    await touch(page, 'touchmove', [{ ...right, y: right.y + 60 }])
    await touch(page, 'touchmove', [{ ...right, y: right.y + 66 }])
    expect(await page.evaluate(() => window.editorTest.settings.pps)).toBeCloseTo(1100)
    await touch(page, 'touchcancel', [left, right])

    const top = { id: 3, x: position.x, y: position.y - 100 }
    const bottom = { id: 4, x: position.x, y: position.y + 100 }
    await touch(page, 'touchstart', [top, bottom])
    await touch(page, 'touchmove', [{ ...bottom, x: bottom.x + 60 }])
    await touch(page, 'touchmove', [{ ...bottom, x: bottom.x + 66 }])
    expect(await page.evaluate(() => window.editorTest.settings.width)).toBeCloseTo(40 / 1.1)
    await touch(page, 'touchcancel', [top, bottom])
})

test('moving a selection preserves the previous history selection order', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const notes = [...store.getAllEntities()]
            .filter((entity) => entity.type === 'note')
            .sort((a, b) => a.beat - b.beat)
        history.replaceState({ ...history.state.value, selectedEntities: notes })
    })
    const start = await page.evaluate(() => window.editorTest.point(-3, 3))
    const end = await page.evaluate(() => window.editorTest.point(-2, 4))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)
    await page.keyboard.press('z')
    await settle(page)
    expect(
        await page.evaluate(() => window.editorTest.snapshot().selected.map((n) => n.beat)),
    ).toEqual([3, 5, 7, 9])
})

test('selection hit testing includes note and BPM edges across beat buckets', async ({ page }) => {
    const hits = await page.evaluate(() => {
        const editor = window.editorTest
        editor.show({
            ...editor.fixtures.interaction,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 120 },
            ],
        })
        const spu = editor.view.w / editor.settings.width / editor.settings.pps
        return {
            note: editor.store
                .hitAllEntities(-3.5, -2.5, 1.5 - 0.29 * spu, 1.5 - 0.27 * spu)
                .some((entity) => entity.type === 'note' && entity.beat === 3),
            bpm: editor.store
                .hitAllEntities(6.25, 6.75, 2 - 0.39 * spu, 2 - 0.37 * spu)
                .some((entity) => entity.type === 'bpm' && entity.beat === 4),
        }
    })
    expect(hits).toEqual({ note: true, bpm: true })
})

test('Shift+wheel scrolls lanes the same way in pixel, line and page modes', async ({ page }) => {
    const scroll = (deltaMode: number, deltaY: number) =>
        page.evaluate(
            ({ deltaMode, deltaY }) => {
                const { settings, view } = window.editorTest
                settings.mouseSmoothScrolling = false
                settings.maxScrollX = 1000
                view.lane = 0
                document.querySelector('.editor')!.dispatchEvent(
                    new WheelEvent('wheel', {
                        deltaMode,
                        deltaY,
                        shiftKey: true,
                        bubbles: true,
                        cancelable: true,
                    }),
                )
                return Math.sign(view.lane)
            },
            { deltaMode, deltaY },
        )
    // Pixel, line and page delta modes.
    const pixel = await scroll(0, 100)
    expect(pixel).not.toBe(0)
    expect(await scroll(1, 3)).toBe(pixel)
    expect(await scroll(2, 1)).toBe(pixel)
})

test('a slow mouse click still acts as a click', async ({ page }) => {
    await page.keyboard.press('a')
    const before = await page.evaluate(() => window.editorTest.snapshot().notes.length)
    const { x, y } = await page.evaluate(() => window.editorTest.point(2, 6))
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    await expect
        .poll(() => page.evaluate(() => window.editorTest.snapshot().notes.length))
        .toBe(before + 1)
})

test('the hover line and preview follow a still mouse as the chart scrolls under it', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, settings } = window.editorTest
        show(fixtures.interaction, 3)
        settings.mouseSmoothScrolling = false
    })
    await page.keyboard.press('a')
    const position = await page.evaluate(() => window.editorTest.point(-7, 6))
    await page.mouse.move(position.x, position.y)
    await settle(page)
    const hover = () =>
        page.evaluate(async () => {
            const { view, appImport } = window.editorTest
            const { yToTime } =
                await appImport<typeof import('../../src/editor/view')>('/src/editor/view.ts')
            return {
                time: view.hoverTime,
                pointer: yToTime(view.pointer.y),
                hidden: view.isHoverHidden,
                creating: window.editorTest.snapshot().creating.map(({ beat }) => beat),
            }
        })
    const before = await hover()
    expect(before.creating).toEqual([6])

    // The wheel, then a jump as playback follow makes.
    await page.mouse.wheel(0, -240)
    await settle(page)
    const wheeled = await hover()
    expect(wheeled.time).not.toBeCloseTo(before.time)
    expect(wheeled.time).toBeCloseTo(wheeled.pointer)
    expect(wheeled.creating).not.toEqual([6])
    await page.evaluate(() => {
        window.editorTest.view.time += 1
    })
    await settle(page)
    const followed = await hover()
    expect(followed.time).toBeCloseTo(wheeled.time + 1)
    expect(followed.time).toBeCloseTo(followed.pointer)
    expect(followed.hidden).toBe(false)

    // Away from the chart, nothing follows.
    const bounds = await page.locator('.editor').boundingBox()
    await page.mouse.move(position.x, bounds!.y + bounds!.height + 20)
    await page.evaluate(() => {
        window.editorTest.view.time += 1
    })
    await settle(page)
    expect((await hover()).time).toBeCloseTo(followed.time)
})
