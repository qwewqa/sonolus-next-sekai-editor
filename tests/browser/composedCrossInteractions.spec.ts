import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

for (const mode of ['basic-dynamic', 'composed-dynamic', 'composed-static'] as const) {
    for (const pane of ['main', 'elevation'] as const) {
        for (const axis of ['width', 'beat'] as const) {
            test(`${mode} ${pane} ${axis}: numeric scaling keeps its coordinate space when hovering the other pane`, async ({
                page,
            }) => {
                await page.addInitScript(installCanvasCounters)
                await page.goto('/')
                await expect(page.locator('canvas.editor-chart')).toBeVisible()
                await page.evaluate(installEditorFixture)
                await page.evaluate(
                    async ({ mode, axis }) => {
                        const { fixtures, show, view, settings, history, appImport } =
                            window.editorTest
                        const base = fixtures.interaction.slides[0]![0]!
                        const pivot = fixtures.events.stagePivotEvents[0]!
                        show(
                            {
                                ...fixtures.interaction,
                                isDynamicStages: mode !== 'composed-static',
                                stagePivotEvents: [
                                    { ...pivot, stageId: base.stageId, beat: 0, pivotLane: 4 },
                                    { ...pivot, stageId: base.stageId, beat: 12, pivotLane: 10 },
                                    {
                                        ...pivot,
                                        stageId: 2 as typeof base.stageId,
                                        beat: 0,
                                        pivotLane: -4,
                                    },
                                ],
                                slides: [
                                    [{ ...base, beat: 4, left: 0, size: 2 }],
                                    [
                                        {
                                            ...base,
                                            stageId: 2 as typeof base.stageId,
                                            beat: axis === 'beat' ? 6 : 4,
                                            left: 0,
                                            size: 2,
                                        },
                                    ],
                                ],
                            },
                            2,
                        )
                        view.layout = mode === 'basic-dynamic' ? 'basic' : 'composed'
                        settings.maxLane = 0
                        settings.elevationEditorSideBySide = 'allow'
                        history.replaceState({
                            ...history.state.value,
                            selectedEntities: [
                                ...history.state.value.store.slides.note.values(),
                            ].flat(),
                        })
                        const elevation = await appImport<
                            typeof import('../../src/editor/elevation/state')
                        >('/src/editor/elevation/state.ts')
                        elevation.openElevationEditor(4)
                    },
                    { mode, axis },
                )
                await expect(page.locator('.elevation-canvas')).toBeVisible()
                const original = await page.evaluate(() => window.editorTest.snapshot().notes)
                await page.evaluate(
                    async ({ pane, axis }) => {
                        const { appImport } = window.editorTest
                        const { activateEditorNavigation } = await appImport<
                            typeof import('../../src/editor/controls')
                        >('/src/editor/controls/index.ts')
                        if (pane === 'main') activateEditorNavigation()
                        const { scaleWidth, scaleBeat } = await appImport<
                            typeof import('../../src/editor/commands/scaleSelection')
                        >('/src/editor/commands/scaleSelection/index.ts')
                        void (axis === 'width' ? scaleWidth : scaleBeat).execute()
                    },
                    { pane, axis },
                )
                const input = page.locator('.scaling-panel input')
                await input.fill('3')
                const snapshot = () =>
                    page.evaluate(async () => {
                        const { history, appImport } = window.editorTest
                        const { getPreviewState } =
                            await appImport<typeof import('../../src/preview/edit')>(
                                '/src/preview/edit.ts',
                            )
                        return [...getPreviewState(history.state.value).store.slides.note.values()]
                            .flat()
                            .map(({ left, size, beat }) => ({ left, size, beat }))
                    })
                const expected = await snapshot()
                await input.fill('2')
                const elevationBounds = await page
                    .locator(pane === 'main' ? '.elevation-canvas' : 'canvas.editor-chart')
                    .boundingBox()
                if (!elevationBounds) throw new Error('Missing elevation canvas')
                await page.mouse.move(
                    elevationBounds.x + elevationBounds.width / 2,
                    elevationBounds.y + 200,
                )
                await expect(input).toBeFocused()
                await page.keyboard.press('Control+A')
                await page.keyboard.type('3')
                expect(await snapshot()).toEqual(expected)
                expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(
                    false,
                )
                await page
                    .locator('.scaling-panel')
                    .getByRole('button', { name: 'Cancel', exact: true })
                    .click()
                expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(
                    original,
                )
                expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(
                    false,
                )
                if (mode === 'composed-dynamic' && axis === 'width') {
                    // Drag in the opposite pane, then resume numeric editing. Change navigation
                    // before reading the draft to also cover deferred preview computation.
                    const elevation = await page.locator('.elevation-canvas').boundingBox()
                    if (!elevation) throw new Error('Missing elevation canvas')
                    await page.mouse.move(elevation.x + elevation.width / 2, elevation.y + 200)
                    const dragged = await page.evaluate(async (pane) => {
                        const { appImport, history } = window.editorTest
                        const { editorNavigation } = await appImport<
                            typeof import('../../src/editor/navigation')
                        >('/src/editor/navigation.ts')
                        const session = await appImport<
                            typeof import('../../src/editor/commands/scaleSelection/session')
                        >('/src/editor/commands/scaleSelection/session.ts')
                        const { getPreviewState } =
                            await appImport<typeof import('../../src/preview/edit')>(
                                '/src/preview/edit.ts',
                            )
                        const elevationNavigation = editorNavigation.value
                        const numericNavigation = pane === 'main' ? undefined : elevationNavigation
                        const dragNavigation = pane === 'main' ? elevationNavigation : undefined
                        const source = history.state.value
                        const notes = () =>
                            [
                                ...getPreviewState(history.state.value).store.slides.note.values(),
                            ].flat()
                        editorNavigation.value = numericNavigation
                        session.beginScalingSession('width')
                        session.setScalingFactor(2)
                        const target = notes()[0]!
                        editorNavigation.value = dragNavigation
                        const began = session.beginScalingDrag(target, 0, 'max')
                        session.updateScalingDrag(3.5)
                        editorNavigation.value = numericNavigation
                        const draft = notes().map(({ left, size }) => ({ left, size }))
                        session.endScalingDrag()
                        editorNavigation.value = dragNavigation
                        session.setScalingFactor(5)
                        const numeric = notes().map(({ left, size }) => ({ left, size }))
                        session.applyScalingSession()
                        const canUndo = history.canUndo.value
                        history.undoState()
                        return {
                            began,
                            draft,
                            numeric,
                            canUndo,
                            restored: history.state.value.store === source.store,
                            moreUndo: history.canUndo.value,
                        }
                    }, pane)
                    expect(dragged).toEqual({
                        began: true,
                        draft: [
                            { left: 0, size: 7.5 },
                            { left: 0, size: 7.5 },
                        ],
                        numeric: [
                            { left: 0, size: 10 },
                            { left: 0, size: 10 },
                        ],
                        canUndo: true,
                        restored: true,
                        moreUndo: false,
                    })
                }
            })
        }
    }
}
