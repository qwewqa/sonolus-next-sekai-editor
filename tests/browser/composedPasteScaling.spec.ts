import { expect, test, type Page } from '@playwright/test'
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
                    { ...pivot, stageId: base.stageId, beat: 0, pivotLane: 4, eventEase: 'linear' },
                    { ...pivot, stageId: base.stageId, beat: 8, pivotLane: 8, eventEase: 'linear' },
                    { ...pivot, stageId: 2 as typeof base.stageId, beat: 0, pivotLane: -3 },
                ],
                slides: [
                    [{ ...base, beat: 2, left: -1, size: 2 }],
                    [{ ...base, stageId: 2 as typeof base.stageId, beat: 4, left: 2, size: 2 }],
                ],
            },
            2,
        )
        view.layout = 'composed'
        settings.maxLane = 0
    })
})

const copy = (page: Page, events = false) =>
    page.evaluate(async (events) => {
        const { history, view, appImport, point, store } = window.editorTest
        const selectedEntities = [...store.getAllEntities()].filter(
            (entity) =>
                entity.type === 'note' || (events && entity.type === 'stagePivotEventJoint'),
        )
        history.replaceState({ ...history.state.value, selectedEntities })
        view.pointer = { ...view.pointer, ...point(5, 2) }
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        copy.execute()
    }, events)

const paste = (page: Page, lane: number, beatOffset: number, flip = false) =>
    page.evaluate(
        async ({ lane, beatOffset, flip }) => {
            const { appImport, view, point, history } = window.editorTest
            const module = await appImport<typeof import('../../src/editor/tools/paste')>(
                '/src/editor/tools/paste/index.ts',
            )
            const { clipboardEntry } =
                await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
            const { createComposedLayout } =
                await appImport<typeof import('../../src/editor/composed')>(
                    '/src/editor/composed.ts',
                )
            const data = clipboardEntry.value!.data!
            const target = point(lane, data.beat + beatOffset)
            module.paste.hover?.(target.x, target.y, { ctrl: false, shift: flip })
            const ghostState = module.pasteGhostState()!
            const ghostLayout = createComposedLayout(ghostState)
            const ghost = view.entities.creating
                .filter((entity) => entity.type === 'note')
                .map((note) => ({
                    beat: note.beat,
                    left: note.left,
                    stageId: note.stageId,
                    display: ghostLayout.notePosition(note).left,
                }))
            await module.pasteAtPosition(
                lane,
                beatOffset,
                { ctrl: false, shift: flip },
                { composed: true },
            )
            const layout = createComposedLayout(history.state.value)
            const landed = history.state.value.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map((note) => ({
                    beat: note.beat,
                    left: note.left,
                    stageId: note.stageId,
                    display: layout.notePosition(note).left,
                }))
            return {
                ghost,
                landed,
                clipboardRaw: data.chart.slides.flat().map(({ left }) => left),
                pivots: history.state.value.selectedEntities
                    .filter((entity) => entity.type === 'stagePivotEventJoint')
                    .map(({ pivotLane }) => pivotLane)
                    .sort((a, b) => a - b),
                hasGhost: module.pasteGhostState() !== undefined,
            }
        },
        { lane, beatOffset, flip },
    )

test('composed paste follows its grabbed anchor and preserves raw lane spacing across stages', async ({
    page,
}) => {
    await copy(page)
    const result = await paste(page, -1, 4)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ display }) => display)).toEqual([-2, -9])
    expect(result.landed.map(({ left }) => left)).toEqual([-9, -6])
    expect(result.clipboardRaw).toEqual([-1, 2])
    expect(result.hasGhost).toBe(false)
})

test('flipped composed paste mirrors raw lanes around the grabbed anchor', async ({ page }) => {
    await copy(page)
    const result = await paste(page, -1, 4, true)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ left }) => left)).toEqual([-9, -12])
    expect(result.landed.map(({ display }) => display)).toEqual([-2, -15])
})

test('composed paste accounts for focused stage overrides and pasted pivot events before placing notes', async ({
    page,
}) => {
    await copy(page, true)
    await page.evaluate(() => {
        window.editorTest.view.stageId = 2 as never
    })
    const result = await paste(page, -1, 4)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ stageId }) => stageId)).toEqual([2, 2])
    // At beat 6 the two pasted pivot tracks, both mapped to stage 2, give
    // offset -0.25 + delta. The anchor's displayed left is -1.25 + 2 * delta.
    // Inverting the target left -2 gives delta -0.375; raw edge snapping gives 0.
    expect(result.landed.map(({ left }) => left)).toEqual([-1, 2])
    expect(result.landed.map(({ display }) => display)).toEqual([-1.25, 4.5])
    expect(result.pivots).toEqual([-3, 4, 8])
})

