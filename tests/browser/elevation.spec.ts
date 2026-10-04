import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

declare global {
    interface Window {
        elevationTest: {
            scene: typeof import('../../src/editor/elevation/scene')
            viewport: typeof import('../../src/editor/elevation/viewport')
            preview: typeof import('../../src/preview/edit')
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
const rows = (page: Page) =>
    page.evaluate(() =>
        window.elevationTest.scene.elevationLayout.value.rows.map((row) => ({
            x: row.x,
            y: row.y,
            w: row.w,
            beat: row.note.beat,
            left: row.note.left,
            size: row.note.size,
            elevation: row.elevation,
            slideId: row.note.slideId,
            order: row.order,
            attached: row.attached,
        })),
    )
const notes = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()]
            .flat()
            .map((note) => ({
                beat: note.beat,
                left: note.left,
                size: note.size,
                elevation: note.elevation,
            })),
    )
const install = async (page: Page) => {
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        window.elevationTest = {
            scene: await import(
                urls.get('/src/editor/elevation/scene.ts') ?? '/src/editor/elevation/scene.ts'
            ),
            viewport: await import(
                urls.get('/src/editor/elevation/viewport.ts') ?? '/src/editor/elevation/viewport.ts'
            ),
            preview: await import(urls.get('/src/preview/edit.ts') ?? '/src/preview/edit.ts'),
        }
    })
}
const open = async (page: Page) => {
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-editor')).toBeVisible()
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await install(page)
    await settle(page)
}
const point = async (page: Page, index = 0, edge?: 'left' | 'right') => {
    const row = (await rows(page))[index]
    const box = await page.locator('.elevation-canvas').boundingBox()
    if (!row || !box) throw new Error('Missing elevation note')
    return {
        x:
            box.x +
            row.x +
            (edge === 'left' ? -row.w / 2 + 5 : edge === 'right' ? row.w / 2 - 5 : 0),
        y: box.y + row.y,
    }
}
const displacement = (page: Page, lane: number, elevation: number) =>
    page.evaluate(
        ({ lane, elevation }) => {
            const layout = window.elevationTest.scene.elevationLayout.value
            return { x: layout.xAt(lane) - layout.xAt(0), y: layout.yAt(elevation) - layout.yAt(0) }
        },
        { lane, elevation },
    )
const at = async (page: Page, lane: number, elevation: number) => {
    const local = await page.evaluate(
        ({ lane, elevation }) => {
            const layout = window.elevationTest.scene.elevationLayout.value
            return { x: layout.xAt(lane), y: layout.yAt(elevation) }
        },
        { lane, elevation },
    )
    const box = await page.locator('.elevation-canvas').boundingBox()
    if (!box) throw new Error('Missing elevation canvas')
    return { x: box.x + local.x, y: box.y + local.y }
}
const mouseDrag = async (
    page: Page,
    start: { x: number; y: number },
    delta: { x: number; y: number },
) => {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 })
    await settle(page)
}

test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = []
    errors.set(page, pageErrors)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 6, left: 0, size: 2, elevation: 2 }],
                    [{ ...base, beat: 8, left: 3, size: 2, elevation: 0 }],
                ],
            },
            3,
        )
        view.cursorTime = 3
        window.editorTest.settings.elevationEditorSideBySide = 'disallow'
    })
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

test.describe('phone elevation scale', () => {
    test.use({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
    })

    test('signed and multi-digit numbers align with the grid', async ({ page }, testInfo) => {
        await open(page)
        const labels = await page.evaluate(async () => {
            const labels = new Map<
                string,
                {
                    align: CanvasTextAlign
                    anchor: number
                    right: number
                    middle: number
                    grid: number
                }
            >()
            const fillText = CanvasRenderingContext2D.prototype.fillText
            CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
                if (
                    this.canvas instanceof HTMLCanvasElement &&
                    this.canvas.classList.contains('elevation-canvas') &&
                    /^-?\d+$/.test(text)
                ) {
                    const metrics = this.measureText(text)
                    labels.set(text, {
                        align: this.textAlign,
                        anchor: x,
                        right: x + metrics.actualBoundingBoxRight,
                        middle:
                            y +
                            (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) /
                                2,
                        grid: window.elevationTest.scene.elevationLayout.value.yAt(Number(text)),
                    })
                }
                if (maxWidth === undefined) fillText.call(this, text, x, y)
                else fillText.call(this, text, x, y, maxWidth)
            }
            const viewport = window.elevationTest.viewport.elevationViewport
            viewport.center = 4.5
            viewport.scale = 30
            await window.editorTest.nextTick()
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
            CanvasRenderingContext2D.prototype.fillText = fillText
            return [...labels.entries()]
        })
        expect(labels.map(([text]) => text)).toEqual(expect.arrayContaining(['-1', '0', '10']))
        for (const [text, label] of labels) {
            expect(label.align, text).toBe('right')
            expect(label.anchor, text).toBe(28)
            expect(label.right, text).toBeGreaterThan(25)
            expect(label.right, text).toBeLessThan(29)
            expect(Math.abs(label.middle - label.grid), text).toBeLessThanOrEqual(0.5)
        }
        await page.screenshot({
            path: testInfo.outputPath('phone-elevation-numbers.png'),
            style: '.notification { visibility:hidden }',
        })
    })
})

