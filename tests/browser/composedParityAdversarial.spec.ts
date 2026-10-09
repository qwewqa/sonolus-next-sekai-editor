import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    // Direct tool calls need the canvas coordinate observer to have published
    // its initial dimensions, which can trail the first visible frame.
    await page.waitForFunction(() => window.editorTest.view.w > 0 && window.editorTest.view.h > 0)
    await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    )
})

for (const mode of ['composed', 'basic', 'ordinary'] as const) {
    test(`${mode}: creation follows the engine divider lattice for all odd/even widths and subdivisions`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (mode) => {
            const { appImport, fixtures, show, view, point, history } = window.editorTest
            const { tools } = await appImport<typeof import('../../src/editor/tools')>(
                '/src/editor/tools/index.ts',
            )
            const pivot = fixtures.events.stagePivotEvents[0]!
            const transform = fixtures.events.stageTransformEvents[0]!
            const failures: unknown[] = []
            let cases = 0
            for (const name of ['note', 'slide'] as const) {
                for (const divisionSize of [1, 2, 3, 4, 5]) {
                    for (const divisionParity of ['even', 'odd'] as const) {
                        for (const subdivision of [1, 2, 3, 4]) {
                            for (const width of [1, 2, 3]) {
                                for (const rawPointer of [-2.13, 0.13, 1.38]) {
                                    show({
                                        ...fixtures.interaction,
                                        isDynamicStages: mode !== 'ordinary',
                                        slides: [],
                                        stagePivotEvents: [
                                            {
                                                ...pivot,
                                                beat: 0,
                                                pivotLane: 0.375,
                                                divisionSize,
                                                divisionParity,
                                            },
                                        ],
                                        stageTransformEvents: [
                                            { ...transform, beat: 0, xTranslation: 0.75 },
                                        ],
                                    })
                                    view.layout = mode === 'basic' ? 'basic' : 'composed'
                                    view.noteSize = width
                                    view.laneDivision = subdivision
                                    view.laneSnapping = 'absolute'
                                    const composed = mode === 'composed'
                                    const offset = composed ? 1.125 : 0
                                    const phase =
                                        composed && divisionParity === 'odd' ? divisionSize / 2 : 0
                                    const expected =
                                        phase +
                                        Math.round((rawPointer - phase) * subdivision) / subdivision
                                    const target = point(rawPointer + offset, 4)
                                    const modifiers = { ctrl: false, shift: false }
                                    await tools[name].hover?.(target.x, target.y, modifiers)
                                    const ghost = view.entities.creating[0]
                                    await tools[name].tap?.(target.x, target.y, modifiers)
                                    const actual = history.state.value.selectedEntities[0]
                                    cases++
                                    if (
                                        ghost?.type !== 'note' ||
                                        actual?.type !== 'note' ||
                                        Math.abs(ghost.left - expected) > 1e-9 ||
                                        Math.abs(actual.left - expected) > 1e-9 ||
                                        ghost.size !== width ||
                                        actual.size !== width
                                    ) {
                                        failures.push({
                                            name,
                                            divisionSize,
                                            divisionParity,
                                            subdivision,
                                            width,
                                            rawPointer,
                                            expected,
                                            ghost: ghost?.type === 'note' ? ghost.left : null,
                                            actual: actual?.type === 'note' ? actual.left : null,
                                        })
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return { cases, failures: failures.slice(0, 10), failureCount: failures.length }
        }, mode)
        expect(result.cases).toBe(720)
        expect(result).toEqual({ cases: 720, failures: [], failureCount: 0 })
    })
}

for (const futurePivot of [false, true]) {
    for (const focus of ['note', 'pivot', 'transform'] as const) {
        for (const layout of ['basic', 'composed'] as const) {
            test(`${layout}: mixed event selection applies one raw snapped delta (${focus} focus, future pivot ${futurePivot})`, async ({
                page,
            }) => {
                const result = await page.evaluate(
                    async ({ focus, layout, futurePivot }) => {
                        const { appImport, fixtures, show, view, point, history } =
                            window.editorTest
                        const { select } = await appImport<
                            typeof import('../../src/editor/tools/select')
                        >('/src/editor/tools/select.ts')
                        const { getPreviewState } =
                            await appImport<typeof import('../../src/preview/edit')>(
                                '/src/preview/edit.ts',
                            )
                        const pivot = fixtures.events.stagePivotEvents[0]!
                        const transform = fixtures.events.stageTransformEvents[0]!
                        show({
                            ...fixtures.interaction,
                            isDynamicStages: true,
                            slides: [
                                [
                                    {
                                        ...fixtures.interaction.slides[0]![0]!,
                                        beat: 6,
                                        left: 0.67,
                                        size: 3,
                                    },
                                ],
                                [
                                    {
                                        ...fixtures.interaction.slides[0]![0]!,
                                        stageId: 2 as typeof pivot.stageId,
                                        beat: 6,
                                        left: -1.23,
                                        size: 1,
                                    },
                                ],
                            ],
                            stagePivotEvents: [
                                {
                                    ...pivot,
                                    beat: 0,
                                    pivotLane: 0.25,
                                    divisionSize: 3,
                                    divisionParity: 'odd',
                                },
                                {
                                    ...pivot,
                                    beat: 4,
                                    pivotLane: 0.85,
                                    divisionSize: 3,
                                    divisionParity: 'odd',
                                    eventEase: 'linear',
                                },
                                ...(futurePivot
                                    ? [
                                          {
                                              ...pivot,
                                              beat: 10,
                                              pivotLane: 2.15,
                                              divisionSize: 3,
                                              divisionParity: 'odd' as const,
                                          },
                                      ]
                                    : []),
                                {
                                    ...pivot,
                                    stageId: 2 as typeof pivot.stageId,
                                    beat: 0,
                                    pivotLane: -4.2,
                                },
                            ],
                            stageTransformEvents: [
                                { ...transform, beat: 0, xTranslation: 0.1 },
                                { ...transform, beat: 2, xTranslation: 0.4 },
                            ],
                        })
                        view.layout = layout
                        view.laneDivision = 1
                        view.laneSnapping = 'relative'
                        view.division = 1
                        view.snapping = 'relative'
                        const source = history.state.value
                        const note = [...source.store.slides.note.values()].flat()[0]!
                        const otherNote = [...source.store.slides.note.values()].flat()[1]!
                        const pivotEntity = [...source.store.grid.stagePivotEventJoint.values()]
                            .flatMap((set) => [...set])
                            .find((entity) => entity.beat === 4)!
                        const transformEntity = [
                            ...source.store.grid.stageTransformEventJoint.values(),
                        ]
                            .flatMap((set) => [...set])
                            .find((entity) => entity.beat === 2)!
                        history.replaceState({
                            ...source,
                            selectedEntities: [note, otherNote, pivotEntity, transformEntity],
                        })
                        const lane =
                            focus === 'note'
                                ? 0.67 +
                                  1.5 +
                                  (layout === 'composed'
                                      ? futurePivot
                                          ? 1.25 + 1.3 / 3
                                          : 1.25
                                      : 0)
                                : focus === 'pivot'
                                  ? 0.85
                                  : 0.4
                        const beat = focus === 'note' ? 6 : focus === 'pivot' ? 4 : 2
                        const from = point(lane, beat)
                        const to = point(lane + 0.72, beat + 2)
                        const modifiers = { ctrl: false, shift: false }
                        select.dragStart?.(from.x, from.y, modifiers)
                        select.dragUpdate?.(to.x, to.y, modifiers)
                        const summarize = (state: typeof source) => {
                            const notes = [...state.store.slides.note.values()].flat()
                            const pivot = state.selectedEntities.find(
                                (entity) => entity.type === 'stagePivotEventJoint',
                            )!
                            const transform = state.selectedEntities.find(
                                (entity) => entity.type === 'stageTransformEventJoint',
                            )!
                            const note = notes.find((note) => note.stageId === 1)!
                            const otherNote = notes.find((note) => note.stageId === 2)!
                            if (
                                pivot.type !== 'stagePivotEventJoint' ||
                                transform.type !== 'stageTransformEventJoint'
                            )
                                throw new Error('Selected stage events missing')
                            return {
                                noteBeat: note.beat,
                                noteLeft: note.left,
                                otherNoteBeat: otherNote.beat,
                                otherNoteLeft: otherNote.left,
                                noteDisplayLeft:
                                    note.left +
                                    (layout === 'composed'
                                        ? (futurePivot
                                              ? pivot.pivotLane + (2.15 - pivot.pivotLane) / 2
                                              : pivot.pivotLane) + transform.xTranslation
                                        : 0),
                                pivotBeat: pivot.beat,
                                pivotLane: pivot.pivotLane,
                                transformBeat: transform.beat,
                                xTranslation: transform.xTranslation,
                            }
                        }
                        const preview = summarize(getPreviewState(history.state.value))
                        await select.dragEnd?.(to.x, to.y, modifiers)
                        return { preview, actual: summarize(history.state.value) }
                    },
                    { focus, layout, futurePivot },
                )
                for (const actual of [result.preview, result.actual]) {
                    expect(actual.noteBeat).toBe(8)
                    expect(actual.noteDisplayLeft).toBeCloseTo(
                        layout === 'composed'
                            ? focus === 'note'
                                ? futurePivot
                                    ? 2.57
                                    : 1.92
                                : futurePivot
                                  ? 5.07
                                  : 4.92
                            : 1.67,
                        6,
                    )
                    expect(actual.otherNoteBeat).toBe(8)
                    expect(actual.otherNoteLeft - actual.noteLeft).toBeCloseTo(-1.9, 6)
                    expect(actual.pivotBeat).toBe(6)
                    expect(actual.pivotLane).toBeCloseTo(
                        layout === 'composed' && focus === 'note' ? 0.85 : 1.85,
                        8,
                    )
                    expect(actual.transformBeat).toBe(4)
                    expect(actual.xTranslation).toBeCloseTo(
                        layout === 'composed' && focus === 'note' ? 0.4 : 1.4,
                        8,
                    )
                }
            })
        }
    }
}
