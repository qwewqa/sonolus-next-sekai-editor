import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

test.use({ hasTouch: true })

declare global {
    interface Window {
        widthTest: {
            source: (typeof import('../../src/history'))['state']['value']
            preview: typeof import('../../src/preview/edit')
            scene: typeof import('../../src/editor/elevation/scene')
        }
    }
}

const panel = (page: Page) => page.locator('.scaling-panel')
const factor = (page: Page) => panel(page).getByRole('spinbutton', { name: 'Scale Factor' })
const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const snapshot = (page: Page) =>
    page.evaluate(() => {
        const current = window.editorTest.history.state.value
        const draft = window.widthTest.preview.getPreviewState(current)
        const notes = (state: typeof current) =>
            [...state.store.slides.note.values()].flat().map(({ left, size, beat, elevation }) => ({
                left,
                size,
                beat,
                elevation,
            }))
        return {
            stored: notes(current),
            draft: notes(draft),
            sourceUnchanged: current === window.widthTest.source,
            canUndo: window.editorTest.history.canUndo.value,
            dirty: window.editorTest.history.isDirty.value,
        }
    })
const seed = async (page: Page, single = false) => {
    await page.evaluate(async (single) => {
        const { fixtures, show, history, settings } = window.editorTest
        settings.mouseSecondaryTool = 'selectContextMenu'
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [{ ...base, beat: 3, left: -4, size: 2, elevation: 1 }],
                    [{ ...base, beat: 3, left: 0, size: 2, elevation: 3 }],
                    [{ ...base, beat: 8, left: 4, size: 2, elevation: 4 }],
                ],
            },
            3,
        )
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()]
                .flat()
                .slice(0, single ? 1 : 2),
        })
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        window.widthTest = {
            source: history.state.value,
            preview: await import(urls.get('/src/preview/edit.ts') ?? '/src/preview/edit.ts'),
            scene: await import(
                urls.get('/src/editor/elevation/scene.ts') ?? '/src/editor/elevation/scene.ts'
            ),
        }
    }, single)
    await settle(page)
}
const point = async (page: Page, lane: number, elevation = false) => {
    if (!elevation) return page.evaluate((lane) => window.editorTest.point(lane, 3), lane)
    const local = await page.evaluate((lane) => {
        const layout = window.widthTest.scene.elevationLayout.value
        return { x: layout.xAt(lane), y: layout.yAt(3) }
    }, lane)
    const bounds = await page.locator('.elevation-canvas').boundingBox()
    if (!bounds) throw new Error('Missing elevation canvas')
    return { x: bounds.x + local.x, y: bounds.y + local.y }
}
const open = async (page: Page, elevation = false) => {
    const hit = await point(page, elevation ? 1 : -3, elevation)
    await page.mouse.click(hit.x, hit.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Scale Width', exact: true }).click()
    await expect(panel(page)).toBeVisible()
    await settle(page)
}
const drag = async (page: Page, from: number, to: number, elevation = false) => {
    const start = await point(page, from, elevation)
    const end = await point(page, to, elevation)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()
    await settle(page)
}
const expectWidths = async (page: Page, values: [number, number][]) => {
    const current = await snapshot(page)
    expect(current.draft).toHaveLength(values.length)
    for (const [index, [left, size]] of values.entries()) {
        expect(current.draft[index]!.left).toBeCloseTo(left, 7)
        expect(current.draft[index]!.size).toBeCloseTo(size, 7)
    }
    expect(current.sourceUnchanged).toBe(true)
    expect(current.canUndo).toBe(false)
}

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await seed(page)
})

test('width factor previews positions and sizes, Apply creates one undo', async ({ page }) => {
    await open(page)
    await expect(factor(page)).toHaveAttribute('step', '0.1')
    await factor(page).fill('1.5')
    await settle(page)
    await expectWidths(page, [
        [-4, 3],
        [2, 3],
        [4, 2],
    ])
    const draft = await snapshot(page)
    expect(draft.draft.map(({ beat, elevation }) => [beat, elevation])).toEqual([
        [3, 1],
        [3, 3],
        [8, 4],
    ])
    expect(draft.dirty).toBe(false)
    await factor(page).press('Enter')
    expect((await snapshot(page)).stored.map(({ left, size }) => [left, size])).toEqual([
        [-4, 3],
        [2, 3],
        [4, 2],
    ])
    await page.keyboard.press('z')
    expect((await snapshot(page)).stored.map(({ left, size }) => [left, size])).toEqual([
        [-4, 2],
        [0, 2],
        [4, 2],
    ])
    expect((await snapshot(page)).canUndo).toBe(false)
})