test('copy keeps authored geometry across a new chart in either layout', async ({ page }) => {
    await copy(page)
    await page.evaluate(() => {
        const { show, fixtures, view } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true, slides: [] }, 2)
        view.layout = 'composed'
    })
    const result = await paste(page, -1, 4)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ display }) => display)).toEqual([-2, 1])
    const basic = await page.evaluate(async () => {
        const { view, appImport, history } = window.editorTest
        view.layout = 'basic'
        const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        await pasteAtPosition(0, 0, { ctrl: false, shift: false }, { composed: true })
        return history.state.value.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map(({ left }) => left)
    })
    expect(basic).toEqual([-1, 2])
})

test('Basic clipboard paste follows the composed anchor without changing raw spacing', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.view.layout = 'basic'
    })
    await copy(page)
    await page.evaluate(() => {
        window.editorTest.view.layout = 'composed'
    })
    const result = await paste(page, -1, 4)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ display }) => display)).toEqual([-2, -9])
})

test('context paste uses display coordinates and remains undoable', async ({ page }) => {
    await copy(page)
    const result = await page.evaluate(async () => {
        const { appImport, point, history } = window.editorTest
        const { pasteAtContextPosition } = await appImport<
            typeof import('../../src/editor/contextMenuPaste')
        >('/src/editor/contextMenuPaste.ts')
        const target = point(-1, 6)
        const pasted = await pasteAtContextPosition(target.x, target.y)
        return {
            pasted,
            notes: history.state.value.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map(({ left }) => left),
            undo: history.canUndo.value,
        }
    })
    expect(result).toEqual({ pasted: true, notes: [-9, -6], undo: true })
})

for (const grabbed of [false, true]) {
    for (const flip of [false, true]) {
        test(`context paste preserves the ${grabbed ? 'grabbed' : 'fallback'} anchor across layouts${flip ? ' when flipped' : ''}`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ grabbed, flip }) => {
                    const { appImport, fixtures, show, history, view, point } = window.editorTest
                    const { copy } = await appImport<
                        typeof import('../../src/editor/commands/copy')
                    >('/src/editor/commands/copy/index.ts')
                    const { clipboardEntry } =
                        await appImport<typeof import('../../src/clipboard')>(
                            '/src/clipboard/index.ts',
                        )
                    const { pasteAtContextPosition } = await appImport<
                        typeof import('../../src/editor/contextMenuPaste')
                    >('/src/editor/contextMenuPaste.ts')
                    const source = fixtures.interaction.slides[0]![0]!
                    const pivot = fixtures.events.stagePivotEvents[0]!
                    const results = []
                    for (const layout of ['basic', 'composed'] as const) {
                        show(
                            {
                                ...fixtures.interaction,
                                isDynamicStages: true,
                                stagePivotEvents: [
                                    { ...pivot, beat: 0, pivotLane: 4, eventEase: 'linear' },
                                    { ...pivot, beat: 8, pivotLane: 8, eventEase: 'linear' },
                                    { ...pivot, stageId: 2 as never, beat: 0, pivotLane: -3 },
                                ],
                                slides: [
                                    [{ ...source, beat: 2, left: -1, size: 2 }],
                                    [{ ...source, stageId: 2 as never, beat: 2, left: 2, size: 2 }],
                                ],
                            },
                            2,
                        )
                        view.layout = layout
                        history.replaceState({
                            ...history.state.value,
                            selectedEntities: [
                                ...history.state.value.store.slides.note.values(),
                            ].flat(),
                        })
                        // At the same beat the second note appears further left in Composed.
                        // Blank-space copying must still retain Basic's stable fallback anchor.
                        view.pointer = {
                            ...view.pointer,
                            ...point(grabbed ? (layout === 'basic' ? 3 : 0) : 15, grabbed ? 2 : 7),
                        }
                        copy.execute()
                        const entry = clipboardEntry.value!
                        const data = entry.data!
                        Object.defineProperty(navigator.clipboard, 'readText', {
                            configurable: true,
                            value: async () => entry.text,
                        })
                        const target = point(
                            1 + (layout === 'composed' ? (grabbed ? -3 : 7) : 0),
                            6,
                        )
                        const pasted = await pasteAtContextPosition(target.x, target.y, {
                            ctrl: false,
                            shift: flip,
                        })
                        results.push({
                            pasted,
                            lane: data.lane,
                            beat: data.beat,
                            notes: history.state.value.selectedEntities
                                .filter((entity) => entity.type === 'note')
                                .map(({ beat, left, size }) => ({ beat, left, size })),
                        })
                    }
                    return results
                },
                { grabbed, flip },
            )
            expect(result[1]).toEqual(result[0])
            expect(result[0]).toEqual({
                pasted: true,
                lane: grabbed ? 3 : 0,
                beat: 2,
                notes: (grabbed ? (flip ? [3, 0] : [-3, 0]) : flip ? [0, -3] : [0, 3]).map(
                    (left) => ({ beat: 6, left, size: 2 }),
                ),
            })
        })
    }
}