test('elevation mode replaces the chart and closes back to the previous tool', async ({ page }) => {
    await page.keyboard.press('a')
    await open(page)
    await expect(page.locator('canvas.editor-chart')).toHaveCount(0)
    await expect(page.locator('.preview')).toHaveCount(0)
    expect(await notes(page)).toHaveLength(2)
    const axis = await page.evaluate(() => {
        const layout = window.elevationTest.scene.elevationLayout.value
        return {
            top: layout.yAt(5),
            bottom: layout.yAt(0),
        }
    })
    const box = await page.locator('.elevation-canvas').boundingBox()
    expect(axis.top).toBeGreaterThanOrEqual(0)
    expect(axis.bottom).toBeLessThanOrEqual(box!.height)
    await page.getByRole('button', { name: 'Close elevation editor', exact: true }).click()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(page.locator('.bg-preview > span.flex-grow')).toHaveText(/^Note(?: |$)/)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('only exact-beat notes appear and all editor filters still apply', async ({ page }) => {
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, isDynamicStages: true })
    })
    await open(page)
    expect((await rows(page)).map((row) => row.beat)).toEqual([6])
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('7')
    await beat.press('Tab')
    await expect.poll(() => rows(page)).toEqual([])
    await beat.fill('8')
    await beat.press('Tab')
    await expect.poll(async () => (await rows(page)).map((row) => row.beat)).toEqual([8])
    await page.evaluate(() => {
        window.editorTest.view.visibilities = {
            ...window.editorTest.view.visibilities,
            note: false,
        }
    })
    await expect.poll(() => rows(page)).toEqual([])
    await page.evaluate(() => {
        window.editorTest.view.visibilities = { ...window.editorTest.view.visibilities, note: true }
        window.editorTest.view.groupId = 2 as typeof window.editorTest.view.groupId
    })
    await expect.poll(() => rows(page)).toEqual([])
    await page.evaluate(() => {
        window.editorTest.view.groupId = undefined
        window.editorTest.view.stageId = 2 as typeof window.editorTest.view.stageId
    })
    await expect.poll(() => rows(page)).toEqual([])
    await page.evaluate(() => {
        window.editorTest.view.stageId = undefined
    })
    await expect.poll(async () => (await rows(page)).map((row) => row.beat)).toEqual([8])
})

test('opening uses the selected note beat instead of the caret beat', async ({ page }) => {
    await page.evaluate(() => {
        const { history } = window.editorTest
        const note = [...history.state.value.store.slides.note.values()]
            .flat()
            .find((note) => note.beat === 8)!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
    })
    await open(page)
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('8')
    expect((await rows(page)).map((row) => row.beat)).toEqual([8])
})

