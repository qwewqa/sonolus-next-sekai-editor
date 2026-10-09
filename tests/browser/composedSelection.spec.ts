import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 0, eventEase: 'linear' },
                    { ...pivot, beat: 8, pivotLane: 8, eventEase: 'linear' },
                    {
                        ...pivot,
                        stageId: 2 as typeof pivot.stageId,
                        beat: 0,
                        pivotLane: -4,
                        eventEase: 'linear',
                    },
                    {
                        ...pivot,
                        stageId: 2 as typeof pivot.stageId,
                        beat: 8,
                        pivotLane: -8,
                        eventEase: 'linear',
                    },
                ],
                slides: [
                    [{ ...base, beat: 4, left: -2, size: 2 }],
                    [{ ...base, stageId: 2 as typeof base.stageId, beat: 4, left: 2, size: 2 }],
                ],
            },
            3,
        )
        view.layout = 'composed'
        view.snapping = 'absolute'
        view.laneDivision = 4
        view.laneSnapping = 'relative'
        settings.width = 32
    })
})

test('point, box, brush, and eraser target projected notes, with scope filtering', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, point, view } = window.editorTest
        const { hitEntitiesAtPoint, hitAllEntitiesInSelection } = await appImport<
            typeof import('../../src/editor/tools/utils')
        >('/src/editor/tools/utils.ts')
        const hits = (lane: number) => {
            const p = point(lane, 4)
            return hitEntitiesAtPoint('note', p.x, p.y).map((note) => note.stageId)
        }
        const atDisplayed = hits(3)
        const atRaw = hits(-1)
        const boxed = hitAllEntitiesInSelection({
            laneMin: 1.9,
            laneMax: 4.1,
            timeMin: 1.9,
            timeMax: 2.1,
        }).filter((entity) => entity.type === 'note').length
        view.stageId = 2 as typeof view.stageId
        return { atDisplayed, atRaw, boxed, hidden: hits(3) }
    })
    expect(result).toEqual({ atDisplayed: [1], atRaw: [], boxed: 1, hidden: [] })
    await page.evaluate(async () => {
        const { view, appImport, point } = window.editorTest
        view.stageId = undefined
        const { brush, brushProperties } = await appImport<
            typeof import('../../src/editor/tools/brush')
        >('/src/editor/tools/brush/index.ts')
        brushProperties.value = { isCritical: true }
        const p = point(3, 4)
        brush.tap!(p.x, p.y, { ctrl: false, shift: false })
    })
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()]
                .flat()
                .map((note) => note.isCritical),
        ),
    ).toEqual([true, false])
    await page.evaluate(async () => {
        const { appImport, point } = window.editorTest
        const { eraser } = await appImport<typeof import('../../src/editor/tools/eraser')>(
            '/src/editor/tools/eraser.ts',
        )
        const p = point(3, 4)
        eraser.tap!(p.x, p.y, { ctrl: false, shift: false })
    })
    expect(await page.evaluate(() => window.editorTest.snapshot().notes.length)).toBe(1)
})

test('select moves multiple stages through different pivots and restores with undo', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    await page.keyboard.press('f')
    const { start, end } = await page.evaluate(() => ({
        start: window.editorTest.point(3, 4),
        end: window.editorTest.point(4, 6),
    }))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual([
        { type: 'note', beat: 6, left: -3, size: 2 },
        { type: 'note', beat: 6, left: 1, size: 2 },
    ])
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() => window.editorTest.snapshot().notes.map((note) => note.left)),
    ).toEqual([-2, 2])
})

test('select resizing uses the displayed edge and keeps the beat fixed', async ({ page }) => {
    await page.keyboard.press('f')
    const { start, end } = await page.evaluate(() => ({
        start: window.editorTest.point(3.95, 4),
        end: window.editorTest.point(5.95, 6),
    }))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.snapshot().selected[0])).toEqual({
        type: 'note',
        beat: 4,
        left: -2,
        size: 4,
    })
})

