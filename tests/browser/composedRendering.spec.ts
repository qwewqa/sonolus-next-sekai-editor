import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = async (page: import('@playwright/test').Page) =>
    page.evaluate(async () => {
        const { clearNotification } = await window.editorTest.appImport<
            typeof import('../../src/editor/notification')
        >('/src/editor/notification.ts')
        clearNotification()
        await document.fonts.ready
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
})

test('composed canvas shows moving stage shapes and keeps projected notes selectable', async ({
    page,
}, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.evaluate(() => {
        const { fixtures, show, settings, view } = window.editorTest
        settings.width = 24
        settings.pps = 80
        settings.showOtherObjects = false
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.events,
                bpms: [{ beat: 0, bpm: 120 }],
                cameraEvents: [],
                timeScales: [],
                stageTransformEvents: fixtures.events.stageTransformEvents.map((event) => ({
                    ...event,
                    xTranslation: 0.75,
                })),
                slides: [
                    [{ ...base, beat: 5, left: 0 }],
                    [
                        { ...base, beat: 2, left: -3 },
                        { ...base, beat: 18, left: 3, flickDirection: 'upRight' },
                    ],
                ],
            },
            5,
        )
        for (const type of Object.keys(view.visibilities)) {
            view.visibilities[type as keyof typeof view.visibilities] =
                type === 'note' || type === 'connector'
        }
        view.layout = 'basic'
        view.laneDivision = 4
    })
    const canvas = page.locator('canvas.editor-chart')
    await settle(page)
    const basic = await canvas.screenshot()
    await page.evaluate(() => {
        window.editorTest.view.layout = 'composed'
    })
    await settle(page)
    await expect.poll(() => page.evaluate(() => window.editorFrames.chart)).toBeGreaterThan(1)
    const composed = await canvas.screenshot({ path: testInfo.outputPath('composed-stages.png') })
    expect(composed.equals(basic)).toBe(false)
    // Reusing the canvas and connector cache must not leave any projected art
    // behind when returning to Basic, even on a dynamic chart.
    await page.evaluate(() => {
        window.editorTest.view.layout = 'basic'
    })
    await settle(page)
    expect((await canvas.screenshot()).equals(basic)).toBe(true)
    await page.evaluate(() => {
        window.editorTest.view.layout = 'composed'
    })
    await settle(page)
    const position = await page.evaluate(async () => {
        const { createComposedLayout } =
            await window.editorTest.appImport<typeof import('../../src/editor/composed')>(
                '/src/editor/composed.ts',
            )
        const note = [...window.editorTest.store.getAllEntities()].find(
            (entity) => entity.type === 'note' && entity.beat === 5,
        )!
        if (note.type !== 'note') throw new Error('Expected note')
        const { left, size } = createComposedLayout(
            window.editorTest.history.state.value,
        ).notePosition(note)
        return window.editorTest.point(left + size / 2, note.beat)
    })
    await page.mouse.click(position.x, position.y)
    await expect
        .poll(() => page.evaluate(() => window.editorTest.snapshot().selected))
        .toEqual([{ type: 'note', beat: 5, left: 0, size: 2 }])
    await settle(page)
    await page.screenshot({ path: testInfo.outputPath('composed-selected.png') })
    expect(errors).toEqual([])
})

test('the composed preference leaves non-dynamic chart pixels unchanged', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.view.layout = 'basic'
    })
    await settle(page)
    const canvas = page.locator('canvas.editor-chart')
    const basic = await canvas.screenshot()
    await page.evaluate(() => {
        window.editorTest.view.layout = 'composed'
    })
    await settle(page)
    expect((await canvas.screenshot()).equals(basic)).toBe(true)
})