test('left and right edges anchor the opposite selection boundary', async ({ page }) => {
    await open(page)
    await drag(page, 2, 5)
    await expectWidths(page, [
        [-4, 3],
        [2, 3],
        [4, 2],
    ])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await open(page)
    // Grab just inside the edge: the exact boundary pixel can round outside the note.
    await drag(page, -3.95, -6.95)
    await expectWidths(page, [
        [-7, 3],
        [-1, 3],
        [4, 2],
    ])
    await expect(factor(page)).toHaveValue('1.5')
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot(page)).sourceUnchanged).toBe(true)
})

test('middle drag moves the entire selection and respects lane snapping', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.view.laneDivision = 4
        window.editorTest.view.laneSnapping = 'absolute'
    })
    await open(page)
    await drag(page, -3, -2.63)
    await expectWidths(page, [
        [-3.75, 2],
        [0.25, 2],
        [4, 2],
    ])
    await expect(factor(page)).toHaveValue('1')
    await page.keyboard.press('Escape')
    expect((await snapshot(page)).sourceUnchanged).toBe(true)
    expect((await snapshot(page)).dirty).toBe(false)
})

test('crossing an anchored edge preserves the last valid factor and finite draft', async ({
    page,
}) => {
    await open(page)
    const start = await point(page, 2)
    const valid = await point(page, 5)
    const crossed = await point(page, -5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(valid.x, valid.y)
    await settle(page)
    await expect(factor(page)).toHaveValue('1.5')
    await page.mouse.move(crossed.x, crossed.y)
    await settle(page)
    await expect(factor(page)).toHaveValue('1.5')
    await expectWidths(page, [
        [-4, 3],
        [2, 3],
        [4, 2],
    ])
    await page.mouse.up()
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('a single note with width can scale and invalid numeric factors are cancellable', async ({
    page,
}) => {
    await seed(page, true)
    await open(page)
    await factor(page).fill('2')
    await settle(page)
    await expectWidths(page, [
        [-4, 4],
        [0, 2],
        [4, 2],
    ])
    await factor(page).fill('0')
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    await expectWidths(page, [
        [-4, 4],
        [0, 2],
        [4, 2],
    ])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot(page)).sourceUnchanged).toBe(true)
})

test('touch width scaling in the elevation pane previews and cancelled gestures restore', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.elevationEditorSideBySide = 'allow'
    })
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await open(page, true)
    await expect(page.locator('.elevation-editor .scaling-panel')).toBeVisible()
    const start = await point(page, 2, true)
    const end = await point(page, 5, true)
    const touch = (type: string, position: { x: number; y: number }) =>
        page.evaluate(
            ({ type, position }) => {
                const target = document.querySelector('.elevation-canvas')!
                target.dispatchEvent(
                    new TouchEvent(type, {
                        changedTouches: [
                            new Touch({
                                identifier: 19,
                                target,
                                clientX: position.x,
                                clientY: position.y,
                            }),
                        ],
                        bubbles: true,
                        cancelable: true,
                    }),
                )
            },
            { type, position },
        )
    await touch('touchstart', start)
    await touch('touchmove', end)
    await settle(page)
    await expectWidths(page, [
        [-4, 3],
        [2, 3],
        [4, 2],
    ])
    await touch('touchcancel', end)
    await settle(page)
    await expectWidths(page, [
        [-4, 2],
        [0, 2],
        [4, 2],
    ])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('width controls fit a narrow phone', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await seed(page)
    await page.evaluate(() => {
        window.editorTest.view.time = 1.5
    })
    await open(page)
    const bounds = await panel(page).boundingBox()
    if (!bounds) throw new Error('Missing scale controls')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(568)
    await expect(factor(page)).toBeInViewport()
    await expect(panel(page).getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
    await page.screenshot({
        path: testInfo.outputPath('phone-width-scaling.png'),
        style: '.notification { visibility: hidden }',
    })
})