test('moving a note together with its pivot events composes only once', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { history, appImport, point } = window.editorTest
        const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
            '/src/editor/tools/select.ts',
        )
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat()[0]!
        const pivots = [
            ...new Set(
                [...source.store.grid.stagePivotEventJoint.values()].flatMap((bucket) => [
                    ...bucket,
                ]),
            ),
        ].filter((event) => event.stageId === note.stageId)
        history.replaceState({ ...source, selectedEntities: [note, ...pivots] })
        const start = point(3, 4)
        const end = point(5, 4)
        const modifiers = { ctrl: false, shift: false }
        select.dragStart!(start.x, start.y, modifiers)
        select.dragUpdate!(end.x, end.y, modifiers)
        const { sceneState } = await appImport<typeof import('../../src/editor/sceneState')>(
            '/src/editor/sceneState.ts',
        )
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        const preview = sceneState.value
        const previewNote = [...preview.store.slides.note.values()].flat()[0]!
        const previewLeft = createComposedLayout(preview).noteLeft(previewNote)
        await select.dragEnd!(end.x, end.y, modifiers)
        const after = history.state.value
        const afterNote = [...after.store.slides.note.values()].flat()[0]!
        return {
            previewLeft,
            finalLeft: createComposedLayout(after).noteLeft(afterNote),
            rawLeft: afterNote.left,
        }
    })
    expect(result).toEqual({ previewLeft: 4, finalLeft: 4, rawLeft: -1 })
})

test('attached cross-stage notes hit at their interpolated stage position', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { fixtures, show, view, appImport, point, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 4 },
                    { ...pivot, stageId: 2 as typeof pivot.stageId, beat: 0, pivotLane: -4 },
                ],
                slides: [
                    [
                        { ...base, beat: 2, left: -2, size: 2 },
                        { ...base, beat: 4, left: 0, size: 2, isAttached: true },
                        { ...base, stageId: 2 as typeof base.stageId, beat: 6, left: 2, size: 2 },
                    ],
                ],
            },
            3,
        )
        view.layout = 'composed'
        const attached = [...history.state.value.store.slides.note.values()]
            .flat()
            .find((note) => note.isAttached)!
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        const layout = createComposedLayout(history.state.value)
        const p = point(layout.noteLeft(attached) + 1, 4)
        const { hitEntitiesAtPoint } = await appImport<
            typeof import('../../src/editor/tools/utils')
        >('/src/editor/tools/utils.ts')
        return {
            left: layout.noteLeft(attached),
            hits: hitEntitiesAtPoint('note', p.x, p.y).map((note) => note.isAttached),
        }
    })
    expect(result).toEqual({ left: 0, hits: [true] })
})

test('moving a BPM with an attached slide retains rebuilt note identities', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { fixtures, show, view, appImport, point, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 3, bpm: 60 },
                ],
                stagePivotEvents: [{ ...pivot, beat: 0, pivotLane: 3 }],
                slides: [
                    [
                        { ...base, beat: 2, left: -2, size: 2 },
                        { ...base, beat: 4, left: 0, size: 2, isAttached: true },
                        { ...base, beat: 8, left: 4, size: 2 },
                    ],
                ],
            },
            3,
        )
        view.layout = 'composed'
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        const bpm = [...source.store.grid.bpm.values()]
            .flatMap((bucket) => [...bucket])
            .find((event) => event.beat === 3)!
        history.replaceState({ ...source, selectedEntities: [...notes, bpm] })
        const { select } = await appImport<typeof import('../../src/editor/tools/select')>(
            '/src/editor/tools/select.ts',
        )
        const { sceneState } = await appImport<typeof import('../../src/editor/sceneState')>(
            '/src/editor/sceneState.ts',
        )
        const start = point(2, 2)
        const end = point(3, 3)
        const modifiers = { ctrl: false, shift: false }
        select.dragStart!(start.x, start.y, modifiers)
        select.dragUpdate!(end.x, end.y, modifiers)
        const previewNotes = [...sceneState.value.store.slides.note.values()]
            .flat()
            .map(({ beat, left }) => ({ beat, left }))
        await select.dragEnd!(end.x, end.y, modifiers)
        const final = history.state.value
        const finalNotes = [...final.store.slides.note.values()]
            .flat()
            .map(({ beat, left }) => ({ beat, left }))
        const validSelection = final.selectedEntities.every(
            (entity) =>
                entity.type !== 'note' ||
                final.store.slides.note.get(entity.slideId)?.includes(entity),
        )
        history.undoState()
        return {
            previewNotes,
            finalNotes,
            expected: notes.map(({ beat, left }) => ({ beat: beat + 1, left: left + 1 })),
            selectedCount: final.selectedEntities.length,
            validSelection,
            undoNotes: [...history.state.value.store.slides.note.values()]
                .flat()
                .map(({ beat, left }) => ({ beat, left })),
            originalNotes: notes.map(({ beat, left }) => ({ beat, left })),
        }
    })
    expect(result.previewNotes).toEqual(result.expected)
    expect(result.finalNotes).toEqual(result.expected)
    expect(result.selectedCount).toBe(4)
    expect(result.validSelection).toBe(true)
    expect(result.undoNotes).toEqual(result.originalNotes)
})
