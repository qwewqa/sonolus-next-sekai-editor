import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const mode of ['endpoint', 'body', 'mixed-stage'] as const)
    test(`Scale Elevation follows a same-beat attached ${mode} handle and preserves raw edits`, async ({
        page,
    }) => {
        await page.evaluate(async (mode) => {
            const { fixtures, show, history, settings, appImport } = window.editorTest
            const note = fixtures.interaction.slides[0]![0]!
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    stageTransformEvents: [
                        {
                            ...fixtures.events.stageTransformEvents[0]!,
                            stageId: 2 as never,
                            beat: 0,
                            elevation: 4,
                        },
                    ],
                    slides: [
                        [
                            {
                                ...note,
                                beat: 2,
                                left: -3,
                                size: 1,
                                elevation: 0,
                                connectorEase: 'inQuad',
                            },
                            { ...note, beat: 2, left: 99, size: 1, elevation: 1, isAttached: true },
                            {
                                ...note,
                                stageId: 2 as never,
                                beat: 2,
                                left: 3,
                                size: 1,
                                elevation: 4,
                            },
                        ],
                    ],
                },
                2,
            )
            settings.maxLane = 0
            Object.assign(settings, { elevationSnap: 0 })
            settings.elevationEditorSideBySide = 'allow'
            const source = history.state.value
            const notes = [...source.store.slides.note.values()].flat()
            const controls = [
                ...new Set(
                    [...source.store.grid.stageTransformEventJoint.values()].flatMap((set) => [
                        ...set,
                    ]),
                ),
            ]
            history.replaceState({
                ...source,
                selectedEntities:
                    mode === 'body'
                        ? notes
                        : mode === 'mixed-stage'
                          ? [...notes.slice(0, 2), ...controls]
                          : notes.slice(0, 2),
            })
            const { openElevationEditor } = await appImport<
                typeof import('../../src/editor/elevation/state')
            >('/src/editor/elevation/state.ts')
            const { elevationViewport } = await appImport<
                typeof import('../../src/editor/elevation/viewport')
            >('/src/editor/elevation/viewport.ts')
            elevationViewport.center = 3
            elevationViewport.scale = 40
            openElevationEditor(2)
        }, mode)
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        const points = await page.evaluate(async (mode) => {
            const { appImport } = window.editorTest
            const { elevationLayout } = await appImport<
                typeof import('../../src/editor/elevation/scene')
            >('/src/editor/elevation/scene.ts')
            const { elevationBounds } = await appImport<
                typeof import('../../src/editor/elevation/viewport')
            >('/src/editor/elevation/viewport.ts')
            const layout = elevationLayout.value
            const row = layout.rows.find((row) => row.note.isAttached)!
            const target = mode === 'endpoint' ? 4 : mode === 'body' ? 3 : 11 / 3
            return {
                from: { x: elevationBounds.x + row.x, y: elevationBounds.y + row.y },
                to: { x: elevationBounds.x + row.x, y: elevationBounds.y + layout.yAt(target) },
                target,
            }
        }, mode)
        await page.mouse.move(points.from.x, points.from.y)
        await page.evaluate(async () => {
            const { appImport } = window.editorTest
            const { scaleElevation } = await appImport<
                typeof import('../../src/editor/commands/scaleSelection')
            >('/src/editor/commands/scaleSelection/index.ts')
            void scaleElevation.execute()
        })
        const panel = page.locator('.scaling-panel')
        await expect(panel).toBeVisible()
        const drag = async () => {
            await page.mouse.move(points.from.x, points.from.y)
            await page.mouse.down()
            await page.mouse.move(points.to.x, points.to.y, { steps: 6 })
            await page.mouse.up()
        }
        const summary = () =>
            page.evaluate(async () => {
                const { history, appImport } = window.editorTest
                const { getPreviewState } =
                    await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
                const { elevationNotes } = await appImport<
                    typeof import('../../src/editor/elevation/scene')
                >('/src/editor/elevation/scene.ts')
                const { scalingSession } = await appImport<
                    typeof import('../../src/editor/commands/scaleSelection/session')
                >('/src/editor/commands/scaleSelection/session.ts')
                const draft = getPreviewState(history.state.value)
                return {
                    raw: [...draft.store.slides.note.values()].flat().map((note) => note.elevation),
                    stored: [...history.state.value.store.slides.note.values()]
                        .flat()
                        .map((note) => note.elevation),
                    displayed: elevationNotes.value.find((row) => row.note.isAttached)!.elevation,
                    factor: scalingSession.value?.factor,
                    stage: [...draft.store.grid.stageTransformEventJoint.values()][0]!
                        .values()
                        .next().value!.elevation,
                }
            })
        await drag()
        const preview = await summary()
        const expected = mode === 'endpoint' ? [0, 2, 4] : mode === 'body' ? [1, 2, 5] : [1, 2, 4]
        // Real pointer coordinates are rounded to browser subpixels.
        preview.raw.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 2))
        expect(preview.stored).toEqual([0, 1, 4])
        expect(preview.displayed).toBeCloseTo(points.target, 2)
        expect(preview.factor).toBeCloseTo(mode === 'endpoint' ? 2 : 1, 2)
        expect(preview.stage).toBeCloseTo(mode === 'mixed-stage' ? 5 : 4, 2)
        await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
        expect((await summary()).stored).toEqual([0, 1, 4])
        await page.mouse.move(points.from.x, points.from.y)
        await page.evaluate(async () => {
            const { scaleElevation } = await window.editorTest.appImport<
                typeof import('../../src/editor/commands/scaleSelection')
            >('/src/editor/commands/scaleSelection/index.ts')
            void scaleElevation.execute()
        })
        await expect(panel).toBeVisible()
        await drag()
        await panel.getByRole('button', { name: 'Apply', exact: true }).click()
        expect((await summary()).stored).toEqual(preview.raw)
        await page.evaluate(async () => {
            const { undoState } =
                await window.editorTest.appImport<typeof import('../../src/history')>(
                    '/src/history/index.ts',
                )
            undoState()
        })
        expect((await summary()).stored).toEqual([0, 1, 4])
    })
