import { expect, test, type Page } from '@playwright/test'
import type { State } from '../../src/state'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

declare global {
    interface Window {
        scalingTest: {
            source: State
            preview: typeof import('../../src/preview/edit')
            scene: typeof import('../../src/editor/elevation/scene')
        }
        scalingVertices: number[]
    }
}

const errors = new WeakMap<Page, string[]>()
const panel = (page: Page) => page.locator('.scaling-panel')
const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const summary = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        const current = history.state.value
        const draft = window.scalingTest.preview.getPreviewState(current)
        const notes = (state: State) =>
            [...state.store.slides.note.values()].flat().map((note) => ({
                beat: note.beat,
                elevation: note.elevation,
                left: note.left,
                size: note.size,
            }))
        return {
            sourceUnchanged: current === window.scalingTest.source,
            draftDifferent: draft !== current,
            stored: notes(current),
            draft: notes(draft),
            canUndo: history.canUndo.value,
            dirty: history.isDirty.value,
        }
    })
const seed = async (page: Page, elevation = false, three = false) => {
    await page.evaluate(
        async ({ elevation, three }) => {
            const { fixtures, show, history, settings } = window.editorTest
            settings.mouseSecondaryTool = 'selectContextMenu'
            const base = fixtures.interaction.slides[0]![0]!
            show(
                {
                    ...fixtures.interaction,
                    slides: [
                        [{ ...base, beat: 3, left: -4, size: 2, elevation: 1 }],
                        [
                            {
                                ...base,
                                beat: elevation ? 3 : 5,
                                left: 0,
                                size: 2,
                                elevation: three ? 2 : 3,
                            },
                        ],
                        [
                            {
                                ...base,
                                beat: three ? (elevation ? 3 : 7) : 8,
                                left: 4,
                                size: 2,
                                elevation: three ? 3 : 4,
                            },
                        ],
                        ...(three ? [[{ ...base, beat: 9, left: -8, size: 2, elevation: 4 }]] : []),
                    ],
                },
                3,
            )
            const source = history.state.value
            const selectedEntities = [...source.store.slides.note.values()]
                .flat()
                .slice(0, three ? 3 : 2)
            history.replaceState({ ...source, selectedEntities })
            const urls = new Map(
                performance
                    .getEntriesByType('resource')
                    .map((entry) => [new URL(entry.name).pathname, entry.name]),
            )
            window.scalingTest = {
                source: history.state.value,
                preview: await import(urls.get('/src/preview/edit.ts') ?? '/src/preview/edit.ts'),
                scene: await import(
                    urls.get('/src/editor/elevation/scene.ts') ?? '/src/editor/elevation/scene.ts'
                ),
            }
        },
        { elevation, three },
    )
    await settle(page)
}
const chartPoint = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })
const open = async (page: Page, axis: 'beat' | 'elevation' = 'beat') => {
    let point = await chartPoint(page, -3, 3)
    if (axis === 'elevation' && (await page.locator('.elevation-canvas').isVisible())) {
        const row = await page.evaluate(() => {
            const row = window.scalingTest.scene.elevationLayout.value.rows.find(
                (row) => row.note.left === -4,
            )!
            return { x: row.x, y: row.y }
        })
        const bounds = await page.locator('.elevation-canvas').boundingBox()
        if (!bounds) throw new Error('Missing elevation canvas')
        point = { x: bounds.x + row.x, y: bounds.y + row.y }
    }
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page
        .getByRole('menuitem', {
            name: axis === 'beat' ? 'Scale Beats' : 'Scale Elevations',
            exact: true,
        })
        .click()
    await expect(panel(page)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await settle(page)
}
const factor = (page: Page) =>
    panel(page).getByRole('spinbutton', { name: 'Scale Factor', exact: true })
const touch = (page: Page, type: string, point: { x: number; y: number }, elevation = false) =>
    page.evaluate(
        ({ type, point, elevation }) => {
            const target = document.querySelector(
                elevation ? '.elevation-canvas' : 'canvas.editor-chart',
            )!
            const changedTouches = [
                new Touch({ identifier: 17, target, clientX: point.x, clientY: point.y }),
            ]
            target.dispatchEvent(
                new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
            )
        },
        { type, point, elevation },
    )

const axisPosition = async (
    page: Page,
    axis: 'beat' | 'elevation',
    left: number,
    value: number,
) => {
    if (axis === 'beat') return chartPoint(page, left + 1, value)
    const local = await page.evaluate(
        ({ left, value }) => {
            const layout = window.scalingTest.scene.elevationLayout.value
            const row = layout.rows.find((row) => row.note.left === left)!
            return { x: row.x, y: row.y + layout.yAt(value) - layout.yAt(row.elevation) }
        },
        { left, value },
    )
    const bounds = await page.locator('.elevation-canvas').boundingBox()
    if (!bounds) throw new Error('Missing elevation canvas')
    return { x: bounds.x + local.x, y: bounds.y + local.y }
}
const dragAxis = async (
    page: Page,
    axis: 'beat' | 'elevation',
    left: number,
    from: number,
    to: number,
) => {
    const start = await axisPosition(page, axis, left, from)
    const end = await axisPosition(page, axis, left, to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await page.mouse.up()
    await settle(page)
}
const prepareThree = async (page: Page, axis: 'beat' | 'elevation') => {
    await seed(page, axis === 'elevation', true)
    if (axis === 'elevation') {
        await page.evaluate(() => {
            window.editorTest.settings.elevationEditorSideBySide = 'allow'
        })
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-canvas')).toBeVisible()
    }
    await open(page, axis)
}
const expectDraftAxis = async (page: Page, axis: 'beat' | 'elevation', values: number[]) => {
    const state = await summary(page)
    expect(state.draft).toHaveLength(values.length)
    for (const [index, value] of values.entries())
        expect(state.draft[index]![axis]).toBeCloseTo(value, 8)
    expect(state.sourceUnchanged).toBe(true)
    expect(state.canUndo).toBe(false)
}

test.beforeEach(async ({ page }) => {
    const messages: string[] = []
    errors.set(page, messages)
    page.on('pageerror', (error) => messages.push(error.message))
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.scalingVertices = []
        const clear = WebGLRenderingContext.prototype.clear
        WebGLRenderingContext.prototype.clear = function (...args) {
            window.scalingVertices = []
            return clear.apply(this, args)
        }
        const upload = WebGLRenderingContext.prototype.bufferSubData
        WebGLRenderingContext.prototype.bufferSubData = function (...args) {
            if (args[2] instanceof Float32Array) window.scalingVertices.push(...args[2])
            return upload.apply(this, args)
        }
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await seed(page)
})
test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

for (const axis of ['beat', 'elevation'] as const) {
    test(`Enter applies ${axis} scaling after editing and dragging`, async ({ page }) => {
        await prepareThree(page, axis)
        await factor(page).fill('0')
        await factor(page).press('Enter')
        await expect(panel(page)).toBeVisible()
        expect((await summary(page)).canUndo).toBe(false)
        await factor(page).fill('2')
        await factor(page).press('Enter')
        await expect(panel(page)).toHaveCount(0)
        expect((await summary(page)).canUndo).toBe(true)
        await page.keyboard.press('z')
        await open(page, axis)
        await dragAxis(page, axis, -4, axis === 'beat' ? 3 : 1, axis === 'beat' ? 2 : 0)
        await page.locator('body').evaluate((body) => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            body.focus()
        })
        await page.keyboard.press('Enter')
        await expect(panel(page)).toHaveCount(0)
        expect((await summary(page)).canUndo).toBe(true)
    })
}

test('Enter during an IME conversion leaves the scaling open', async ({ page }) => {
    await prepareThree(page, 'beat')
    await factor(page).fill('2')
    await factor(page).evaluate((element) => {
        const press = (init: KeyboardEventInit, keyCode?: number) => {
            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init })
            if (keyCode !== undefined)
                Object.defineProperty(event, 'keyCode', { get: () => keyCode })
            element.dispatchEvent(event)
        }
        press({ isComposing: true })
        // Chrome's first IME keydown has keyCode 229 without isComposing.
        press({}, 229)
    })
    await expect(panel(page)).toBeVisible()
    expect((await summary(page)).canUndo).toBe(false)
    await factor(page).press('Enter')
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).canUndo).toBe(true)
})