test('context actions open the clicked note beat or empty-space beat after deselection', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.mouseSecondaryTool = 'selectContextMenu'
    })
    const note = await page.evaluate(() => window.editorTest.point(1, 6))
    await page.mouse.click(note.x, note.y, { button: 'right' })
    await expect(page.getByRole('menuitem').nth(0)).toHaveAccessibleName('Cut')
    await expect(page.getByRole('menuitem').nth(1)).toHaveAccessibleName('Copy')
    await expect(page.getByRole('menuitem').nth(2)).toHaveAccessibleName('Paste')
    await page.getByRole('menuitem', { name: 'Edit elevations', exact: true }).click()
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await install(page)
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('6')
    await page.getByRole('button', { name: 'Close elevation editor', exact: true }).click()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const empty = await page.evaluate(() => window.editorTest.point(-5, 7))
    await page.mouse.click(empty.x, empty.y, { button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual([])
    await page.mouse.click(empty.x, empty.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit elevations', exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('7')
    await expect.poll(() => rows(page)).toEqual([])
})

for (const split of [false, true]) {
    test(`empty elevation right clicks clear off-beat selections before opening a menu (${split ? 'split' : 'replacement'})`, async ({
        page,
    }) => {
        await page.evaluate((split) => {
            window.editorTest.settings.mouseSecondaryTool = 'selectContextMenu'
            window.editorTest.settings.elevationEditorSideBySide = split ? 'allow' : 'disallow'
        }, split)
        await open(page)
        const before = await page.evaluate(() => {
            const { history, view } = window.editorTest
            const note = [...history.state.value.store.slides.note.values()]
                .flat()
                .find((note) => note.beat === 8)!
            history.replaceState({ ...history.state.value, selectedEntities: [note] })
            return {
                beat: window.elevationTest.scene.elevationLayout.value.rows[0]!.note.beat,
                cursor: view.cursorTime,
            }
        })
        const empty = await at(page, 5, 1)
        await page.mouse.click(empty.x, empty.y, { button: 'right' })
        await expect(page.getByRole('menu')).toHaveCount(0)
        expect((await page.evaluate(() => window.editorTest.snapshot())).selected).toEqual([])
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue(
            String(before.beat),
        )
        expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(before.cursor)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        await page.mouse.click(empty.x, empty.y, { button: 'right' })
        await expect(page.getByRole('menu')).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
        await page.keyboard.press('Escape')
        const note = await point(page)
        await page.mouse.click(note.x, note.y, { button: 'right' })
        await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible()
        expect(
            (await page.evaluate(() => window.editorTest.snapshot())).selected.map(
                (note) => note.beat,
            ),
        ).toEqual([before.beat])
    })
}

test('body drags edit lane and snapped elevation live with one undo step', async ({ page }) => {
    await open(page)
    await expect(
        page.getByRole('combobox', { name: 'Elevation snapping', exact: true }),
    ).toHaveValue('8')
    const initial = await notes(page)
    await mouseDrag(page, await point(page), await displacement(page, 2, 0.18))
    expect(await notes(page)).toEqual(initial)
    expect(
        await page.evaluate(
            () =>
                [
                    ...window.elevationTest.preview
                        .getPreviewState(window.editorTest.history.state.value)
                        .store.slides.note.values(),
                ].flat()[0]?.elevation,
        ),
    ).toBe(2.125)
    await page.mouse.up()
    await expect
        .poll(() => notes(page))
        .toEqual([
            { beat: 6, left: 2, size: 2, elevation: 2.125 },
            { beat: 8, left: 3, size: 2, elevation: 0 },
        ])
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await mouseDrag(page, await point(page), await displacement(page, 2, 0.5))
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('edge drags resize while preserving beat and elevation; snapping is adjustable', async ({
    page,
}) => {
    await open(page)
    const initial = await notes(page)
    await mouseDrag(page, await point(page, 0, 'left'), await displacement(page, -2, 0.5))
    await page.mouse.up()
    expect(await notes(page)).toEqual([
        { beat: 6, left: -2, size: 4, elevation: 2 },
        { beat: 8, left: 3, size: 2, elevation: 0 },
    ])
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual(initial)
    await page.getByRole('combobox', { name: 'Elevation snapping', exact: true }).selectOption('4')
    await mouseDrag(page, await point(page), await displacement(page, 0, 0.3))
    await page.mouse.up()
    expect((await notes(page))[0]?.elevation).toBe(2.25)
})

test('same-beat overlapping notes remain at their actual elevation', async ({ page }, testInfo) => {
    await page.evaluate(() => {
        const { fixtures, show, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 6, left: -3, elevation: 2 },
                        { ...base, beat: 6, left: 3, elevation: 2 },
                    ],
                    [{ ...base, beat: 6, left: -3, elevation: 2 }],
                ],
            },
            3,
        )
        view.cursorTime = 3
    })
    await open(page)
    const displayed = await rows(page)
    expect(displayed).toHaveLength(3)
    const slide = displayed
        .filter((row) => row.slideId === displayed[0]?.slideId)
        .sort((a, b) => a.order - b.order)
    expect(slide).toHaveLength(2)
    expect(slide[1]!.y).toBe(slide[0]!.y)
    const overlapping = displayed.filter((row) => row.left === -3)
    expect(overlapping[0]!.y).toBe(overlapping[1]!.y)
    expect(new Set(displayed.map((row) => row.y)).size).toBe(1)
    const target = await point(
        page,
        displayed.findIndex((row) => row.left === 3),
    )
    await page.mouse.click(target.x, target.y)
    expect(
        await page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length),
    ).toBe(1)
    await page.screenshot({
        path: testInfo.outputPath('elevation-desktop.png'),
        style: '.notification { visibility: hidden }',
    })
})

for (const connectorLayer of ['top', 'over'] as const) {
    test(
        'same-beat slide connectors fill the note widths at their actual elevations (' +
            connectorLayer +
            ')',
        async ({ page }, testInfo) => {
            await page.evaluate((connectorLayer) => {
                const { fixtures, show, view } = window.editorTest
                const base = fixtures.interaction.slides[0]![0]!
                show(
                    {
                        ...fixtures.interaction,
                        slides: [
                            [
                                {
                                    ...base,
                                    beat: 6,
                                    left: -3,
                                    size: 4,
                                    elevation: 1,
                                    connectorEase: 'linear',
                                    connectorLayer,
                                },
                                { ...base, beat: 6, left: 1, size: 2, elevation: 4 },
                            ],
                        ],
                    },
                    3,
                )
                view.cursorTime = 3
            }, connectorLayer)
            await open(page)
            const sample = () =>
                page.evaluate(() => {
                    const canvas = document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
                    const layout = window.elevationTest.scene.elevationLayout.value
                    const [head, tail] = [...layout.rows].sort((a, b) => a.order - b.order)
                    const x = (head!.x + tail!.x) / 2 + (head!.w + tail!.w) / 8
                    const y = (head!.y + tail!.y) / 2
                    return [
                        ...canvas
                            .getContext('2d')!
                            .getImageData(
                                Math.round((x * canvas.width) / layout.width),
                                Math.round((y * canvas.height) / layout.height),
                                1,
                                1,
                            ).data,
                    ]
                })
            const filled = await sample()
            await page.evaluate(() => {
                window.editorTest.view.visibilities = {
                    ...window.editorTest.view.visibilities,
                    connector: false,
                }
            })
            await settle(page)
            const empty = await sample()
            expect(filled).not.toEqual(empty)
            expect(filled[3]).toBeGreaterThan(empty[3]!)
            await page.evaluate(() => {
                window.editorTest.view.visibilities = {
                    ...window.editorTest.view.visibilities,
                    connector: true,
                }
            })
            await settle(page)
            await page.mouse.click((await point(page, 0)).x, (await point(page, 0)).y)
            await settle(page)
            await page.screenshot({ path: testInfo.outputPath('elevation-connectors.png') })
        },
    )
}