test('width scaling hits and resizes the projected edge', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, point } = window.editorTest
        const note = [...history.state.value.store.slides.note.values()].flat()[0]!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        const session = await appImport<
            typeof import('../../src/editor/commands/scaleSelection/session')
        >('/src/editor/commands/scaleSelection/session.ts')
        const { scalingTool } = await appImport<typeof import('../../src/editor/scaling/tool')>(
            '/src/editor/scaling/tool.ts',
        )
        const { getPreviewState } =
            await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
        session.beginScalingSession('width')
        const start = point(5.9, 2)
        const end = point(7.9, 2)
        const begun = scalingTool.dragStart?.(start.x, start.y, { ctrl: false, shift: false })
        scalingTool.dragUpdate?.(end.x, end.y, { ctrl: false, shift: false })
        scalingTool.dragEnd?.(end.x, end.y, { ctrl: false, shift: false })
        const draft = getPreviewState(history.state.value).selectedEntities.find(
            (entity) => entity.type === 'note',
        )!
        const factor = session.scalingSession.value?.factor
        session.cancelScalingSession()
        return { begun, factor, left: draft.left, size: draft.size, rawSize: note.size }
    })
    expect(result).toEqual({ begun: true, factor: 2, left: -1, size: 4, rawSize: 2 })
})

for (const events of [false, true]) {
    test(`width factors scale raw geometry${events ? ' alongside selected pivots' : ' across stages'}`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (events) => {
            const { appImport, history, store } = window.editorTest
            const selectedEntities = [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' || (events && entity.type === 'stagePivotEventJoint'),
            )
            history.replaceState({ ...history.state.value, selectedEntities })
            const session = await appImport<
                typeof import('../../src/editor/commands/scaleSelection/session')
            >('/src/editor/commands/scaleSelection/session.ts')
            const { getPreviewState } =
                await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
            const { createComposedLayout } =
                await appImport<typeof import('../../src/editor/composed')>(
                    '/src/editor/composed.ts',
                )
            session.beginScalingSession('width')
            const valid = session.setScalingFactor(2)
            const draft = getPreviewState(history.state.value)
            const layout = createComposedLayout(draft)
            const notes = draft.selectedEntities
                .filter((entity) => entity.type === 'note')
                .sort((a, b) => a.beat - b.beat)
                .map((note) => ({ left: layout.notePosition(note).left, size: note.size }))
            session.cancelScalingSession()
            return { valid, notes }
        }, events)
        expect(result).toEqual({
            valid: true,
            notes: events
                ? [
                      { left: 14, size: 4 },
                      { left: 4, size: 4 },
                  ]
                : [
                      { left: 4, size: 4 },
                      { left: 2, size: 4 },
                  ],
        })
    })
}

test('beat scaling keeps authored lanes while stage pivots slant the preview', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, fixtures, show, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivots = [...history.state.value.store.grid.stagePivotEventJoint.values()].flatMap(
            (bucket) => [...bucket],
        )
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: pivots,
                slides: [
                    [{ ...base, beat: 2, left: -1, size: 2 }],
                    [{ ...base, beat: 4, left: 2, size: 2 }],
                ],
            },
            2,
        )
        view.layout = 'composed'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        const session = await appImport<
            typeof import('../../src/editor/commands/scaleSelection/session')
        >('/src/editor/commands/scaleSelection/session.ts')
        const { getPreviewState } =
            await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        session.beginScalingSession('beat')
        const valid = session.setScalingFactor(2)
        const draft = getPreviewState(history.state.value)
        const layout = createComposedLayout(draft)
        const notes = draft.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map((note) => ({
                beat: note.beat,
                raw: note.left,
                display: layout.notePosition(note).left,
            }))
        session.cancelScalingSession()
        return { valid, notes }
    })
    expect(result).toEqual({
        valid: true,
        notes: [
            { beat: 2, raw: -1, display: 4 },
            { beat: 6, raw: 2, display: 9 },
        ],
    })
})

