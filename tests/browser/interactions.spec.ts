import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const touch = (page: Page, type: string, points: { id: number; x: number; y: number }[]) =>
    page.evaluate(
        ({ type, points }) => {
            const target = document.querySelector('.editor')!
            const changedTouches = points.map(
                ({ id, x, y }) => new Touch({ identifier: id, target, clientX: x, clientY: y }),
            )
            target.dispatchEvent(
                new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
            )
        },
        { type, points },
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