test('attached notes display inherited stage plus note elevation and remain read-only', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stageTransformEvents: [{ ...transform, beat: 0, xTranslation: 0, elevation: 2 }],
                slides: [
                    [
                        { ...base, beat: 4, elevation: 0 },
                        { ...base, beat: 6, elevation: 9, isAttached: true },
                        { ...base, beat: 8, elevation: 1 },
                    ],
                ],
            },
            3,
        )
        view.cursorTime = 3
    })
    await open(page)
    const displayed = await rows(page)
    expect(displayed).toHaveLength(1)
    expect(displayed[0]?.attached).toBe(true)
    expect(displayed[0]?.elevation).toBe(2.5)
    const initial = await notes(page)
    await mouseDrag(page, await point(page), await displacement(page, 1, 0.5))
    await page.mouse.up()
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('mobile touch dragging uses the same editor controls and cancellation', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    const header = await page.locator('.elevation-header').boundingBox()
    const canvas = await page.locator('.elevation-canvas').boundingBox()
    const topElevation = await page.evaluate(() =>
        window.elevationTest.scene.elevationLayout.value.yAt(5),
    )
    if (!header || !canvas) throw new Error('Missing elevation controls')
    expect(canvas.y + topElevation).toBeGreaterThanOrEqual(header.y + header.height + 8)
    const initial = await notes(page)
    const start = await point(page)
    const delta = await displacement(page, 2, 0.25)
    const touch = (type: string, x: number, y: number) =>
        page.evaluate(
            ({ type, x, y }) => {
                const target =
                    document.querySelector('.elevation-editor .editor') ??
                    document.querySelector('.elevation-editor')!
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
    await touch('touchstart', start.x, start.y)
    await touch('touchmove', start.x + delta.x, start.y + delta.y)
    await settle(page)
    await touch('touchcancel', start.x + delta.x, start.y + delta.y)
    await settle(page)
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await touch('touchstart', start.x, start.y)
    await touch('touchmove', start.x + delta.x, start.y + delta.y)
    await settle(page)
    await touch('touchend', start.x + delta.x, start.y + delta.y)
    await settle(page)
    expect((await notes(page))[0]).toEqual({ beat: 6, left: 2, size: 2, elevation: 2.25 })
    await page.screenshot({
        path: testInfo.outputPath('elevation-mobile.png'),
        style: '.notification { visibility: hidden }',
    })
})

test('wheel scrolling and keyboard zoom navigate the elevation view without editing notes', async ({
    page,
}) => {
    await open(page)
    const initial = await notes(page)
    const viewport = () =>
        page.evaluate(() => ({ ...window.elevationTest.viewport.elevationViewport }))
    const before = await viewport()
    const box = await page.locator('.elevation-canvas').boundingBox()
    if (!box) throw new Error('Missing elevation canvas')
    await page.mouse.move(box.x + box.width / 2, box.y + 100)
    await page.mouse.wheel(0, 120)
    await expect.poll(async () => (await viewport()).center).not.toBe(before.center)
    const scrolled = await viewport()
    await page.keyboard.press('=')
    await expect.poll(async () => (await viewport()).scale).toBeGreaterThan(scrolled.scale)
    const zoomed = await viewport()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await viewport()).center).not.toBe(zoomed.center)
    expect(await notes(page)).toEqual(initial)
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('6')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('pinch gestures zoom elevation using the shared touch controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    const initial = await notes(page)
    const before = await page.evaluate(() => window.elevationTest.viewport.elevationViewport.scale)
    const box = await page.locator('.elevation-canvas').boundingBox()
    if (!box) throw new Error('Missing elevation canvas')
    const x = box.x + box.width * 0.45
    const y = box.y + box.height / 2
    const touch = (type: string, distance: number) =>
        page.evaluate(
            ({ type, x, y, distance }) => {
                const target =
                    document.querySelector('.elevation-editor .editor') ??
                    document.querySelector('.elevation-editor')!
                const changedTouches = [-1, 1].map(
                    (direction, index) =>
                        new Touch({
                            identifier: index + 1,
                            target,
                            clientX: x,
                            clientY: y + direction * distance,
                        }),
                )
                target.dispatchEvent(
                    new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
                )
            },
            { type, x, y, distance },
        )
    await touch('touchstart', 50)
    await touch('touchmove', 100)
    await settle(page)
    await touch('touchmove', 130)
    await settle(page)
    await touch('touchend', 130)
    await expect
        .poll(() => page.evaluate(() => window.elevationTest.viewport.elevationViewport.scale))
        .toBeGreaterThan(before)
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('elevation mode remains open when switching the normal editing tools', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => '',
        })
    })
    for (const [name, shortcut] of [
        ['Note', 'a'],
        ['Slide', 's'],
        ['Select', 'f'],
        ['Eraser', 'g'],
        ['Brush', 'b'],
        ['Paste', 'v'],
    ] as const) {
        await page.keyboard.press(shortcut)
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await expect(page.locator('canvas.editor-chart')).toHaveCount(0)
        await expect(page.locator('.bg-preview > span.flex-grow')).toHaveText(
            new RegExp(`^${name}(?: |$)`),
        )
    }
})