test('live factor leaves chart history untouched until Apply, with one undo', async ({
    page,
}, testInfo) => {
    await page.evaluate(() => {
        window.editorTest.settings.showPreview = true
        window.editorTest.settings.previewPosition = 'left'
        window.editorTest.settings.leftDockWidth = 300
    })
    await expect(page.locator('.preview canvas').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scalingVertices.length)).toBeGreaterThan(0)
    await open(page)
    await page.evaluate(() => {
        window.editorTest.view.cursorTime = 2.4
    })
    await settle(page)
    await expect(factor(page)).toHaveValue('1')
    await expect(factor(page)).toHaveAttribute('step', '0.1')
    await expect(panel(page).getByText('Earliest Beat', { exact: true })).toHaveCount(0)
    await expect(page.getByTitle('Select', { exact: true })).toHaveCount(0)
    const original = await page.evaluate(() => ({
        chart: document.querySelector<HTMLCanvasElement>('canvas.editor-chart')!.toDataURL(),
        preview: [...window.scalingVertices],
    }))
    await factor(page).fill('2')
    await settle(page)
    const live = await summary(page)
    expect(live.sourceUnchanged).toBe(true)
    expect(live.canUndo).toBe(false)
    expect(live.dirty).toBe(false)
    expect(live.draftDifferent).toBe(true)
    expect(live.stored.map((note) => note.beat)).toEqual([3, 5, 8])
    expect(live.draft.map((note) => note.beat)).toEqual([3, 7, 8])
    await expect
        .poll(() =>
            page.evaluate(() =>
                document.querySelector<HTMLCanvasElement>('canvas.editor-chart')!.toDataURL(),
            ),
        )
        .not.toBe(original.chart)
    await expect
        .poll(() => page.evaluate(() => window.scalingVertices))
        .not.toEqual(original.preview)
    await page.screenshot({
        path: testInfo.outputPath('main-live-scaling.png'),
        style: '.notification { visibility: hidden }',
    })
    await panel(page).getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).stored.map((note) => note.beat)).toEqual([3, 7, 8])
    await page.keyboard.press('z')
    expect((await summary(page)).stored.map((note) => note.beat)).toEqual([3, 5, 8])
    expect((await summary(page)).canUndo).toBe(false)
    await page.keyboard.press('y')
    expect((await summary(page)).stored.map((note) => note.beat)).toEqual([3, 7, 8])
})

