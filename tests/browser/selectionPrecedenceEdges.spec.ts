import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.waitForFunction(() => window.editorTest.view.w > 0)
})

for (const layout of ['basic', 'composed'] as const) {
    for (const minimumWidth of [0.5, 1.5]) {
        test(`${layout} width ${minimumWidth}: direct zero-width note suppresses padded note before stable category ordering`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ layout, minimumWidth }) => {
                    const { fixtures, show, view, settings, appImport } = window.editorTest
                    const note = fixtures.interaction.slides[0]![0]!
                    const padding = (5 * settings.width) / view.w
                    const paddedCenter = minimumWidth / 2 + padding
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: true,
                            cameraEvents: [],
                            stageMaskEvents: [],
                            stageStyleEvents: [],
                            stageTransformEvents: [],
                            timeScales: [],
                            stagePivotEvents: [
                                {
                                    ...fixtures.events.stagePivotEvents[0]!,
                                    beat: 4,
                                    pivotLane: 0,
                                    yOffset: 0,
                                },
                            ],
                            slides: [
                                [
                                    {
                                        ...note,
                                        beat: 4,
                                        left: paddedCenter - 0.1,
                                        size: 0.2,
                                        noteStyle: 'red',
                                        stageId: 1 as typeof note.stageId,
                                    },
                                ],
                                [
                                    {
                                        ...note,
                                        beat: 4,
                                        left: 0,
                                        size: 0,
                                        noteStyle: 'blue',
                                        stageId: 2 as typeof note.stageId,
                                    },
                                ],
                            ],
                        },
                        2,
                    )
                    view.layout = layout
                    const hits = await appImport<typeof import('../../src/editor/tools/utils')>(
                        '/src/editor/tools/utils.ts',
                    )
                    const at = window.editorTest.point(0, 4)
                    const describe = () =>
                        hits
                            .hitAllEntitiesAtPoint(at.x, at.y, minimumWidth)
                            .map((entity) =>
                                entity.type === 'note' ? `note:${entity.noteStyle}` : entity.type,
                            )
                    const direct = describe()
                    view.stageVisibility = new Map([
                        [2 as NonNullable<typeof view.stageId>, 'hidden'],
                    ])
                    const hidden = describe()
                    view.stageVisibility = new Map()
                    view.stageId = 1 as NonNullable<typeof view.stageId>
                    const dimmed = describe()
                    view.stageId = undefined
                    view.visibilities = { ...view.visibilities, note: false }
                    const typeHidden = describe()
                    return { direct, hidden, dimmed, typeHidden }
                },
                { layout, minimumWidth },
            )
            expect(result.direct).toEqual(['note:blue', 'stagePivotEventJoint'])
            expect(result.hidden).toEqual(['note:red', 'stagePivotEventJoint'])
            expect(result.dimmed).toEqual(result.hidden)
            expect(result.typeHidden).toEqual(['stagePivotEventJoint'])
        })
    }
}