for (const sideBySide of ['disallow', 'allow'] as const) {
    test(`changing a selected note beat in the property sidebar removes it until undo (${sideBySide})`, async ({
        page,
    }) => {
        await page.evaluate((sideBySide) => {
            window.editorTest.settings.elevationEditorSideBySide = sideBySide
        }, sideBySide)
        await open(page)
        await page.evaluate(() => {
            window.editorTest.settings.showSidebar = true
        })
        await settle(page)
        const target = await point(page)
        await page.mouse.click(target.x, target.y)
        const propertyBeat = page
            .locator('.relative.z-10.bg-modal')
            .getByRole('spinbutton', { name: 'Beat', exact: true })
        await expect(propertyBeat).toHaveValue('6')
        await propertyBeat.fill('7')
        await propertyBeat.press('Tab')
        await expect.poll(() => rows(page)).toEqual([])
        await expect(
            page
                .locator('.elevation-editor')
                .getByRole('spinbutton', { name: 'Beat', exact: true }),
        ).toHaveValue('6')
        const box = await page.locator('.elevation-canvas').boundingBox()
        if (!box) throw new Error('Missing elevation canvas')
        await page.mouse.click(box.x + 5, box.y + 100)
        await page.keyboard.press('z')
        await expect.poll(async () => (await rows(page)).map((row) => row.beat)).toEqual([6])
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

for (const [name, shortcut] of [
    ['Note', 'a'],
    ['Slide', 's'],
] as const) {
    test(`${name} can place notes at the displayed beat and clicked elevation`, async ({
        page,
    }) => {
        await open(page)
        await page.keyboard.press(shortcut)
        const initial = await notes(page)
        const target = await at(page, -5, 1.5)
        await page.mouse.click(target.x, target.y)
        await expect.poll(() => notes(page)).toHaveLength(3)
        expect((await notes(page)).find((note) => note.left === -5)).toMatchObject({
            beat: 6,
            elevation: 1.5,
        })
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        await page.keyboard.press('z')
        expect(await notes(page)).toEqual(initial)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

test('the eraser deletes a displayed note and undoes without closing elevation mode', async ({
    page,
}) => {
    await open(page)
    const initial = await notes(page)
    await page.keyboard.press('g')
    const target = await point(page)
    await page.mouse.click(target.x, target.y)
    await expect.poll(() => notes(page)).toEqual([initial[1]])
    await expect.poll(() => rows(page)).toEqual([])
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('the brush applies note properties within elevation mode', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
        window.editorTest.settings.showSidebar = true
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { brushProperties } = (await import(
            urls.get('/src/editor/tools/brush/index.ts') ?? '/src/editor/tools/brush/index.ts'
        )) as typeof import('../../src/editor/tools/brush')
        brushProperties.value = { isCritical: true }
    })
    await page.keyboard.press('b')
    await settle(page)
    const target = await point(page)
    await page.mouse.click(target.x, target.y)
    expect(
        await page.evaluate(
            () =>
                [...window.editorTest.history.state.value.store.slides.note.values()]
                    .flat()
                    .find((note) => note.beat === 6)?.isCritical,
        ),
    ).toBe(true)
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.keyboard.press('z')
    expect(
        await page.evaluate(
            () =>
                [...window.editorTest.history.state.value.store.slides.note.values()]
                    .flat()
                    .find((note) => note.beat === 6)?.isCritical,
        ),
    ).toBe(false)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('paste places clipboard notes at the clicked elevation while preserving relative offsets', async ({
    page,
}) => {
    await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => '',
        })
        const { history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    await page.keyboard.press('c')
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await open(page)
    const initial = await notes(page)
    await page.keyboard.press('v')
    const target = await at(page, -5, 1.5)
    await page.mouse.click(target.x, target.y)
    await expect.poll(() => notes(page)).toHaveLength(4)
    expect(
        (await notes(page)).filter((note) => note.left < 0).sort((a, b) => a.beat - b.beat),
    ).toEqual([
        { beat: 6, left: -6, size: 2, elevation: 1.5 },
        { beat: 8, left: -3, size: 2, elevation: -0.5 },
    ])
    expect((await rows(page)).map((row) => row.beat)).toEqual([6, 6])
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('resetting the chart keeps elevation mode open safely with the new chart', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show(fixtures.interaction, 3)
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    expect(await notes(page)).toHaveLength(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    const beat = page
        .locator('.elevation-editor')
        .getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('5')
    await beat.press('Tab')
    await expect.poll(async () => (await rows(page)).map((row) => row.beat)).toEqual([5])
})

test('side-by-side Auto adapts to available width and the explicit options override it', async ({
    page,
}, testInfo) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'auto'
        window.editorTest.settings.showPreview = true
        window.editorTest.settings.previewPosition = 'left'
        window.editorTest.settings.previewWidth = 280
    })
    await open(page)
    await expect(page.locator('.elevation-header select')).toHaveCount(1)
    const setPreference = async (value: 'auto' | 'allow' | 'disallow') => {
        await page.keyboard.press(',')
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const preference = dialog
            .locator('label')
            .filter({ has: page.getByText('Elevation Editor Side by Side', { exact: true }) })
            .getByRole('combobox')
        await preference.selectOption(value)
        await expect(preference).toHaveValue(value)
        await dialog.locator('.bg-header button').click()
        await expect(dialog).toHaveCount(0)
    }
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await expect(page.locator('.preview')).toBeVisible()
    const chart = await page.locator('canvas.editor-chart').boundingBox()
    const elevation = await page.locator('.elevation-canvas').boundingBox()
    expect(chart!.x + chart!.width).toBeLessThanOrEqual(elevation!.x)
    await page.screenshot({
        path: testInfo.outputPath('elevation-side-by-side.png'),
        style: '.notification { visibility: hidden }',
    })
    await setPreference('disallow')
    await expect(page.locator('canvas.editor-chart')).toHaveCount(0)
    await page.setViewportSize({ width: 700, height: 700 })
    await setPreference('auto')
    await expect(page.locator('canvas.editor-chart')).toHaveCount(0)
    await setPreference('allow')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    const chartBounds = await page.locator('canvas.editor-chart').boundingBox()
    if (!chartBounds) throw new Error('Missing chart canvas')
    await page.mouse.click(chartBounds.x + 10, chartBounds.y + 100)
    await page.keyboard.press('q')
    await expect(page.locator('.bg-preview > span.flex-grow')).toHaveText(/^BPM(?: |$)/)
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
})

test('each canvas uses its own coordinates and meaning for note drags when side by side', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    await page.keyboard.press('f')
    const start = await page.evaluate(() => window.editorTest.point(1, 6))
    const end = await page.evaluate(() => window.editorTest.point(1, 7))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await settle(page)
    await page.mouse.up()
    expect((await notes(page)).find((note) => note.left === 0)).toMatchObject({
        beat: 7,
        elevation: 2,
    })
    await expect.poll(async () => (await rows(page)).map((row) => row.beat)).toEqual([7])
    await mouseDrag(page, await point(page), await displacement(page, 2, 0.25))
    await page.mouse.up()
    expect((await notes(page)).find((note) => note.left === 2)).toEqual({
        beat: 7,
        left: 2,
        size: 2,
        elevation: 2.25,
    })
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.keyboard.press('z')
    expect((await notes(page)).find((note) => note.left === 0)).toEqual({
        beat: 7,
        left: 0,
        size: 2,
        elevation: 2,
    })
    await page.keyboard.press('z')
    expect((await notes(page)).find((note) => note.left === 0)).toEqual({
        beat: 6,
        left: 0,
        size: 2,
        elevation: 2,
    })
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('main note selection and blank caret taps follow the beat while a mixed-beat selection preserves the slice', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    await page.keyboard.press('f')
    const beat = page
        .locator('.elevation-editor')
        .getByRole('spinbutton', { name: 'Beat', exact: true })
    const chartClick = async (lane: number, beat: number) => {
        const target = await page.evaluate(
            ({ lane, beat }) => window.editorTest.point(lane, beat),
            { lane, beat },
        )
        await page.mouse.click(target.x, target.y)
    }
    await chartClick(4, 8)
    await expect(beat).toHaveValue('8')
    await chartClick(-5, 7)
    await expect(beat).toHaveValue('7')
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(3.5)
    await chartClick(1, 6)
    await expect(beat).toHaveValue('6')
    await page.keyboard.down('Control')
    await chartClick(4, 8)
    await page.keyboard.up('Control')
    expect(
        await page.evaluate(() =>
            window.editorTest
                .snapshot()
                .selected.map((entity) => entity.beat)
                .sort((a, b) => a - b),
        ),
    ).toEqual([6, 8])
    await expect(beat).toHaveValue('6')
    expect((await rows(page)).map((row) => row.beat)).toEqual([6])
})

test('the elevation Beat input updates the main caret and brings that beat into view', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    const beat = page
        .locator('.elevation-editor')
        .getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('40')
    await beat.press('Tab')
    await expect(beat).toHaveValue('40')
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(20)
    const chart = await page.locator('canvas.editor-chart').boundingBox()
    if (!chart) throw new Error('Missing chart canvas')
    await expect
        .poll(async () => {
            const target = await page.evaluate(() => window.editorTest.point(0, 40))
            return target.y >= chart.y && target.y <= chart.y + chart.height
        })
        .toBe(true)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('cut and paste within elevation mode preserve the same beat and exact anchor', async ({
    page,
}) => {
    await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => '',
        })
    })
    await open(page)
    const initial = await notes(page)
    const target = await point(page)
    await page.mouse.click(target.x, target.y)
    await page.keyboard.press('x')
    await expect.poll(() => notes(page)).toEqual([initial[1]])
    await page.keyboard.press('v')
    const anchor = await at(page, 1, 2)
    await page.mouse.click(anchor.x, anchor.y)
    await expect.poll(() => notes(page)).toHaveLength(2)
    expect((await notes(page)).find((note) => note.beat === 6)).toEqual(initial[0])
    await expect(
        page.locator('.elevation-editor').getByRole('spinbutton', { name: 'Beat', exact: true }),
    ).toHaveValue('6')
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual([initial[1]])
    await page.keyboard.press('z')
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('switching from Note to Select clears an idle creation ghost without editing', async ({
    page,
}) => {
    await open(page)
    await page.keyboard.press('a')
    const target = await at(page, -5, 1.5)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toHaveLength(1)
    await page.keyboard.press('f')
    await expect.poll(() => page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([])
    expect(await notes(page)).toHaveLength(2)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('the split divider supports dragging, keyboard resizing, persistence, and reset without editing notes', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    const initial = await notes(page)
    const divider = page.getByRole('separator', { name: 'Resize elevation editor', exact: true })
    await expect(divider).toBeVisible()
    const before = await page.locator('.elevation-canvas').boundingBox()
    const separator = await divider.boundingBox()
    if (!before || !separator) throw new Error('Missing split panes')
    await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2)
    await page.mouse.down()
    await page.mouse.move(separator.x - 160, separator.y + separator.height / 2, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    const resized = await page.locator('.elevation-canvas').boundingBox()
    expect(resized!.width).toBeGreaterThan(before.width)
    const dragged = await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)
    expect(dragged).toBeGreaterThan(50)
    expect(
        await page.evaluate(() =>
            JSON.parse(
                localStorage.getItem('sonolus-next-sekai-editor.elevationEditorWidth') ?? 'null',
            ),
        ),
    ).toBe(dragged)
    const viewBeforeKeys = await page.evaluate(() => ({
        lane: window.editorTest.view.lane,
        time: window.editorTest.view.time,
    }))
    await divider.focus()
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)).toBeLessThan(
        dragged,
    )
    await page.keyboard.press('ArrowLeft')
    expect(await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)).toBeCloseTo(
        dragged,
    )
    expect(
        await page.evaluate(() => ({
            lane: window.editorTest.view.lane,
            time: window.editorTest.view.time,
        })),
    ).toEqual(viewBeforeKeys)
    await divider.dblclick()
    expect(await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)).toBe(50)
    expect(
        await page.evaluate(() =>
            localStorage.getItem('sonolus-next-sekai-editor.elevationEditorWidth'),
        ),
    ).toBeNull()
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('the split divider keeps both panes usable when dragged to either extreme in a narrow viewport', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 700, height: 700 })
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await open(page)
    const initial = await notes(page)
    const divider = page.getByRole('separator', { name: 'Resize elevation editor', exact: true })
    for (const x of [5, 695]) {
        const separator = await divider.boundingBox()
        if (!separator) throw new Error('Missing split divider')
        await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2)
        await page.mouse.down()
        await page.mouse.move(x, separator.y + separator.height / 2, { steps: 5 })
        await page.mouse.up()
        await settle(page)
        const chart = await page.locator('canvas.editor-chart').boundingBox()
        const elevation = await page.locator('.elevation-canvas').boundingBox()
        expect(chart!.width).toBeGreaterThanOrEqual(200)
        expect(elevation!.width).toBeGreaterThanOrEqual(200)
        const percentage = await page.evaluate(
            () => window.editorTest.settings.elevationEditorWidth,
        )
        expect(percentage).toBeGreaterThanOrEqual(20)
        expect(percentage).toBeLessThanOrEqual(80)
        expect(await notes(page)).toEqual(initial)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    }
    await page.screenshot({
        path: testInfo.outputPath('elevation-resized-narrow.png'),
        style: '.notification { visibility: hidden }',
    })
})

