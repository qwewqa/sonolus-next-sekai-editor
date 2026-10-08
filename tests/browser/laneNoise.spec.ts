import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Lanes and sizes computed from others drop float noise near the grid; finer values keep theirs.

const runtimeErrors = new WeakMap<Page, string[]>()

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const seed = async (page: Page, left: number, size: number) => {
    await page.evaluate(
        ({ left, size }) => {
            const { fixtures, show, view } = window.editorTest
            const original = fixtures.interaction.slides[1]![0]!
            show({ ...fixtures.interaction, slides: [[{ ...original, left, size }]] }, 3)
            view.laneDivision = 10
            view.laneSnapping = 'relative'
        },
        { left, size },
    )
    await settle(page)
}

const selectAll = (page: Page) =>
    page.evaluate(async () => {
        const { history, store, nextTick } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
        })
        await nextTick()
    })

const note = (page: Page) =>
    page.evaluate(() => {
        const { left, size } = window.editorTest.snapshot().notes[0]!
        return { left, size }
    })

const drag = async (page: Page, from: number, to: number) => {
    const [start, past, end] = await page.evaluate(
        ({ from, to }) => [
            window.editorTest.point(from, 5),
            window.editorTest.point(to + 2, 5),
            window.editorTest.point(to, 5),
        ],
        { from, to },
    )
    await page.mouse.move(start!.x, start!.y)
    await page.mouse.down()
    // Past the drag threshold first, as a tenth of a lane is only a few pixels.
    await page.mouse.move(past!.x, past!.y, { steps: 4 })
    await page.mouse.move(end!.x, end!.y, { steps: 4 })
    await page.mouse.up()
    await settle(page)
}

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

test('Flip gives clean lanes on the grid', async ({ page }) => {
    // -(0.1 + 0.2) is -0.30000000000000004.
    await seed(page, 0.1, 0.2)
    await selectAll(page)
    await page.keyboard.press('u')
    expect(await note(page)).toEqual({ left: -0.3, size: 0.2 })
    await page.keyboard.press('u')
    expect(await note(page)).toEqual({ left: 0.1, size: 0.2 })
})

test('a typed lane off the grid is not pulled to it by flips', async ({ page }) => {
    await seed(page, 0.1, 0.2)
    await page.evaluate(() => (window.editorTest.settings.showSidebar = true))
    await selectAll(page)
    const left = page
        .locator('#workspace-panel-properties')
        .getByRole('spinbutton', { name: 'Lane', exact: true })
    await left.fill('0.123456789')
    await left.press('Enter')
    await left.blur()
    expect(await note(page)).toEqual({ left: 0.123456789, size: 0.2 })
    await page.keyboard.press('u')
    const flipped = -(0.123456789 + 0.2)
    expect(await note(page)).toEqual({ left: flipped, size: 0.2 })
    await page.keyboard.press('u')
    // The plain arithmetic, a rounding step from the typed value, not a grid value.
    const back = -(flipped + 0.2)
    expect(await note(page)).toEqual({ left: back, size: 0.2 })
    expect(Math.abs(back - 0.123456789)).toBeLessThan(1e-15)
})

test('select drags by a tenth of a lane leave clean lanes and sizes', async ({ page }) => {
    await page.keyboard.press('f')
    // 0.2 + 0.1 is 0.30000000000000004.
    await seed(page, 0.2, 2)
    await drag(page, 1.2, 1.3)
    expect(await note(page)).toEqual({ left: 0.3, size: 2 })
    // The right edge: (0.7 + 1.1 + 0.1) - 0.7 is 1.2000000000000002.
    await seed(page, 0.7, 1.1)
    await drag(page, 1.75, 1.85)
    expect(await note(page)).toEqual({ left: 0.7, size: 1.2 })
})

test('paste offsets leave clean lanes', async ({ page }) => {
    await seed(page, 0.2, 0.1)
    const moved = await page.evaluate(async () => {
        const { appImport, store } = window.editorTest
        const { toMovedNoteObject } = await appImport<
            typeof import('../../src/editor/tools/paste/index')
        >('/src/editor/tools/paste/index.ts')
        const entity = [...store.getAllEntities()].find((e) => e.type === 'note')!
        return [false, true].map((flip) => {
            const { left, size } = toMovedNoteObject(entity as never, 0, 0.1, 5, flip)
            return { left, size }
        })
    })
    // 0.2 + 0.1, and -(0.2 + 0.1) + 0.1.
    expect(moved).toEqual([
        { left: 0.3, size: 0.1 },
        { left: -0.2, size: 0.1 },
    ])
})