test('invalid factor preserves a finite draft and Cancel or Escape discards it', async ({
    page,
}) => {
    await open(page)
    await factor(page).fill('1.5')
    await factor(page).fill('0')
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    expect((await summary(page)).draft.map((note) => note.beat)).toEqual([3, 6, 8])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).draftDifferent).toBe(false)
    expect((await summary(page)).canUndo).toBe(false)
    await open(page)
    await factor(page).fill('2')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).sourceUnchanged).toBe(true)
    expect((await summary(page)).dirty).toBe(false)
})

test('dragging a selected note scales from the fixed earliest beat and rejects crossing it', async ({
    page,
}) => {
    await open(page)
    const start = await chartPoint(page, 1, 5)
    const end = await chartPoint(page, 1, 7)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    expect((await summary(page)).draft.map((note) => note.beat)).toEqual([3, 7, 8])
    const invalid = await chartPoint(page, 1, 2)
    await page.mouse.move(invalid.x, invalid.y, { steps: 5 })
    await settle(page)
    const draft = await summary(page)
    expect(draft.draft.every((note) => Number.isFinite(note.beat))).toBe(true)
    expect(draft.draft[0]!.beat).toBe(3)
    expect(draft.canUndo).toBe(false)
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
    expect(Number(await factor(page).inputValue())).toBeGreaterThan(0)
    await page.mouse.up()
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await summary(page)).sourceUnchanged).toBe(true)
})

test('cancelled touch scaling restores its starting draft without adding history', async ({
    page,
}) => {
    await open(page)
    await factor(page).fill('1.5')
    const start = await chartPoint(page, 1, 6)
    const end = await chartPoint(page, 1, 7)
    await touch(page, 'touchstart', start)
    await touch(page, 'touchmove', end)
    await settle(page)
    expect((await summary(page)).draft.map((note) => note.beat)).toEqual([3, 7, 8])
    await touch(page, 'touchcancel', end)
    await settle(page)
    expect((await summary(page)).draft.map((note) => note.beat)).toEqual([3, 6, 8])
    expect((await summary(page)).canUndo).toBe(false)
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('a replacement chart cancels scaling and cannot receive the old selection draft', async ({
    page,
}) => {
    await open(page)
    await factor(page).fill('2')
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show(fixtures.notes)
    })
    await expect(panel(page)).toHaveCount(0)
    const current = await summary(page)
    expect(current.draftDifferent).toBe(false)
    expect(current.canUndo).toBe(false)
    expect(current.dirty).toBe(false)
})

