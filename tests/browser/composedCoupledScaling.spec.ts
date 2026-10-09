import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const mode of ['composed-dynamic', 'basic-dynamic', 'composed-static'] as const) {
    for (const grab of ['left', 'right', 'center'] as const) {
        test(`${mode}: ${grab} width grab applies one raw edit to notes and selected stage controls`, async ({
            page,
        }) => {
            await page.evaluate(
                async ({ mode }) => {
                    const { fixtures, show, view, settings, history, appImport } = window.editorTest
                    const note = fixtures.interaction.slides[0]![0]!
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: mode !== 'composed-static',
                            stagePivotEvents: [
                                { ...fixtures.events.stagePivotEvents[0]!, beat: 0, pivotLane: 6 },
                            ],
                            stageTransformEvents: [
                                {
                                    ...fixtures.events.stageTransformEvents[0]!,
                                    beat: 0,
                                    xTranslation: 3,
                                },
                            ],
                            slides: [
                                [{ ...note, beat: 4, left: 0, size: 3 }],
                                [{ ...note, beat: 6, left: 2, size: 1 }],
                            ],
                        },
                        3,
                    )
                    view.layout = mode === 'basic-dynamic' ? 'basic' : 'composed'
                    view.lane = mode === 'composed-dynamic' ? 9 : 0
                    view.laneDivision = 2
                    view.laneSnapping = 'absolute'
                    settings.maxLane = 0
                    const source = history.state.value
                    history.replaceState({
                        ...source,
                        selectedEntities: [
                            ...[...source.store.slides.note.values()].flat(),
                            ...new Set(
                                [...source.store.grid.stagePivotEventJoint.values()].flatMap(
                                    (set) => [...set],
                                ),
                            ),
                            ...new Set(
                                [...source.store.grid.stageTransformEventJoint.values()].flatMap(
                                    (set) => [...set],
                                ),
                            ),
                        ],
                    })
                    const { scaleWidth } = await appImport<
                        typeof import('../../src/editor/commands/scaleSelection')
                    >('/src/editor/commands/scaleSelection/index.ts')
                    void scaleWidth.execute()
                },
                { mode },
            )
            const panel = page.locator('.scaling-panel')
            await expect(panel).toBeVisible()
            const composed = mode === 'composed-dynamic'
            const from = (composed ? 9 : 0) + (grab === 'left' ? 0.1 : grab === 'right' ? 2.9 : 1.5)
            const distance = grab === 'left' ? -3 : grab === 'right' ? 4 : 3
            const points = await page.evaluate(
                ({ from, distance }) => ({
                    from: window.editorTest.point(from, 4),
                    to: window.editorTest.point(from + distance, 4),
                }),
                { from, distance },
            )
            await page.mouse.move(points.from.x, points.from.y)
            await page.mouse.down()
            await page.mouse.move(points.to.x, points.to.y, { steps: 6 })
            await page.mouse.up()
            const actual = await page.evaluate(async () => {
                const { appImport, history } = window.editorTest
                const { getPreviewState } =
                    await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
                const { createComposedLayout } =
                    await appImport<typeof import('../../src/editor/composed')>(
                        '/src/editor/composed.ts',
                    )
                const draft = getPreviewState(history.state.value)
                const notes = [...draft.store.slides.note.values()].flat()
                return {
                    notes: notes.map(({ left, size }) => ({ left, size })),
                    pivot: [...draft.store.grid.stagePivotEventJoint.values()][0]!.values().next()
                        .value!.pivotLane,
                    translation: [...draft.store.grid.stageTransformEventJoint.values()][0]!
                        .values()
                        .next().value!.xTranslation,
                    position: createComposedLayout(draft).notePosition(notes[0]!),
                }
            })
            const delta = composed ? (grab === 'left' ? -2 : 1) : distance
            const anchor = grab === 'left' ? 6 : 0
            const factor = grab === 'center' ? 1 : 1 + delta / ((grab === 'left' ? 0 : 3) - anchor)
            const transform = (value: number) =>
                grab === 'center' ? value + delta : anchor + (value - anchor) * factor
            expect(actual.notes[0]!.left).toBeCloseTo(transform(0), 7)
            expect(actual.notes[0]!.size).toBeCloseTo(3 * factor, 7)
            expect(actual.notes[1]!.left).toBeCloseTo(transform(2), 7)
            expect(actual.notes[1]!.size).toBeCloseTo(factor, 7)
            expect(actual.pivot).toBeCloseTo(transform(6), 7)
            expect(actual.translation).toBeCloseTo(transform(3), 7)
            if (composed) {
                const actualGrab =
                    actual.position.left +
                    (grab === 'right' ? actual.position.size - 0.1 : grab === 'left' ? 0.1 : 1.5)
                expect(actualGrab).toBeCloseTo(from + distance, 7)
            }
            await panel.getByRole('button', { name: 'Apply', exact: true }).click()
            await page.keyboard.press('z')
            expect(
                await page.evaluate(() =>
                    window.editorTest.snapshot().notes.map(({ left, size }) => ({ left, size })),
                ),
            ).toEqual([
                { left: 0, size: 3 },
                { left: 2, size: 1 },
            ])
        })
    }
}

