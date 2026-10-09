import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const direction of [-1, 1]) {
    for (const connectorEase of ['inQuad', 'outQuad', 'none', 'inOutStep'] as const) {
        test(`${connectorEase} eases same-beat connectors over ${direction > 0 ? 'ascending' : 'descending'} elevation`, async ({
            page,
        }) => {
            await page.evaluate(
                ({ direction, connectorEase }) => {
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
                                        left: -4,
                                        size: 1,
                                        elevation: direction > 0 ? 0 : 4,
                                        connectorEase,
                                    },
                                    {
                                        ...base,
                                        beat: 6,
                                        left: 4,
                                        size: 1,
                                        elevation: direction > 0 ? 4 : 0,
                                    },
                                ],
                            ],
                        },
                        3,
                    )
                    view.cursorTime = 3
                },
                { direction, connectorEase },
            )
            await page.keyboard.press('t')
            await expect(page.locator('.elevation-canvas')).toBeVisible()
            const sample = async () =>
                page.evaluate(
                    async ({ connectorEase }) => {
                        const { appImport, nextTick } = window.editorTest
                        const { elevationLayout } = await appImport<
                            typeof import('../../src/editor/elevation/scene')
                        >('/src/editor/elevation/scene.ts')
                        await nextTick()
                        await new Promise<void>((resolve) =>
                            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                        )
                        const canvas =
                            document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
                        const layout = elevationLayout.value
                        const [head, tail] = [...layout.rows].sort((a, b) => a.order - b.order)
                        const u = connectorEase === 'inOutStep' ? 0.25 : 0.5
                        const q =
                            connectorEase === 'inQuad'
                                ? 0.25
                                : connectorEase === 'outQuad'
                                  ? 0.75
                                  : 0
                        const x = head!.x + (tail!.x - head!.x) * q
                        const y = head!.y + (tail!.y - head!.y) * u
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
                    },
                    { connectorEase },
                )
            const filled = await sample()
            await page.evaluate(() => {
                window.editorTest.view.visibilities = {
                    ...window.editorTest.view.visibilities,
                    connector: false,
                }
            })
            const empty = await sample()
            expect(filled).not.toEqual(empty)
            expect(filled[3]).toBeGreaterThan(empty[3]!)
        })
    }
}

for (const separator of [false, true]) {
    test(`stored attached elevation follows the parent curve${separator ? ' across separator slices' : ''}`, async ({
        page,
    }) => {
        await page.evaluate((separator) => {
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
                                left: -4,
                                size: 1,
                                elevation: 0,
                                connectorEase: 'inQuad',
                            },
                            {
                                ...base,
                                beat: 6,
                                left: 10,
                                size: 1,
                                elevation: 1,
                                isAttached: true,
                                isConnectorSeparator: separator,
                            },
                            { ...base, beat: 6, left: 4, size: 1, elevation: 4 },
                        ],
                    ],
                },
                3,
            )
            view.cursorTime = 3
        }, separator)
        await page.keyboard.press('t')
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        const sample = async () =>
            page.evaluate(async () => {
                const { appImport, nextTick } = window.editorTest
                const { elevationLayout } = await appImport<
                    typeof import('../../src/editor/elevation/scene')
                >('/src/editor/elevation/scene.ts')
                await nextTick()
                await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                )
                const layout = elevationLayout.value
                const rows = [...layout.rows].sort((a, b) => a.order - b.order)
                const [head, , tail] = rows
                const x = head!.x + (tail!.x - head!.x) * 0.625 ** 2
                const y = head!.y + (tail!.y - head!.y) * 0.625
                const canvas = document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
                return {
                    attached: {
                        elevation: rows[1]!.elevation,
                        lane: rows[1]!.lane,
                        rawLeft: rows[1]!.note.left,
                    },
                    pixel: [
                        ...canvas
                            .getContext('2d')!
                            .getImageData(
                                Math.round((x * canvas.width) / layout.width),
                                Math.round((y * canvas.height) / layout.height),
                                1,
                                1,
                            ).data,
                    ],
                }
            })
        const filled = await sample()
        expect(filled.attached).toEqual({ elevation: 1, lane: -3, rawLeft: -3.5 })
        await page.evaluate(() => {
            window.editorTest.view.visibilities = {
                ...window.editorTest.view.visibilities,
                connector: false,
            }
        })
        const empty = await sample()
        expect(filled.pixel).not.toEqual(empty.pixel)
        expect(filled.pixel[3]).toBeGreaterThan(empty.pixel[3]!)
    })
}

test('a same-beat piece of a time-based attachment eases over its displayed elevation', async ({
    page,
}) => {
    await page.evaluate(() => {
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
                            left: -4,
                            size: 1,
                            elevation: 0,
                            connectorEase: 'outStep',
                        },
                        {
                            ...base,
                            beat: 6,
                            left: 10,
                            size: 1,
                            elevation: 1,
                            isAttached: true,
                            isConnectorSeparator: true,
                        },
                        { ...base, beat: 8, left: 4, size: 1, elevation: 4 },
                    ],
                ],
            },
            3,
        )
        view.cursorTime = 3
    })
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    const sample = async () =>
        page.evaluate(async () => {
            const { appImport, nextTick } = window.editorTest
            const { elevationLayout } = await appImport<
                typeof import('../../src/editor/elevation/scene')
            >('/src/editor/elevation/scene.ts')
            await nextTick()
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
            const layout = elevationLayout.value
            const [head, tail] = [...layout.rows].sort((a, b) => a.order - b.order)
            const canvas = document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
            return [
                ...canvas
                    .getContext('2d')!
                    .getImageData(
                        Math.round((tail!.x * canvas.width) / layout.width),
                        Math.round((((head!.y + tail!.y) / 2) * canvas.height) / layout.height),
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
    const empty = await sample()
    expect(filled).not.toEqual(empty)
    expect(filled[3]).toBeGreaterThan(empty[3]!)
})