test('attached cross-stage slides preserve raw shape and parser ordering while projected shapes change', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { show, fixtures, history, view } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivots = [...history.state.value.store.grid.stagePivotEventJoint.values()].flatMap(
            (bucket) => [...bucket],
        )
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stagePivotEvents: pivots,
                slides: [
                    [
                        { ...base, beat: 2, left: -1, size: 2 },
                        { ...base, stageId: 2 as never, beat: 4, isAttached: true },
                        { ...base, stageId: 2 as never, beat: 6, left: 2, size: 2 },
                    ],
                    [{ ...base, stageId: 2 as never, beat: 4, left: 2, size: 2 }],
                ],
            },
            2,
        )
        view.layout = 'composed'
    })
    await copy(page)
    const result = await paste(page, -1, 4)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ display }) => display)).toEqual([-9, -2, -5, -9])
})

test('a dragged composed paste clamps at beat zero and commits exactly its ghost', async ({
    page,
}) => {
    await copy(page)
    const result = await page.evaluate(async () => {
        const { appImport, point, view, history } = window.editorTest
        const { paste, pasteGhostState } = await appImport<
            typeof import('../../src/editor/tools/paste')
        >('/src/editor/tools/paste/index.ts')
        const start = point(-1, 6)
        const end = point(-1, 0)
        const modifiers = { ctrl: false, shift: false }
        const begun = paste.dragStart?.(start.x, start.y, modifiers)
        paste.dragUpdate?.(end.x, end.y, modifiers)
        const ghost = view.entities.creating
            .filter((entity) => entity.type === 'note')
            .map(({ beat, left }) => ({ beat, left }))
        await paste.dragEnd?.(end.x, end.y, modifiers)
        return {
            begun,
            ghost,
            landed: history.state.value.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map(({ beat, left }) => ({ beat, left })),
            cleared: pasteGhostState() === undefined,
        }
    })
    expect(result.begun).toBe(true)
    expect(result.ghost).toEqual(result.landed)
    expect(result.landed.map(({ beat }) => beat)).toEqual([0, 2])
    expect(result.landed.map(({ left }) => left)).toEqual([-6, -3])
    expect(result.cleared).toBe(true)
})

test('cut retains authored lane spacing after removing the source notes and pivots', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, view, point, store } = window.editorTest
        const selectedEntities = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' || entity.type === 'stagePivotEventJoint',
        )
        history.replaceState({ ...history.state.value, selectedEntities })
        view.pointer = { ...view.pointer, ...point(5, 2) }
        const { cut } = await appImport<typeof import('../../src/editor/commands/cut')>(
            '/src/editor/commands/cut/index.ts',
        )
        cut.execute()
        return [...history.state.value.store.slides.note.values()].flat().length
    })
    expect(result).toBe(0)
    const pasted = await paste(page, -1, 4)
    expect(pasted.ghost).toEqual(pasted.landed)
    expect(pasted.landed.map(({ display }) => display)).toEqual([-2, -7])
    // Moving both the note and its pasted pivot by -3 moves the anchor by -6.
    expect(pasted.landed.map(({ left }) => left)).toEqual([-4, -1])
    expect(pasted.pivots).toEqual([-6, 1, 5])
})

test('a non-dynamic destination retains Basic paste coordinates', async ({ page }) => {
    await copy(page)
    const result = await page.evaluate(async () => {
        const { show, fixtures, appImport, history, view } = window.editorTest
        show({ ...fixtures.interaction, slides: [] })
        view.layout = 'composed'
        const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        await pasteAtPosition(0, 0, { ctrl: false, shift: false }, { composed: true })
        return history.state.value.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map(({ left }) => left)
    })
    expect(result).toEqual([-1, 2])
})

test('a Composed cut retains a raw anchor for a later Basic paste', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, view, point } = window.editorTest
        const note = [...history.state.value.store.slides.note.values()].flat()[0]!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        view.pointer = { ...view.pointer, ...point(5, 2) }
        const { cut } = await appImport<typeof import('../../src/editor/commands/cut')>(
            '/src/editor/commands/cut/index.ts',
        )
        cut.execute()
        view.layout = 'basic'
        const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        await pasteAtPosition(0, 0, { ctrl: false, shift: false }, { composed: true })
        return history.state.value.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map(({ left }) => left)
    })
    expect(result).toEqual([-1])
})

test('context paste aborts when its layout changes while reading the clipboard', async ({
    page,
}) => {
    await copy(page)
    const result = await page.evaluate(async () => {
        const { appImport, history, view, point } = window.editorTest
        const source = history.state.value
        const { clipboardEntry } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const text = clipboardEntry.value!.text
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => {
                view.layout = 'basic'
                return text
            },
        })
        const { pasteAtContextPosition } = await appImport<
            typeof import('../../src/editor/contextMenuPaste')
        >('/src/editor/contextMenuPaste.ts')
        const target = point(-1, 6)
        return {
            pasted: await pasteAtContextPosition(target.x, target.y),
            same: history.state.value === source,
        }
    })
    expect(result).toEqual({ pasted: false, same: true })
})