test('elevation scaling stays live in its pane and drags from the lowest selected elevation', async ({
    page,
}, testInfo) => {
    await seed(page, true)
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await open(page, 'elevation')
    await expect(panel(page).getByText('Lowest Elevation', { exact: true })).toHaveCount(0)
    await expect(page.locator('.elevation-editor .scaling-panel')).toHaveCount(1)
    await expect(
        page.locator('.elevation-editor').getByTitle('Select', { exact: true }),
    ).toHaveCount(0)
    await expect(
        page.locator('canvas.editor-chart').locator('../..').getByTitle('Select', { exact: true }),
    ).toBeVisible()
    const paneBounds = await page.locator('.elevation-editor').boundingBox()
    const panelBounds = await panel(page).boundingBox()
    if (!paneBounds || !panelBounds) throw new Error('Missing elevation scaling pane')
    expect(panelBounds.x).toBeGreaterThanOrEqual(paneBounds.x)
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(paneBounds.x + paneBounds.width)
    const local = await page.evaluate(() => {
        const layout = window.scalingTest.scene.elevationLayout.value
        const row = layout.rows.find((row) => row.note.left === 0)!
        return { x: row.x, y: row.y, delta: layout.yAt(4) - layout.yAt(3) }
    })
    const canvas = await page.locator('.elevation-canvas').boundingBox()
    if (!canvas) throw new Error('Missing elevation canvas')
    await page.mouse.move(canvas.x + local.x, canvas.y + local.y)
    await page.mouse.down()
    await page.mouse.move(canvas.x + local.x, canvas.y + local.y + local.delta, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    expect((await summary(page)).draft.map((note) => note.elevation)).toEqual([1, 4, 4])
    expect(
        await page.evaluate(() =>
            window.scalingTest.scene.elevationLayout.value.rows.map((row) => row.elevation),
        ),
    ).toEqual([1, 4])
    expect((await summary(page)).sourceUnchanged).toBe(true)
    expect((await summary(page)).canUndo).toBe(false)
    await page.screenshot({
        path: testInfo.outputPath('side-by-side-live-scaling.png'),
        style: '.notification { visibility: hidden }',
    })
    await panel(page).getByRole('button', { name: 'Apply', exact: true }).click()
    await page.keyboard.press('z')
    expect((await summary(page)).stored.map((note) => note.elevation)).toEqual([1, 3, 4])
    expect((await summary(page)).canUndo).toBe(false)
})

test('the bottom controls remain inside a narrow phone and Apply at factor one is harmless', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await seed(page)
    await page.evaluate(() => {
        window.editorTest.view.time = 1.5
    })
    await open(page)
    const box = await panel(page).boundingBox()
    if (!box) throw new Error('Missing scaling controls')
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.y + box.height).toBeLessThanOrEqual(568)
    await expect(factor(page)).toBeInViewport()
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
    await expect(panel(page).getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
    await page.screenshot({
        path: testInfo.outputPath('phone-live-scaling.png'),
        style: '.notification { visibility: hidden }',
    })
    await panel(page).getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).sourceUnchanged).toBe(true)
    expect((await summary(page)).canUndo).toBe(false)
})

test('selection replacement and choosing a different tool cancel stale scaling', async ({
    page,
}) => {
    await open(page)
    await factor(page).fill('2')
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).draftDifferent).toBe(false)
    await seed(page)
    await open(page)
    await factor(page).fill('2')
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { switchToolTo } = await import(
            urls.get('/src/editor/tools/index.ts') ?? '/src/editor/tools/index.ts'
        )
        switchToolTo('note')
    })
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).canUndo).toBe(false)
    expect((await summary(page)).dirty).toBe(false)
})

test('an unrelated preview takes ownership without being erased by scaling cancellation', async ({
    page,
}) => {
    await open(page)
    await factor(page).fill('2')
    const foreign = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { scalingSession } = await import(
            urls.get('/src/editor/commands/scaleSelection/session.ts') ??
                '/src/editor/commands/scaleSelection/session.ts'
        )
        const session = scalingSession.value!
        const foreign = { ...session.source, initialLife: 123 }
        window.scalingTest.preview.setPreviewEdit(session.source, () => foreign, [session.id, 2])
        await window.editorTest.nextTick()
        return {
            cancelled: scalingSession.value === undefined,
            foreignPreserved:
                window.scalingTest.preview.getPreviewState(
                    window.editorTest.history.state.value,
                ) === foreign,
        }
    })
    expect(foreign).toEqual({ cancelled: true, foreignPreserved: true })
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).sourceUnchanged).toBe(true)
    expect((await summary(page)).canUndo).toBe(false)
})