test('odd division parity aligns one-lane guides with odd and even note edges', async ({
    page,
}, testInfo) => {
    await page.evaluate(() => {
        const { fixtures, show, settings, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        settings.width = 18
        settings.pps = 120
        settings.showOtherObjects = false
        show(
            {
                ...fixtures.events,
                bpms: [{ beat: 0, bpm: 120 }],
                cameraEvents: [],
                timeScales: [],
                stageTransformEvents: [],
                stageMaskEvents: [
                    {
                        ...fixtures.events.stageMaskEvents[0]!,
                        beat: 0,
                        maskLeft: -4.5,
                        maskSize: 9,
                    },
                ],
                stagePivotEvents: [
                    {
                        ...fixtures.events.stagePivotEvents[0]!,
                        beat: 0,
                        pivotLane: 0,
                        divisionSize: 3,
                        divisionParity: 'odd',
                    },
                ],
                stageStyleEvents: [
                    { ...fixtures.events.stageStyleEvents[0]!, beat: 0, laneAlpha: 1 },
                ],
                slides: [
                    [{ ...base, beat: 2, left: -0.5, size: 1 }],
                    [{ ...base, beat: 4, left: -1.5, size: 2 }],
                    [{ ...base, beat: 6, left: -1.5, size: 3 }],
                ],
            },
            2.5,
        )
        view.layout = 'composed'
        view.laneDivision = 1
        view.cursorTime = 2.3
        for (const type of Object.keys(view.visibilities)) {
            view.visibilities[type as keyof typeof view.visibilities] =
                type === 'note' || type === 'connector'
        }
    })
    await settle(page)
    await page.screenshot({ path: testInfo.outputPath('odd-parity-guides.png') })
    const parity = await page.evaluate(async () => {
        const { createComposedLayout } =
            await window.editorTest.appImport<typeof import('../../src/editor/composed')>(
                '/src/editor/composed.ts',
            )
        const state = window.editorTest.history.state.value
        const layout = createComposedLayout(state)
        return [...window.editorTest.store.getAllEntities()]
            .filter((entity) => entity.type === 'note')
            .map((note) => ({
                size: note.size,
                left: layout.notePosition(note).left - layout.gridOrigin(note.stageId, note.beat),
                right:
                    layout.notePosition(note).left +
                    note.size -
                    layout.gridOrigin(note.stageId, note.beat),
            }))
    })
    expect(parity.map(({ size }) => size).sort()).toEqual([1, 2, 3])
    expect(
        parity.every(({ left, right }) => Number.isInteger(left) && Number.isInteger(right)),
    ).toBe(true)
})

test('projected offscreen badges and selected outlines follow scope and restore Basic positions', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, settings, view, history, store } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        settings.showOtherObjects = false
        show(
            {
                ...fixtures.notes,
                stagePivotEvents: [
                    { ...pivot, stageId: base.stageId, beat: 0, pivotLane: -40 },
                    { ...pivot, stageId: 2 as typeof base.stageId, beat: 0, pivotLane: 40 },
                ],
                slides: [
                    [{ ...base, beat: 3, left: 40 }],
                    [{ ...base, stageId: 2 as typeof base.stageId, beat: 3, left: 0 }],
                ],
            },
            1.5,
        )
        view.layout = 'composed'
        const selected = [...store.getAllEntities()].find(
            (entity) => entity.type === 'note' && entity.left === 40,
        )!
        history.replaceState({ ...history.state.value, selectedEntities: [selected] })
    })
    await settle(page)
    const badges = page.locator('.editor-chart').locator('..').locator('.offscreen-note-indicator')
    await expect(badges).toHaveCount(1)
    await expect(badges).toHaveAttribute('data-side', 'right')
    await expect(badges).toHaveAttribute('data-selectable', '1')
    const visibleSelected = () =>
        page.evaluate(async () => {
            const { visibleSelectedEntities } = await window.editorTest.appImport<
                typeof import('../../src/editor/entities/visible')
            >('/src/editor/entities/visible.ts')
            return visibleSelectedEntities.value.map((entity) =>
                entity.type === 'note' ? entity.left : null,
            )
        })
    expect(await visibleSelected()).toEqual([40])
    await page.evaluate(() => {
        window.editorTest.view.stageId = 1 as import('../../src/chart/stages').StageId
        window.editorTest.settings.showOtherStages = true
    })
    await expect(badges).toHaveAttribute('data-selectable', '0')
    await expect(badges).toHaveCSS('opacity', '0.25')
    await page.evaluate(() => {
        window.editorTest.settings.showOtherStages = false
    })
    await expect(badges).toHaveCount(0)
    expect(await visibleSelected()).toEqual([40])
    await page.evaluate(() => {
        window.editorTest.view.layout = 'basic'
    })
    await settle(page)
    await expect(badges).toHaveCount(1)
    await expect(badges).toHaveAttribute('data-selectable', '1')
    expect(await visibleSelected()).toEqual([])
})

test('engine dynamic stage level renders in the composed editor without browser errors', async ({
    page,
}, testInfo) => {
    const path = process.env.COMPOSED_ENGINE_FIXTURE
    test.skip(!path, 'Set COMPOSED_ENGINE_FIXTURE to an exported engine test level JSON')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const data = JSON.parse(readFileSync(path!, 'utf8')) as { entities: unknown[] }
    await page.evaluate(async (data) => {
        const { parseLevelDataChart } = await window.editorTest.appImport<
            typeof import('../../src/chart/parse/levelData')
        >('/src/chart/parse/levelData/index.ts')
        const { settings, view, show } = window.editorTest
        const chart = parseLevelDataChart(
            data.entities as Parameters<typeof parseLevelDataChart>[0],
        )
        settings.width = 30
        settings.pps = 50
        settings.showOtherObjects = false
        show(chart, 5)
        view.layout = 'composed'
        for (const type of Object.keys(view.visibilities)) {
            view.visibilities[type as keyof typeof view.visibilities] =
                type === 'note' || type === 'connector'
        }
    }, data)
    await settle(page)
    await page.screenshot({ path: testInfo.outputPath('engine-composed.png') })
    expect(errors).toEqual([])
})
