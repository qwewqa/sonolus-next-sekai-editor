import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const beatDelta of [-1, 0, 2]) {
    test(`mixed drag ${beatDelta} preserves notes through paired pivot jumps, transforms, and BPM edits`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (beatDelta) => {
            const { fixtures, show, view, settings, history, store, point, appImport } =
                window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            const transform = fixtures.events.stageTransformEvents[0]!
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    bpms: [
                        { beat: 0, bpm: 120 },
                        { beat: 3, bpm: 60 },
                    ],
                    stagePivotEvents: [
                        { ...pivot, beat: 2, pivotLane: -3, eventEase: 'linear' },
                        { ...pivot, beat: 2, pivotLane: 3, eventEase: 'linear' },
                        { ...pivot, beat: 6, pivotLane: -1, eventEase: 'linear' },
                        { ...pivot, beat: 6, pivotLane: 4, eventEase: 'linear' },
                    ],
                    stageTransformEvents: [{ ...transform, beat: 1, xTranslation: 1 }],
                    slides: [2, 4, 6].map((beat) => [{ ...base, beat, left: 0, size: 2 }]),
                },
                4,
            )
            view.layout = 'composed'
            view.snapping = 'relative'
            view.laneDivision = 1_000_000
            view.laneSnapping = 'relative'
            settings.maxLane = 0
            const { createComposedLayout } =
                await appImport<typeof import('../../src/editor/composed')>(
                    '/src/editor/composed.ts',
                )
            const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
                '/src/editor/tools/select.ts',
            )
            const { sceneState } = await appImport<typeof import('../../src/editor/sceneState')>(
                '/src/editor/sceneState.ts',
            )
            const { beatToTime } = await appImport<typeof import('../../src/state/integrals/bpms')>(
                '/src/state/integrals/bpms.ts',
            )
            const source = history.state.value
            const notes = [...source.store.slides.note.values()].flat()
            const layout = createComposedLayout(source)
            const selected = [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' ||
                    entity.type === 'stagePivotEventJoint' ||
                    entity.type === 'stageTransformEventJoint' ||
                    (entity.type === 'bpm' && entity.beat > 0),
            )
            history.replaceState({ ...source, selectedEntities: selected })
            const focus = notes[1]!
            const start = point(
                layout.noteLeft(focus) + focus.size / 2,
                beatToTime(source.bpms, focus.beat) * 2,
            )
            const end = point(
                layout.noteLeft(focus) + focus.size / 2 + 2,
                beatToTime(source.bpms, focus.beat + beatDelta) * 2,
            )
            const modifiers = { ctrl: false, shift: false }
            select.dragStart!(start.x, start.y, modifiers)
            select.dragUpdate!(end.x, end.y, modifiers)
            const positions = (source: import('../../src/state').State) =>
                notes.map((note) => {
                    const moved = source.store.slides.note.get(note.slideId)![0]!
                    return { beat: moved.beat, left: createComposedLayout(source).noteLeft(moved) }
                })
            const preview = positions(sceneState.value)
            await select.dragEnd!(end.x, end.y, modifiers)
            const after = positions(history.state.value)
            const destination = createComposedLayout(history.state.value)
            const rawDelta =
                layout.noteLeft(focus) +
                2 -
                destination.offset(focus.stageId, focus.beat + beatDelta) -
                focus.left
            const expected = notes.map((note) => ({
                beat: note.beat + beatDelta,
                left:
                    note.left + rawDelta + destination.offset(note.stageId, note.beat + beatDelta),
            }))
            const pivots = [
                ...new Set(
                    [...history.state.value.store.grid.stagePivotEventJoint.values()].flatMap(
                        (bucket) => [...bucket],
                    ),
                ),
            ].map((event) => [event.beat, event.pivotLane])
            history.undoState()
            return {
                expected,
                preview,
                after,
                pivots,
                restored: positions(history.state.value),
                original: positions(source),
            }
        }, beatDelta)
        for (const [index, expected] of result.expected.entries()) {
            expect(result.preview[index]!.beat).toBe(expected.beat)
            expect(result.after[index]!.beat).toBe(expected.beat)
            expect(result.preview[index]!.left).toBeCloseTo(expected.left, 5)
            expect(result.after[index]!.left).toBeCloseTo(expected.left, 5)
        }
        // Note, pivot, and translation share the edit: their three responses
        // turn a two-lane pointer movement into a raw two-thirds-lane move.
        const pivots = result.pivots.sort((a, b) => a[0]! - b[0]!)
        const expectedPivots = [
            [2, -3],
            [2, 3],
            [6, -1],
            [6, 4],
        ]
        for (const [index, [beat, lane]] of expectedPivots.entries()) {
            expect(pivots[index]![0]).toBe(beat! + beatDelta)
            expect(pivots[index]![1]).toBeCloseTo(lane! + 2 / 3, 5)
        }
        expect(result.restored).toEqual(result.original)
    })
}
