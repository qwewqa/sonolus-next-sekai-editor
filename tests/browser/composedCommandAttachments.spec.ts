import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const command of ['flip', 'flipVertical'] as const) {
    test(`${command} transforms endpoints while preserving cross-stage attachment semantics`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (command) => {
            const { history, fixtures, show, view, appImport } = window.editorTest
            const chart = fixtures.interaction
            const base = chart.slides[0]![0]!
            const [stageA, stageB] = [...chart.stages.keys()]
            const pivot = fixtures.events.stagePivotEvents[0]!
            show(
                {
                    ...chart,
                    isDynamicStages: true,
                    stagePivotEvents: [
                        { ...pivot, stageId: stageA!, beat: 0, pivotLane: 0, eventEase: 'linear' },
                        { ...pivot, stageId: stageA!, beat: 4, pivotLane: 8, eventEase: 'linear' },
                    ],
                    slides: [
                        [
                            { ...base, stageId: stageA!, beat: 0, left: -1, size: 2 },
                            {
                                ...base,
                                stageId: stageA!,
                                beat: 1,
                                left: -1,
                                size: 2,
                                isAttached: true,
                            },
                            { ...base, stageId: stageB!, beat: 4, left: -1, size: 2 },
                        ],
                    ],
                },
                2,
            )
            view.layout = 'composed'
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
            })
            const positions = () => {
                const source = history.state.value
                return source.selectedEntities
                    .filter((note) => note.type === 'note')
                    .map((note) => ({ left: note.left, size: note.size, beat: note.beat }))
            }
            const before = positions()
            if (command === 'flip') {
                const { flip } = await appImport<typeof import('../../src/editor/commands/flip')>(
                    '/src/editor/commands/flip/index.ts',
                )
                flip.execute()
            } else {
                const { flipVertical } = await appImport<
                    typeof import('../../src/editor/commands/flipVertical')
                >('/src/editor/commands/flipVertical/index.ts')
                flipVertical.execute()
            }
            const after = positions()
            const attached = history.state.value.selectedEntities
                .filter((note) => note.type === 'note')
                .map((note) => note.isAttached)
            history.undoState()
            const restored = positions()
            history.redoState()
            return { before, after, attached, restored, redone: positions() }
        }, command)
        expect(result.after.filter((_, index) => index !== 1)).toEqual(
            result.before
                .filter((_, index) => index !== 1)
                .map(({ left, size, beat }) => ({
                    left: command === 'flip' ? -(left + size) : left,
                    size,
                    beat: command === 'flipVertical' ? 4 - beat : beat,
                })),
        )
        // Attached interiors follow authored endpoints, independently of the view layout.
        expect(result.after[1]).toEqual({
            left: -1,
            size: 2,
            beat: command === 'flip' ? 1 : 3,
        })
        expect(result.attached).toEqual([false, true, false])
        expect(result.restored).toEqual(result.before)
        expect(result.redone).toEqual(result.after)
    })
}

for (const command of ['combineNotes', 'splitHold'] as const) {
    test(`${command} materializes cross-stage attachments with translated stages and changing BPM`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (command) => {
            const { history, fixtures, show, view, appImport } = window.editorTest
            const chart = fixtures.interaction
            const base = chart.slides[0]![0]!
            const [stageA, stageB] = [...chart.stages.keys()]
            const pivot = fixtures.events.stagePivotEvents[0]!
            const transform = fixtures.events.stageTransformEvents[0]!
            show(
                {
                    ...chart,
                    isDynamicStages: true,
                    bpms: [
                        { beat: 0, bpm: 120 },
                        { beat: 2, bpm: 60 },
                    ],
                    stagePivotEvents: [
                        {
                            ...pivot,
                            stageId: stageA!,
                            beat: 0,
                            pivotLane: 2,
                            eventEase: 'inOutStep',
                        },
                        { ...pivot, stageId: stageA!, beat: 4, pivotLane: 8, eventEase: 'linear' },
                    ],
                    stageTransformEvents: [
                        {
                            ...transform,
                            stageId: stageA!,
                            beat: 0,
                            xTranslation: 4,
                            eventEase: 'linear',
                        },
                        {
                            ...transform,
                            stageId: stageA!,
                            beat: 4,
                            xTranslation: 10,
                            eventEase: 'linear',
                        },
                        {
                            ...transform,
                            stageId: stageB!,
                            beat: 0,
                            xTranslation: -2,
                            eventEase: 'none',
                        },
                    ],
                    slides: [
                        [
                            {
                                ...base,
                                stageId: stageA!,
                                beat: 0,
                                left: -2,
                                size: 2,
                                connectorEase: 'inQuad',
                            },
                            {
                                ...base,
                                stageId: stageB!,
                                beat: 2,
                                left: -1,
                                size: 2,
                                isAttached: true,
                            },
                            {
                                ...base,
                                stageId: stageA!,
                                beat: 2.5,
                                left: -1,
                                size: 2,
                                isAttached: true,
                            },
                            { ...base, stageId: stageB!, beat: 4, left: 3, size: 4 },
                        ],
                        [{ ...base, stageId: stageB!, beat: 1, left: 1, size: 2 }],
                    ],
                },
                2,
            )
            view.layout = 'composed'
            const source = history.state.value
            const notes = [...source.store.slides.note.values()].flat()
            const selected =
                command === 'combineNotes' ? notes : [notes.find((note) => note.beat === 2)!]
            history.replaceState({ ...source, selectedEntities: selected })
            const { getMaterializedNotePositions } = await appImport<
                typeof import('../../src/state/operations/notePositions')
            >('/src/state/operations/notePositions.ts')
            const materialized = getMaterializedNotePositions(source, notes)
            const expected = notes
                .map((note) => ({
                    left: materialized.get(note)?.left ?? note.left,
                    size: materialized.get(note)?.size ?? note.size,
                    beat: note.beat,
                    attached: false,
                }))
                .sort((a, b) => a.beat - b.beat)
            const snapshot = () => {
                const source = history.state.value
                return [...source.store.slides.note.values()]
                    .flat()
                    .map((note) => ({
                        left: note.left,
                        size: note.size,
                        beat: note.beat,
                        attached: note.isAttached,
                    }))
                    .sort((a, b) => a.beat - b.beat)
            }
            const before = snapshot()
            if (command === 'combineNotes') {
                const { combineNotes } = await appImport<
                    typeof import('../../src/editor/commands/combineNotes')
                >('/src/editor/commands/combineNotes/index.ts')
                combineNotes.execute()
            } else {
                const { splitHold } = await appImport<
                    typeof import('../../src/editor/commands/splitHold')
                >('/src/editor/commands/splitHold/index.ts')
                splitHold.execute()
            }
            const after = snapshot()
            const current = history.state.value
            const live = current.selectedEntities.every(
                (entity) =>
                    entity.type !== 'note' ||
                    current.store.slides.note.get(entity.slideId)?.includes(entity),
            )
            history.undoState()
            const restored = snapshot()
            history.redoState()
            return { before, after, expected, live, restored, redone: snapshot() }
        }, command)
        for (const [index, note] of result.after.entries()) {
            expect(note.left).toBeCloseTo(result.expected[index]!.left, 10)
            expect(note.size).toBeCloseTo(result.expected[index]!.size, 10)
            expect(note.beat).toBe(result.before[index]!.beat)
            expect(note.attached).toBe(false)
        }
        expect(result.live).toBe(true)
        expect(result.restored).toEqual(result.before)
        expect(result.redone).toEqual(result.after)
    })
}