test('selection highlighting updates without rebuilding elevation notes or their layout', async ({
    page,
}) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.evaluate(() => {
        window.editorTest.settings.showPreview = true
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await expect(page.locator('.preview').getByText('Note Speed', { exact: true })).toBeVisible()
    await open(page)
    const initial = await notes(page)
    const identity = await page.evaluate(async () => {
        const { history, nextTick } = window.editorTest
        const { elevationNotes, elevationLayout } = window.elevationTest.scene
        const previousNotes = elevationNotes.value
        const previousLayout = elevationLayout.value
        const selected = previousNotes[0]?.note
        if (!selected) throw new Error('Missing elevation note')
        history.replaceState({ ...history.state.value, selectedEntities: [selected] })
        await nextTick()
        return {
            notes: elevationNotes.value === previousNotes,
            layout: elevationLayout.value === previousLayout,
        }
    })
    expect(identity).toEqual({ notes: true, layout: true })
    const outlinePixels = () =>
        page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('.preview-selection')
            const data = canvas
                ?.getContext('2d')
                ?.getImageData(0, 0, canvas.width, canvas.height).data
            return data?.filter((value, index) => index % 4 === 3 && value > 0).length ?? 0
        })
    await expect.poll(outlinePixels).toBeGreaterThan(0)
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await expect.poll(outlinePixels).toBe(0)
    const filtered = await page.evaluate(async () => {
        const { elevationNotes, elevationLayout } = window.elevationTest.scene
        const previousNotes = elevationNotes.value
        const previousLayout = elevationLayout.value
        window.editorTest.view.visibilities = {
            ...window.editorTest.view.visibilities,
            note: false,
        }
        await window.editorTest.nextTick()
        return {
            notesChanged: elevationNotes.value !== previousNotes,
            layoutChanged: elevationLayout.value !== previousLayout,
            count: elevationLayout.value.rows.length,
        }
    })
    expect(filtered).toEqual({ notesChanged: true, layoutChanged: true, count: 0 })
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('elevation toolbar offers spatial actions and omits time reversal', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['flip'], ['flipVertical'], ['combineNotes']]
    })
    await open(page)
    const editor = page.locator('.elevation-editor')
    await expect(
        editor.getByRole('button', { name: 'Flip horizontally', exact: true }),
    ).toBeVisible()
    await expect(
        editor.getByRole('button', { name: 'Combine into slide', exact: true }),
    ).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Flip vertically', exact: true })).toHaveCount(
        0,
    )
    expect(await notes(page)).toHaveLength(2)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('context elevation scaling preserves the lowest note and keeps the pane open', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 6, left: -3, elevation: 2 }],
                    [{ ...base, beat: 6, left: 1, elevation: 4 }],
                ],
            },
            3,
        )
        settings.mouseSecondaryTool = 'selectContextMenu'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    await open(page)
    const hit = await point(page)
    await page.mouse.click(hit.x, hit.y, { button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Scale beats', exact: true })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Scale elevations', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton', { name: 'Scale factor', exact: true }).fill('0.5')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.elevation-editor')).toBeVisible()
    expect((await notes(page)).map((note) => note.elevation).sort((a, b) => a - b)).toEqual([2, 3])
    await page.keyboard.press('z')
    expect((await notes(page)).map((note) => note.elevation).sort((a, b) => a - b)).toEqual([2, 4])
})