test('note property panels render a live draft, block note drags, and let Escape discard only the field', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { history, view } = window.editorTest
        const selected = [...history.state.value.store.slides.note.values()].flat()[1]!
        history.replaceState({ ...history.state.value, selectedEntities: [selected] })
        view.time = 0
        window.scalingTest.source = history.state.value
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { showToolModal } = await import(
            urls.get('/src/editor/toolModals.ts') ?? '/src/editor/toolModals.ts'
        )
        const { default: properties } =
            await import('/src/editor/workspace/properties/SelectionPropertiesModal.vue')
        void showToolModal(properties, { kind: 'note' })
    })
    const properties = page.locator('.editor-tool-modal')
    const lane = properties.getByRole('spinbutton', { name: 'Lane', exact: true })
    await expect(lane).toHaveValue('0')
    await settle(page)
    const original = await page
        .locator('canvas.editor-chart')
        .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await lane.fill('4')
    await settle(page)
    expect((await summary(page)).draft[1]!.left).toBe(4)
    expect((await summary(page)).stored[1]!.left).toBe(0)
    await expect
        .poll(() =>
            page
                .locator('canvas.editor-chart')
                .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
        )
        .not.toBe(original)
    const point = await chartPoint(page, 5, 5)
    const host = await properties.boundingBox()
    if (!host) throw new Error('Missing properties panel')
    expect(point.y).toBeLessThan(host.y)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x - 60, point.y + 60, { steps: 4 })
    await page.mouse.up()
    expect((await summary(page)).canUndo).toBe(true)
    expect((await summary(page)).stored[1]).toEqual({ beat: 5, elevation: 3, left: 4, size: 2 })
    await lane.fill('6')
    await lane.press('Escape')
    await expect(properties).toBeVisible()
    expect((await summary(page)).draftDifferent).toBe(false)
    expect((await summary(page)).stored[1]!.left).toBe(4)
    await properties.focus()
    await page.keyboard.press('Escape')
    await expect(properties).toHaveCount(0)
    await page.keyboard.press('z')
    expect((await summary(page)).stored[1]!.left).toBe(0)
    expect((await summary(page)).canUndo).toBe(false)
})

test('the spinner increments by tenths while a manually typed finer factor applies exactly', async ({
    page,
}) => {
    await open(page)
    await factor(page).press('ArrowUp')
    await expect(factor(page)).toHaveValue('1.1')
    await factor(page).press('ArrowDown')
    await expect(factor(page)).toHaveValue('1')
    await factor(page).fill('0.125')
    expect((await summary(page)).draft.map((note) => note.beat)).toEqual([3, 3.25, 8])
    expect((await summary(page)).canUndo).toBe(false)
    await panel(page).getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(panel(page)).toHaveCount(0)
    expect((await summary(page)).stored.map((note) => note.beat)).toEqual([3, 3.25, 8])
    await page.keyboard.press('z')
    expect((await summary(page)).stored.map((note) => note.beat)).toEqual([3, 5, 8])
    expect((await summary(page)).canUndo).toBe(false)
})

