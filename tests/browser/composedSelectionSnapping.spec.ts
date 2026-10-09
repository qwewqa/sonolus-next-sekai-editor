import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const mode of ['relative', 'absolute'] as const) {
    test(`${mode} selection snaps the grabbed raw anchor and preserves other notes' raw offsets`, async ({
        page,
    }) => {
        const results = await page.evaluate(async (mode) => {
            const { fixtures, show, view, settings, history, point, appImport } = window.editorTest
            const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
                '/src/editor/tools/select.ts',
            )
            const { createComposedLayout } =
                await appImport<typeof import('../../src/editor/composed')>(
                    '/src/editor/composed.ts',
                )
            const { sceneState } = await appImport<typeof import('../../src/editor/sceneState')>(
                '/src/editor/sceneState.ts',
            )
            const base = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            const transform = fixtures.events.stageTransformEvents[0]!
            const results = []
            for (const layout of ['basic', 'composed'] as const) {
                for (const dynamic of [false, true]) {
                    for (const parity of ['even', 'odd'] as const) {
                        for (const size of [1, 2, 3]) {
                            for (const width of [2, 3]) {
                                for (const division of [1, 3]) {
                                    show(
                                        {
                                            ...fixtures.interaction,
                                            isDynamicStages: dynamic,
                                            stagePivotEvents: [
                                                {
                                                    ...pivot,
                                                    beat: 0,
                                                    pivotLane: 0.2,
                                                    eventEase: 'linear',
                                                    divisionSize: size,
                                                    divisionParity: parity,
                                                },
                                                {
                                                    ...pivot,
                                                    beat: 8,
                                                    pivotLane: 2.2,
                                                    eventEase: 'linear',
                                                    divisionSize: size,
                                                    divisionParity: parity,
                                                },
                                                {
                                                    ...pivot,
                                                    stageId: 2 as typeof pivot.stageId,
                                                    beat: 0,
                                                    pivotLane: -1,
                                                    eventEase: 'linear',
                                                },
                                                {
                                                    ...pivot,
                                                    stageId: 2 as typeof pivot.stageId,
                                                    beat: 8,
                                                    pivotLane: 3,
                                                    eventEase: 'linear',
                                                },
                                            ],
                                            stageTransformEvents: [
                                                { ...transform, beat: 0, xTranslation: 0.3 },
                                            ],
                                            slides: [
                                                [{ ...base, beat: 4, left: 0.15, size: width }],
                                                [
                                                    {
                                                        ...base,
                                                        stageId: 2 as typeof base.stageId,
                                                        beat: 5,
                                                        left: -3.2,
                                                        size: 2,
                                                    },
                                                ],
                                            ],
                                        },
                                        3,
                                    )
                                    view.layout = layout
                                    view.laneDivision = division
                                    view.laneSnapping = mode
                                    view.snapping = 'absolute'
                                    settings.maxLane = 0
                                    const source = history.state.value
                                    const notes = [...source.store.slides.note.values()].flat()
                                    history.replaceState({ ...source, selectedEntities: notes })
                                    const composed = dynamic && layout === 'composed'
                                    const startOffset = composed ? 1.5 : 0
                                    const endOffset = composed ? 2 : 0
                                    const origin =
                                        composed && parity === 'odd' && size % 2 ? 0.5 : 0
                                    const rawPointerDelta = 0.62 + startOffset - endOffset
                                    const rawDelta =
                                        mode === 'relative'
                                            ? Math.round(rawPointerDelta * division) / division
                                            : Math.round(
                                                  (0.15 + rawPointerDelta - origin) * division,
                                              ) /
                                                  division +
                                              origin -
                                              0.15
                                    const start = point(0.15 + width / 2 + startOffset, 4)
                                    const end = point(0.15 + width / 2 + startOffset + 0.62, 6)
                                    const modifiers = { ctrl: false, shift: false }
                                    select.dragStart!(start.x, start.y, modifiers)
                                    select.dragUpdate!(end.x, end.y, modifiers)
                                    const preview = [
                                        ...sceneState.value.store.slides.note.values(),
                                    ].flat()
                                    const previewRaw = preview.map(({ left }) => left)
                                    await select.dragEnd!(end.x, end.y, modifiers)
                                    const after = history.state.value
                                    const moved = [...after.store.slides.note.values()].flat()
                                    const positions = createComposedLayout(after)
                                    results.push({
                                        label: `${layout}/${dynamic}/${parity}/${size}/${width}/${division}`,
                                        raw: moved.map(({ left }) => left),
                                        expected: [0.15 + rawDelta, -3.2 + rawDelta],
                                        beats: moved.map(({ beat }) => beat),
                                        preview: composed ? previewRaw : undefined,
                                        displayGap:
                                            positions.noteLeft(moved[1]!) -
                                            positions.noteLeft(moved[0]!),
                                        expectedDisplayGap: -3.35 + (dynamic ? 2.5 - 2 : 0),
                                    })
                                }
                            }
                        }
                    }
                }
            }
            return results
        }, mode)
        for (const result of results) {
            expect(result.beats, result.label).toEqual([6, 7])
            result.raw.forEach((left, i) =>
                expect(left, result.label).toBeCloseTo(result.expected[i]!),
            )
            if (result.preview) expect(result.preview, result.label).toEqual(result.raw)
            expect(result.displayGap, result.label).toBeCloseTo(result.expectedDisplayGap)
        }
    })
}