for (const width of [1600, 375, 320]) {
    test(`elevation management and chart controls remain usable at width ${width}`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize({ width, height: width === 1600 ? 1000 : 812 })
        await page.evaluate(async () => {
            const { history } = window.editorTest
            const { addToStages } = await import('/src/chart/stages.ts')
            const stages = new Map(history.state.value.stages)
            while (stages.size === history.state.value.stages.size) addToStages(stages)
            history.replaceState({ ...history.state.value, isDynamicStages: true })
        })
        await open(page)
        const editor = page.locator('.elevation-editor')
        for (const [name, collection] of [
            ['Manage groups', 'groups'],
            ['Manage stages', 'stages'],
        ] as const) {
            const before = await page.evaluate(
                (key) => window.editorTest.history.state.value[key].size,
                collection,
            )
            await editor.getByRole('button', { name, exact: true }).first().click()
            const dialog = page.getByRole('dialog')
            await expect(dialog).toBeVisible()
            await dialog.getByRole('button', { name: 'Add', exact: true }).click()
            await expect
                .poll(() =>
                    page.evaluate(
                        (key) => window.editorTest.history.state.value[key].size,
                        collection,
                    ),
                )
                .toBe(before + 1)
            await dialog.locator('.bg-header button').click()
            await expect(editor).toBeVisible()
            await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue(
                '6',
            )
        }
        for (const name of ['Open', 'Play', '1/1']) {
            const button = editor.getByRole('button', { name, exact: true }).first()
            await expect(button).toBeVisible()
            const hit = await button.evaluate((element) => {
                const bounds = element.getBoundingClientRect()
                return element.contains(
                    document.elementFromPoint(
                        bounds.x + bounds.width / 2,
                        bounds.y + bounds.height / 2,
                    ),
                )
            })
            expect(hit).toBe(true)
        }
        await page.mouse.move(0, 0)
        await page.screenshot({
            path: testInfo.outputPath('elevation-management.png'),
            style: '.notification { visibility:hidden }',
        })
    })
}

test('keyboard panning uses the active elevation pane width after resizing the split', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
        window.editorTest.settings.elevationEditorWidth = 20
        window.editorTest.settings.maxScrollX = 20
    })
    await open(page)
    const canvas = await page.locator('.elevation-canvas').boundingBox()
    if (!canvas) throw new Error('Missing elevation canvas')
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 110)
    const initial = await notes(page)
    const before = await page.evaluate(() => ({
        lane: window.editorTest.view.lane,
        time: window.editorTest.view.time,
        width:
            window.elevationTest.scene.elevationLayout.value.width /
            window.elevationTest.scene.elevationLayout.value.laneScale,
    }))
    await page.keyboard.press('ArrowRight')
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.lane))
        .toBeCloseTo(before.lane + before.width * 0.1)
    await page.keyboard.press('ArrowLeft')
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.lane))
        .toBeCloseTo(before.lane)
    expect(await page.evaluate(() => window.editorTest.view.time)).toBe(before.time)
    expect(await notes(page)).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
