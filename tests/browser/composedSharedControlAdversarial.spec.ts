import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.waitForFunction(() => window.editorTest.view.w > 0 && window.editorTest.view.h > 0)
    await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
})

for (const scenario of ['pivot', 'pivot and translation', 'partial pivot'] as const) {
    for (const gesture of ['move', 'width'] as const) {
        test(`${gesture}: shared raw edit follows the combined ${scenario} response and matches Basic`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ scenario, gesture }) => {
                    const { appImport, fixtures, show, view, history, point, settings } =
                        window.editorTest
                    const { select } = await appImport<
                        typeof import('../../src/editor/tools/select')
                    >('/src/editor/tools/select.ts')
                    const { scalingTool } = await appImport<
                        typeof import('../../src/editor/scaling/tool')
                    >('/src/editor/scaling/tool.ts')
                    const session = await appImport<
                        typeof import('../../src/editor/commands/scaleSelection/session')
                    >('/src/editor/commands/scaleSelection/session.ts')
                    const { getPreviewState } =
                        await appImport<typeof import('../../src/preview/edit')>(
                            '/src/preview/edit.ts',
                        )
                    const pivot = fixtures.events.stagePivotEvents[0]!
                    const transform = fixtures.events.stageTransformEvents[0]!
                    const base = fixtures.interaction.slides[0]![0]!
                    const partial = scenario === 'partial pivot'
                    const translated = scenario === 'pivot and translation'
                    const offset = (partial ? 2 : 4) + (translated ? 2 : 0)
                    const slope = 1 + (partial ? 0.5 : 1) + (translated ? 1 : 0)
                    const rawDelta = partial ? 2 : 1
                    const factor = scenario === 'pivot' ? 4 / 3 : 1.5
                    const results = []
                    for (const layout of ['basic', 'composed'] as const) {
                        show(
                            {
                                ...fixtures.interaction,
                                isDynamicStages: true,
                                slides: [[{ ...base, beat: 4, left: 0, size: 2 }]],
                                stagePivotEvents: [
                                    {
                                        ...pivot,
                                        beat: 0,
                                        pivotLane: 4,
                                        divisionSize: 2,
                                        divisionParity: 'even',
                                        eventEase: 'linear',
                                    },
                                    ...(partial ? [{ ...pivot, beat: 8, pivotLane: 0 }] : []),
                                ],
                                stageTransformEvents: translated
                                    ? [{ ...transform, beat: 0, xTranslation: 2 }]
                                    : [],
                            },
                            2,
                        )
                        view.layout = layout
                        view.laneDivision = 3
                        view.laneSnapping = 'relative'
                        settings.maxLane = 0
                        await window.editorTest.nextTick()
                        const source = history.state.value
                        const note = [...source.store.slides.note.values()].flat()[0]!
                        const controls = [
                            ...source.store.grid.stagePivotEventJoint.values(),
                            ...source.store.grid.stageTransformEventJoint.values(),
                        ]
                            .flatMap((set) => [...set])
                            .filter((entity) => entity.beat === 0)
                        history.replaceState({ ...source, selectedEntities: [note, ...controls] })
                        const composed = layout === 'composed'
                        // Grab just inside the right edge so float round trips
                        // cannot put the hit outside the note by one ulp.
                        const fromLane = (composed ? offset : 0) + (gesture === 'move' ? 1 : 1.95)
                        const toLane =
                            gesture === 'move'
                                ? fromLane + rawDelta * (composed ? slope : 1)
                                : (composed ? offset + 2 : 2) * factor - 0.05
                        const from = point(fromLane, 4)
                        const to = point(toLane, 4)
                        const tool = gesture === 'move' ? select : scalingTool
                        if (gesture === 'width' && !session.beginScalingSession('width'))
                            throw new Error('Cannot begin scaling')
                        const modifiers = { ctrl: false, shift: false }
                        if (!tool.dragStart?.(from.x, from.y, modifiers))
                            throw new Error('Drag did not start')
                        tool.dragUpdate?.(to.x, to.y, modifiers)
                        const summarize = (state: typeof source) => {
                            const note = [...state.store.slides.note.values()].flat()[0]!
                            const pivot = state.selectedEntities.find(
                                (entity) => entity.type === 'stagePivotEventJoint',
                            )!
                            const transform = state.selectedEntities.find(
                                (entity) => entity.type === 'stageTransformEventJoint',
                            )
                            if (pivot.type !== 'stagePivotEventJoint')
                                throw new Error('Pivot missing')
                            return {
                                left: note.left,
                                size: note.size,
                                pivot: pivot.pivotLane,
                                translation:
                                    transform?.type === 'stageTransformEventJoint'
                                        ? transform.xTranslation
                                        : undefined,
                            }
                        }
                        const preview = summarize(getPreviewState(history.state.value))
                        await tool.dragEnd?.(to.x, to.y, modifiers)
                        if (gesture === 'width' && !session.applyScalingSession())
                            throw new Error('Cannot apply scaling')
                        results.push({ preview, actual: summarize(history.state.value) })
                    }
                    return { results, rawDelta, factor, translated }
                },
                { scenario, gesture },
            )
            expect(result.results[1]).toEqual(result.results[0])
            for (const edit of result.results) {
                for (const actual of [edit.preview, edit.actual]) {
                    expect(actual.left).toBeCloseTo(gesture === 'move' ? result.rawDelta : 0, 8)
                    expect(actual.size).toBeCloseTo(gesture === 'width' ? 2 * result.factor : 2, 8)
                    expect(actual.pivot).toBeCloseTo(
                        gesture === 'move' ? 4 + result.rawDelta : 4 * result.factor,
                        8,
                    )
                    if (result.translated)
                        expect(actual.translation).toBeCloseTo(
                            gesture === 'move' ? 2 + result.rawDelta : 2 * result.factor,
                            8,
                        )
                }
            }
        })
    }
}