test('Composed selection resize snaps one odd-parity edge and applies its raw delta to other notes', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { fixtures, show, view, history, appImport, point } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 0.2, divisionParity: 'odd', divisionSize: 3 },
                ],
                slides: [
                    [{ ...base, beat: 4, left: 0.5, size: 3 }],
                    [{ ...base, beat: 6, left: -0.2, size: 2 }],
                ],
            },
            3,
        )
        view.layout = 'composed'
        view.laneDivision = 1
        view.laneSnapping = 'absolute'
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()].flat(),
        })
        const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
            '/src/editor/tools/select.ts',
        )
        const start = point(3.65, 4)
        const end = point(4.27, 6)
        const modifiers = { ctrl: false, shift: false }
        select.dragStart!(start.x, start.y, modifiers)
        select.dragUpdate!(end.x, end.y, modifiers)
        await select.dragEnd!(end.x, end.y, modifiers)
        const after = window.editorTest.snapshot().notes
        history.undoState()
        return { after, undo: window.editorTest.snapshot().notes }
    })
    expect(result.after).toEqual([
        { type: 'note', beat: 4, left: 0.5, size: 4 },
        { type: 'note', beat: 6, left: -0.2, size: 3 },
    ])
    expect(result.undo).toEqual([
        { type: 'note', beat: 4, left: 0.5, size: 3 },
        { type: 'note', beat: 6, left: -0.2, size: 2 },
    ])
})

for (const direction of [-1, 1]) {
    test(`shared control move ${direction} probes without lane limits and applies the same final constraints as Basic`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (direction) => {
            const { fixtures, show, view, settings, history, point, appImport } = window.editorTest
            const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
                '/src/editor/tools/select.ts',
            )
            const { sceneState } = await appImport<typeof import('../../src/editor/sceneState')>(
                '/src/editor/sceneState.ts',
            )
            const base = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            const results = []
            for (const layout of ['basic', 'composed'] as const) {
                show(
                    {
                        ...fixtures.interaction,
                        isDynamicStages: true,
                        stagePivotEvents: [{ ...pivot, beat: 0, pivotLane: 4 }],
                        slides: [[{ ...base, beat: 4, left: 4, size: 2 }]],
                    },
                    3,
                )
                view.layout = layout
                view.laneSnapping = 'relative'
                view.laneDivision = 1
                settings.maxLane = 6
                settings.width = 32
                const source = history.state.value
                const note = [...source.store.slides.note.values()].flat()[0]!
                const event = [...source.store.grid.stagePivotEventJoint.values()].flatMap(
                    (set) => [...set],
                )[0]!
                history.replaceState({ ...source, selectedEntities: [note, event] })
                const start = point(layout === 'composed' ? 9 : 5, 4)
                const end = point(
                    (layout === 'composed' ? 9 : 5) + direction * (layout === 'composed' ? 2 : 1),
                    4,
                )
                const modifiers = { ctrl: false, shift: false }
                select.dragStart!(start.x, start.y, modifiers)
                select.dragUpdate!(end.x, end.y, modifiers)
                const summarize = (state: typeof source) => ({
                    note: [...state.store.slides.note.values()].flat()[0]!.left,
                    pivot: [...state.store.grid.stagePivotEventJoint.values()].flatMap((set) => [
                        ...set,
                    ])[0]!.pivotLane,
                })
                const preview = layout === 'composed' ? summarize(sceneState.value) : undefined
                await select.dragEnd!(end.x, end.y, modifiers)
                results.push({ preview, after: summarize(history.state.value) })
            }
            return results
        }, direction)
        const expected = { note: direction < 0 ? 3 : 4, pivot: 4 + direction }
        expect(result[0]!.after).toEqual(expected)
        expect(result[1]!.after).toEqual(expected)
        expect(result[1]!.preview).toEqual(expected)
    })
}

test('an attached anchor with no horizontal response keeps the shared raw baseline', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { fixtures, show, view, history, point, appImport } = window.editorTest
        const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
            '/src/editor/tools/select.ts',
        )
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [
                        { ...base, beat: 2, left: 0 },
                        { ...base, beat: 4, left: 1, isAttached: true },
                        { ...base, beat: 6, left: 2 },
                    ],
                ],
            },
            3,
        )
        view.layout = 'composed'
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat().find((note) => note.isAttached)!
        const bpm = [...source.store.grid.bpm.values()].flatMap((set) => [...set])[0]!
        history.replaceState({ ...source, selectedEntities: [note, bpm] })
        const start = point(2, 4)
        const end = point(4, 4)
        const modifiers = { ctrl: false, shift: false }
        select.dragStart!(start.x, start.y, modifiers)
        select.dragUpdate!(end.x, end.y, modifiers)
        await select.dragEnd!(end.x, end.y, modifiers)
        return { undo: history.canUndo.value, notes: window.editorTest.snapshot().notes }
    })
    expect(result.undo).toBe(false)
    expect(result.notes.map((note) => note.left)).toEqual([0, 1, 2])
})