for (const axis of ['beat', 'elevation'] as const) {
    test(`${axis} endpoints scale around the opposite end and gesture cancellation retains earlier edits`, async ({
        page,
    }) => {
        await prepareThree(page, axis)
        const elevation = axis === 'elevation'
        const original = elevation ? [1, 2, 3, 4] : [3, 5, 7, 9]
        await dragAxis(page, axis, -4, original[0]!, elevation ? 1.5 : 4)
        await expectDraftAxis(page, axis, elevation ? [1.5, 2.25, 3, 4] : [4, 5.5, 7, 9])
        await dragAxis(page, axis, 4, original[2]!, elevation ? 3.5 : 8)
        const composed = elevation ? [1.5, 2.5, 3.5, 4] : [4, 6, 8, 9]
        await expectDraftAxis(page, axis, composed)
        const factorBefore = await factor(page).inputValue()
        const start = await axisPosition(page, axis, 0, composed[1]!)
        const end = await axisPosition(page, axis, 0, composed[1]! + (elevation ? 0.25 : 0.5))
        await touch(page, 'touchstart', start, elevation)
        await touch(page, 'touchmove', end, elevation)
        await settle(page)
        await expectDraftAxis(
            page,
            axis,
            composed.map((value, index) => (index < 3 ? value + (elevation ? 0.25 : 0.5) : value)),
        )
        await expect(factor(page)).toHaveValue(factorBefore)
        await touch(page, 'touchcancel', end, elevation)
        await settle(page)
        await expectDraftAxis(page, axis, composed)
        await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(panel(page)).toHaveCount(0)
        await expectDraftAxis(page, axis, original)
        expect((await summary(page)).draftDifferent).toBe(false)
    })

    test(`${axis} interior drags translate the selection and compose with numeric and endpoint scaling in one undo`, async ({
        page,
    }) => {
        await prepareThree(page, axis)
        const elevation = axis === 'elevation'
        await dragAxis(page, axis, 0, elevation ? 2 : 5, elevation ? 2.5 : 6)
        await expectDraftAxis(page, axis, elevation ? [1.5, 2.5, 3.5, 4] : [4, 6, 8, 9])
        await expect(factor(page)).toHaveValue('1')
        await factor(page).fill('1.5')
        await settle(page)
        await expectDraftAxis(page, axis, elevation ? [1.5, 3, 4.5, 4] : [4, 7, 10, 9])
        await dragAxis(page, axis, 4, elevation ? 4.5 : 10, elevation ? 5 : 12)
        const applied = elevation ? [1.5, 3.25, 5, 4] : [4, 8, 12, 9]
        await expectDraftAxis(page, axis, applied)
        await panel(page).getByRole('button', { name: 'Apply', exact: true }).click()
        await expect(panel(page)).toHaveCount(0)
        const result = await summary(page)
        for (const [index, value] of applied.entries())
            expect(result.stored[index]![axis]).toBeCloseTo(value, 8)
        expect(result.canUndo).toBe(true)
        await page.keyboard.press('z')
        await expectDraftAxis(page, axis, elevation ? [1, 2, 3, 4] : [3, 5, 7, 9])
        await page.keyboard.press('y')
        const redone = await summary(page)
        for (const [index, value] of applied.entries())
            expect(redone.stored[index]![axis]).toBeCloseTo(value, 8)
    })
}

test('attached slide interiors translate selected elevation endpoints without rewriting authored attachment values', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 3, left: -4, size: 2, elevation: 1 },
                        { ...base, beat: 3, left: 0, size: 2, elevation: 0, isAttached: true },
                        { ...base, beat: 3, left: 4, size: 2, elevation: 5 },
                    ],
                ],
            },
            3,
        )
        const selectedEntities = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities })
        window.scalingTest.source = history.state.value
        settings.elevationEditorSideBySide = 'allow'
    })
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await open(page, 'elevation')
    const begun = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const session = await import(
            urls.get('/src/editor/commands/scaleSelection/session.ts') ??
                '/src/editor/commands/scaleSelection/session.ts'
        )
        const note = window.scalingTest.source.selectedEntities.find(
            (entity) => entity.type === 'note' && entity.isAttached,
        )!
        if (note.type !== 'note') throw new Error('Missing attached note')
        const row = window.scalingTest.scene.elevationLayout.value.rows.find(
            (row) => row.note === note,
        )!
        if (!row.attached) throw new Error('Missing attached elevation row')
        const begun = session.beginScalingDrag(note, row.elevation)
        const updated = session.updateScalingDrag(row.elevation + 1)
        session.endScalingDrag()
        return { begun, updated }
    })
    expect(begun).toEqual({ begun: true, updated: true })
    await expectDraftAxis(page, 'elevation', [2, 0, 6])
    await expect(factor(page)).toHaveValue('1')
    expect(
        await page.evaluate(() =>
            window.scalingTest.preview
                .getPreviewState(window.editorTest.history.state.value)
                .selectedEntities.filter((entity) => entity.type === 'note')
                .map((note) => note.isAttached),
        ),
    ).toEqual([false, true, false])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectDraftAxis(page, 'elevation', [1, 0, 5])
    expect((await summary(page)).draftDifferent).toBe(false)
})