for (const response of ['singular', 'negative'] as const) {
    test(`width: ${response} projected response stays finite and cancellation restores the baseline`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (response) => {
            const { appImport, fixtures, show, view, history, point, settings } = window.editorTest
            const { easeEvaluator } =
                await appImport<typeof import('../../src/ease')>('/src/ease.ts')
            const { scalingTool } = await appImport<typeof import('../../src/editor/scaling/tool')>(
                '/src/editor/scaling/tool.ts',
            )
            const session = await appImport<
                typeof import('../../src/editor/commands/scaleSelection/session')
            >('/src/editor/commands/scaleSelection/session.ts')
            const { getPreviewState } =
                await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
            const pivot = fixtures.events.stagePivotEvents[0]!
            // This outgoing pivot contributes -2 at the overshoot. Its scaling
            // response cancels a width-2 note, and reverses a width-1 note's right edge.
            const width = response === 'singular' ? 2 : 1
            const pivotLane = 2 / (easeEvaluator('outBack')(0.8) - 1)
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    slides: [
                        [{ ...fixtures.interaction.slides[0]![0]!, beat: 8, left: 0, size: width }],
                    ],
                    stagePivotEvents: [
                        { ...pivot, beat: 0, pivotLane, eventEase: 'outBack' },
                        { ...pivot, beat: 10, pivotLane: 0 },
                    ],
                },
                4,
            )
            view.layout = 'composed'
            view.laneDivision = 1
            view.laneSnapping = 'relative'
            settings.maxLane = 0
            await window.editorTest.nextTick()
            const source = history.state.value
            const note = [...source.store.slides.note.values()].flat()[0]!
            const event = [...source.store.grid.stagePivotEventJoint.values()]
                .flatMap((set) => [...set])
                .find((event) => event.beat === 0)!
            history.replaceState({ ...source, selectedEntities: [note, event] })
            const initial = history.state.value
            if (!session.beginScalingSession('width')) throw new Error('Cannot begin scaling')
            const from = point(width - 2, 8)
            const to = point(response === 'singular' ? 2 : -2, 8)
            const modifiers = { ctrl: false, shift: false }
            const started = scalingTool.dragStart?.(from.x, from.y, modifiers)
            scalingTool.dragUpdate?.(to.x, to.y, modifiers)
            const draft = getPreviewState(history.state.value)
            const unchanged = draft === initial
            const draftNote = [...draft.store.slides.note.values()].flat()[0]!
            const draftPivot = draft.selectedEntities.find(
                (entity) => entity.type === 'stagePivotEventJoint',
            )!
            if (draftPivot.type !== 'stagePivotEventJoint') throw new Error('Pivot missing')
            const factor = session.scalingSession.value?.factor
            const values = {
                noteLeft: draftNote.left,
                noteSize: draftNote.size,
                pivotFactor: draftPivot.pivotLane / pivotLane,
                factor,
            }
            scalingTool.dragCancel?.()
            session.cancelScalingSession()
            return { started, unchanged, restored: history.state.value === initial, values }
        }, response)
        expect(result.started).toBe(true)
        expect(result.unchanged).toBe(response === 'singular')
        expect(result.restored).toBe(true)
        expect(result.values.noteLeft).toBe(0)
        expect(result.values.noteSize).toBeCloseTo(2, 8)
        expect(result.values.pivotFactor).toBeCloseTo(response === 'singular' ? 1 : 2, 8)
        expect(result.values.factor).toBeCloseTo(response === 'singular' ? 1 : 2, 8)
    })
}