test('size-one notes keep a movable middle and separate resize edges', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [[{ ...base, beat: 3, left: -4, size: 1, elevation: 1 }]],
            },
            3,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        window.widthTest.source = history.state.value
    })
    await settle(page)
    const start = await point(page, -3.5)
    await page.mouse.click(start.x, start.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Scale Width', exact: true }).click()
    await drag(page, -3.5, -2.5)
    await expectWidths(page, [[-3, 1]])
    await drag(page, -2, -1)
    await expectWidths(page, [[-3, 2]])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('dragging a selected point event translates notes without changing widths', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        const note = fixtures.interaction.slides[0]![0]!
        const event = fixtures.events.timeScales[0]!
        show(
            {
                ...fixtures.interaction,
                slides: [[{ ...note, beat: 3, left: -4, size: 2 }]],
                timeScales: [{ ...event, beat: 3, editorLane: 4 }],
            },
            3,
        )
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()].flat(),
        })
        history.replaceState({
            ...history.state.value,
            selectedEntities: [
                ...history.state.value.selectedEntities,
                ...[...source.store.grid.timeScale.values()].flatMap((bucket) => [...bucket]),
            ],
        })
        window.widthTest.source = history.state.value
    })
    await settle(page)
    await open(page)
    await drag(page, 4, 5)
    await expectWidths(page, [[-3, 2]])
    const values = await page.evaluate(() =>
        [
            ...window.widthTest.preview
                .getPreviewState(window.editorTest.history.state.value)
                .store.grid.timeScale.values(),
        ]
            .flatMap((bucket) => [...bucket])
            .map(({ editorLane }) => editorLane),
    )
    expect(values).toEqual([5])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('camera width limits reject invalid factors without destroying the valid preview', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                slides: [],
                cameraEvents: [{ ...fixtures.events.cameraEvents[0]!, beat: 3 }],
            },
            3,
        )
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.grid.cameraEventJoint.values()].flatMap((bucket) => [
                ...bucket,
            ]),
        })
        window.widthTest.source = history.state.value
    })
    await settle(page)
    await open(page)
    await factor(page).fill('0.5')
    await settle(page)
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
    await factor(page).fill('0.4')
    await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    const widths = await page.evaluate(() =>
        [
            ...window.widthTest.preview
                .getPreviewState(window.editorTest.history.state.value)
                .store.grid.cameraEventJoint.values(),
        ]
            .flatMap((bucket) => [...bucket])
            .map(({ cameraSize }) => cameraSize),
    )
    expect(widths).toEqual([6])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot(page)).sourceUnchanged).toBe(true)
})

test('elevation width drags use the visible note bounds after stage pivots', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show, history, settings } = window.editorTest
        const note = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        settings.elevationEditorSideBySide = 'allow'
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [[{ ...note, beat: 3, left: -4, size: 2, elevation: 3 }]],
                stagePivotEvents: [{ ...pivot, stageId: note.stageId, beat: 0, pivotLane: 5 }],
            },
            3,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        window.widthTest.source = history.state.value
    })
    await settle(page)
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    const hit = await point(page, 2, true)
    await page.mouse.click(hit.x, hit.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Scale Width', exact: true }).click()
    await drag(page, 2, 3, true)
    await expectWidths(page, [[-3, 2]])
    await expect(factor(page)).toHaveValue('1')
    await drag(page, 4, 5, true)
    await expectWidths(page, [[-3, 3]])
    await expect(factor(page)).toHaveValue('1.5')
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('an attached interior moves selected endpoints while keeping its attachment', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history, settings } = window.editorTest
        const note = fixtures.interaction.slides[0]![0]!
        settings.elevationEditorSideBySide = 'allow'
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...note, beat: 3, left: -4, size: 2, elevation: 1 },
                        { ...note, beat: 3, left: 0, size: 2, elevation: 3, isAttached: true },
                        { ...note, beat: 3, left: 4, size: 2, elevation: 5 },
                    ],
                ],
            },
            3,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        window.widthTest.source = history.state.value
    })
    await settle(page)
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await open(page, true)
    await drag(page, 1, 2, true)
    await expectWidths(page, [
        [-3, 2],
        [1, 2],
        [5, 2],
    ])
    await expect(factor(page)).toHaveValue('1')
    expect(
        await page.evaluate(() =>
            window.widthTest.preview
                .getPreviewState(window.editorTest.history.state.value)
                .selectedEntities.filter((entity) => entity.type === 'note')
                .map((note) => note.isAttached),
        ),
    ).toEqual([false, true, false])
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('the separate transform group remains reachable on a short portrait phone', async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 480 })
    await settle(page)
    await page.getByTitle('Flip Horizontally', { exact: true }).tap()
    for (const title of [
        'Flip Horizontally',
        'Flip Vertically',
        'Scale Width',
        'Scale Beats',
        'Scale Elevations',
        'Make Vertical',
        'Combine into Slide',
        'Split Slide',
    ]) {
        const expanded = page.getByTitle(title, { exact: true }).filter({ hasText: title })
        await expanded.scrollIntoViewIfNeeded()
        await expect(expanded).toBeInViewport()
    }
    const menu = page
        .getByTitle('Scale Width', { exact: true })
        .filter({ hasText: 'Scale Width' })
        .locator('..')
    const bounds = await menu.boundingBox()
    // The menu stays below the top panel dock, which holds the Preview tab.
    const preview = await page.locator('[data-workspace-dock="top"]').boundingBox()
    expect(bounds).not.toBeNull()
    expect(preview).not.toBeNull()
    expect(bounds!.y).toBeGreaterThanOrEqual(preview!.y + preview!.height)
    await menu.screenshot({ path: 'test-results/scale-width-mobile-toolbar.png' })
})
