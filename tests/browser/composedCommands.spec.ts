import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { show, fixtures, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 2, eventEase: 'linear' },
                    { ...pivot, beat: 8, pivotLane: 6, eventEase: 'linear' },
                ],
                slides: [
                    [{ ...base, beat: 2, left: -1, size: 2 }],
                    [{ ...base, beat: 6, left: 1, size: 2 }],
                ],
            },
            3,
        )
        view.layout = 'composed'
        settings.maxLane = 0
    })
})

for (const includeEvents of [false, true]) {
    test(`horizontal flip mirrors authored notes${includeEvents ? ' with selected stage events' : ''}`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (includeEvents) => {
            const { history, store, appImport } = window.editorTest
            const { flip } = await appImport<typeof import('../../src/editor/commands/flip')>(
                '/src/editor/commands/flip/index.ts',
            )
            const selected = [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' ||
                    (includeEvents && entity.type === 'stagePivotEventJoint'),
            )
            history.replaceState({ ...history.state.value, selectedEntities: selected })
            const positions = () => {
                const source = history.state.value
                return source.selectedEntities
                    .filter((entity) => entity.type === 'note')
                    .map(({ left, size }) => ({ left, size }))
            }
            const before = positions()
            flip.execute()
            const after = positions()
            flip.execute()
            return { before, after, restored: positions() }
        }, includeEvents)
        expect(result.after).toEqual(
            result.before.map(({ left, size }) => ({ left: -(left + size), size })),
        )
        expect(result.restored).toEqual(result.before)
    })
}

test('vertical flip preserves authored lanes across changing pivots and reverses twice', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { history, appImport } = window.editorTest
        const { flipVertical } = await appImport<
            typeof import('../../src/editor/commands/flipVertical')
        >('/src/editor/commands/flipVertical/index.ts')
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        const positions = () => {
            const source = history.state.value
            return source.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map((note) => ({ beat: note.beat, left: note.left }))
        }
        const before = positions()
        flipVertical.execute()
        const after = positions()
        flipVertical.execute()
        return { before, after, restored: positions() }
    })
    expect(result.after).toEqual(result.before.map(({ beat, left }) => ({ beat: 8 - beat, left })))
    expect(result.restored).toEqual(result.before)
})

test('make vertical uses authored coordinates and existing attachment materialization', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { history, fixtures, show, view, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 2 },
                    { ...pivot, beat: 8, pivotLane: 6 },
                ],
                stageTransformEvents: [{ ...transform, beat: 0, xTranslation: 3 }],
                slides: [
                    [
                        { ...base, beat: 2, left: -1, size: 2 },
                        { ...base, beat: 4, left: 0, isAttached: true, size: 2 },
                        { ...base, stageId: 2 as typeof base.stageId, beat: 6, left: 3, size: 4 },
                    ],
                ],
            },
            3,
        )
        view.layout = 'composed'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        const positions = () => {
            const source = history.state.value
            return source.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map((note) => ({
                    left: note.left,
                    size: note.size,
                    beat: note.beat,
                    attached: note.isAttached,
                }))
        }
        const before = positions()
        const { makeVertical } = await appImport<
            typeof import('../../src/editor/commands/makeVertical')
        >('/src/editor/commands/makeVertical/index.ts')
        makeVertical.execute()
        const after = positions()
        history.undoState()
        return { before, after, restored: positions() }
    })
    expect(result.after).toEqual([
        { left: -1, size: 2, beat: 2, attached: false },
        { left: -1, size: 3, beat: 2, attached: false },
        { left: 3, size: 4, beat: 2, attached: false },
    ])
    expect(result.restored).toEqual(result.before)
})

test('unchanged transforms of cross-stage attached notes preserve the state snapshot', async ({
    page,
}) => {
    const unchanged = await page.evaluate(async () => {
        const { history, fixtures, show, view, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [{ ...pivot, beat: 0, pivotLane: 4 }],
                slides: [
                    [
                        { ...base, beat: 2, left: -1, size: 2 },
                        { ...base, beat: 4, left: 0, size: 2, isAttached: true },
                        { ...base, stageId: 2 as typeof base.stageId, beat: 6, left: 1, size: 2 },
                    ],
                ],
            },
            3,
        )
        view.layout = 'composed'
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: notes })
        const source = history.state.value
        const { scaleSelection } = await appImport<
            typeof import('../../src/state/operations/scaleSelection')
        >('/src/state/operations/scaleSelection.ts')
        return scaleSelection(source, notes, 'width', 1) === source
    })
    expect(unchanged).toBe(true)
})