for (const scenario of ['interpolated', 'camera-limit', 'singular', 'attached'] as const) {
    test(`composed coupled width handles ${scenario}`, async ({ page }) => {
        const setup = await page.evaluate(async (scenario) => {
            const { fixtures, show, view, settings, history, appImport } = window.editorTest
            const { ease } = await appImport<typeof import('../../src/ease')>('/src/ease.ts')
            const { createComposedLayout } =
                await appImport<typeof import('../../src/editor/composed')>(
                    '/src/editor/composed.ts',
                )
            const note = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            const overshoot = ease('outBack', 0.5)
            const singular = scenario === 'singular'
            const attached = scenario === 'attached'
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    stagePivotEvents: [
                        {
                            ...pivot,
                            beat: 0,
                            pivotLane: singular ? 2 / (overshoot - 1) : 6,
                            eventEase: singular ? 'outBack' : 'linear',
                        },
                        ...(scenario === 'interpolated' || singular
                            ? [{ ...pivot, beat: 8, pivotLane: singular ? 0 : 2 }]
                            : []),
                    ],
                    stageTransformEvents: [],
                    cameraEvents:
                        scenario === 'camera-limit'
                            ? [
                                  {
                                      ...fixtures.events.cameraEvents[0]!,
                                      beat: 0,
                                      cameraLeft: 0,
                                      cameraSize: 18,
                                  },
                              ]
                            : [],
                    slides: attached
                        ? [
                              [
                                  { ...note, beat: 2, left: 0, size: 8, connectorEase: 'outBack' },
                                  { ...note, beat: 4, left: 0, size: 1, isAttached: true },
                                  { ...note, beat: 6, left: 0, size: 1 },
                              ],
                          ]
                        : [[{ ...note, beat: 4, left: 0, size: singular ? 2 : 3 }]],
                },
                3,
            )
            view.layout = 'composed'
            view.laneDivision = 1
            view.laneSnapping = 'relative'
            settings.maxLane = 0
            const source = history.state.value
            const notes = [...source.store.slides.note.values()].flat()
            const pivots = [
                ...new Set(
                    [...source.store.grid.stagePivotEventJoint.values()].flatMap((set) => [...set]),
                ),
            ].sort((a, b) => a.beat - b.beat)
            history.replaceState({
                ...source,
                selectedEntities: attached
                    ? notes.slice(0, 2)
                    : [
                          notes[0]!,
                          pivots[0]!,
                          ...new Set(
                              [...source.store.grid.cameraEventJoint.values()].flatMap((set) => [
                                  ...set,
                              ]),
                          ),
                      ],
            })
            const position = createComposedLayout(source).notePosition(notes[attached ? 1 : 0]!)
            const from = position.left + (attached ? position.size / 2 : position.size - 0.1)
            view.lane = from
            const { scaleWidth } = await appImport<
                typeof import('../../src/editor/commands/scaleSelection')
            >('/src/editor/commands/scaleSelection/index.ts')
            void scaleWidth.execute()
            return {
                from,
                distance: attached
                    ? (1 - overshoot) * 4
                    : singular
                      ? 2
                      : scenario === 'interpolated'
                        ? 2
                        : 3,
            }
        }, scenario)
        await expect(page.locator('.scaling-panel')).toBeVisible()
        const points = await page.evaluate(
            ({ from, distance }) => ({
                from: window.editorTest.point(from, 4),
                to: window.editorTest.point(from + distance, 4),
            }),
            setup,
        )
        await page.mouse.move(points.from.x, points.from.y)
        await page.mouse.down()
        await page.mouse.move(points.to.x, points.to.y, { steps: 4 })
        await page.mouse.up()
        const actual = await page.evaluate(async () => {
            const { appImport, history } = window.editorTest
            const { getPreviewState } =
                await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
            const draft = getPreviewState(history.state.value)
            return {
                identical: draft === history.state.value,
                notes: [...draft.store.slides.note.values()]
                    .flat()
                    .map(({ left, size }) => ({ left, size })),
                cameras: [
                    ...new Set(
                        [...draft.store.grid.cameraEventJoint.values()].flatMap((set) => [...set]),
                    ),
                ].map(({ cameraSize }) => cameraSize),
            }
        })
        if (scenario === 'singular') expect(actual.identical).toBe(true)
        else if (scenario === 'attached') expect(actual.notes[0]!.left).toBeCloseTo(4, 7)
        else expect(actual.notes[0]!.size).toBeCloseTo(4, 7)
        if (scenario === 'camera-limit') expect(actual.cameras).toEqual([24])
    })
}
