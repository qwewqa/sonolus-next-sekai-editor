import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

for (const cut of [false, true]) {
    for (const legacy of [false, true]) {
        test(`${cut ? 'cut' : 'copy'} same-beat attachments survive context paste, layout changes and history (${legacy ? 'legacy clipboard' : 'anchor metadata'})`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ cut, legacy }) => {
                    const {
                        appImport,
                        fixtures,
                        show,
                        history,
                        store,
                        view,
                        point,
                        settings,
                        nextTick,
                    } = window.editorTest
                    const { copy } = await appImport<
                        typeof import('../../src/editor/commands/copy')
                    >('/src/editor/commands/copy/index.ts')
                    const { cut: cutCommand } = await appImport<
                        typeof import('../../src/editor/commands/cut')
                    >('/src/editor/commands/cut/index.ts')
                    const { clipboardEntry, setClipboardData } =
                        await appImport<typeof import('../../src/clipboard')>(
                            '/src/clipboard/index.ts',
                        )
                    const { pasteAtContextPosition } = await appImport<
                        typeof import('../../src/editor/contextMenuPaste')
                    >('/src/editor/contextMenuPaste.ts')
                    const { serializeToLevelData } = await appImport<
                        typeof import('../../src/levelData/serialize')
                    >('/src/levelData/serialize.ts')
                    const { parseLevelDataChart } = await appImport<
                        typeof import('../../src/chart/parse/levelData')
                    >('/src/chart/parse/levelData/index.ts')
                    const { createState } =
                        await appImport<typeof import('../../src/state')>('/src/state/index.ts')
                    const { createComposedLayout } =
                        await appImport<typeof import('../../src/editor/composed')>(
                            '/src/editor/composed.ts',
                        )
                    const base = fixtures.interaction.slides[0]![0]!
                    const secondStage = 2 as typeof base.stageId
                    const pivot = fixtures.events.stagePivotEvents[0]!
                    show({
                        ...fixtures.interaction,
                        isDynamicStages: true,
                        stagePivotEvents: [
                            { ...pivot, beat: 0, pivotLane: 1.5 },
                            { ...pivot, beat: 0, stageId: secondStage, pivotLane: -2.25 },
                        ],
                        slides: [
                            [
                                {
                                    ...base,
                                    beat: 4,
                                    left: -2,
                                    size: 1,
                                    elevation: 0,
                                    connectorType: 'guide',
                                    connectorStyle: 'green',
                                    connectorGuideAlpha: 0,
                                    connectorEase: 'inQuad',
                                },
                                {
                                    ...base,
                                    beat: 4,
                                    left: 0,
                                    size: 1,
                                    elevation: 1,
                                    stageId: secondStage,
                                    isAttached: true,
                                    isConnectorSeparator: true,
                                    connectorGuideAlpha: 0.2,
                                },
                                {
                                    ...base,
                                    beat: 4,
                                    left: 0,
                                    size: 1,
                                    elevation: 6,
                                    stageId: secondStage,
                                    isAttached: true,
                                    isConnectorSeparator: true,
                                    connectorGuideAlpha: 0.6,
                                },
                                {
                                    ...base,
                                    beat: 4,
                                    left: 3,
                                    size: 3,
                                    elevation: 4,
                                    stageId: secondStage,
                                    connectorGuideAlpha: 1,
                                },
                            ],
                        ],
                    })
                    settings.maxLane = 0
                    view.layout = 'composed'
                    await nextTick()
                    const serialize = () => {
                        const s = history.state.value
                        return serializeToLevelData(
                            s.initialLife,
                            s.isDynamicStages,
                            s.bgm.offset,
                            s.store,
                            s.groups,
                            s.stages,
                        )
                    }
                    const noteSignature = (s: typeof history.state.value) =>
                        [...s.store.slides.note.values()].flat().map((n) => ({
                            beat: n.beat,
                            left: n.left,
                            size: n.size,
                            elevation: n.elevation,
                            attached: n.isAttached,
                            separator: n.isConnectorSeparator,
                            stage: s.stages.get(n.stageId)?.name,
                            group: s.groups.get(n.groupId)?.name,
                        }))
                    const selected = [...store.getAllEntities()].filter(
                        (entity) =>
                            entity.type === 'note' ||
                            (entity.type === 'stagePivotEventJoint' &&
                                entity.stageId === base.stageId),
                    )
                    history.replaceState({ ...history.state.value, selectedEntities: selected })
                    const notes = selected.filter((entity) => entity.type === 'note')
                    const displayed = createComposedLayout(history.state.value).notePosition(
                        notes[1]!,
                    )
                    view.pointer = {
                        ...view.pointer,
                        ...point(displayed.left + displayed.size / 2, 4),
                    }
                    const before = serialize()
                    if (cut) cutCommand.execute()
                    else copy.execute()
                    const afterClipboardOperation = serialize()
                    const payload = JSON.parse(clipboardEntry.value!.text)
                    if (legacy) delete payload.anchor
                    setClipboardData(payload)
                    const text = clipboardEntry.value!.text
                    Object.defineProperty(navigator.clipboard, 'readText', {
                        configurable: true,
                        value: async () => text,
                    })
                    view.layout = 'basic'
                    await nextTick()
                    const target = point(2, 8)
                    const pasted = await pasteAtContextPosition(target.x, target.y)
                    const afterPaste = serialize()
                    const selectedHeights = history.state.value.selectedEntities
                        .filter((entity) => entity.type === 'note')
                        .map((note) => note.elevation)
                    const savedSignature = noteSignature(history.state.value)
                    const imported = createState(
                        parseLevelDataChart(afterPaste.entities),
                        afterPaste.bgmOffset,
                    )
                    const importedSignature = noteSignature(imported)
                    view.layout = 'composed'
                    await nextTick()
                    history.undoState()
                    const undonePaste = serialize()
                    if (cut) history.undoState()
                    const undoneCut = serialize()
                    view.layout = 'basic'
                    if (cut) history.redoState()
                    history.redoState()
                    const redone = serialize()
                    return {
                        pasted,
                        before,
                        afterClipboardOperation,
                        afterPaste,
                        selectedHeights,
                        savedSignature,
                        importedSignature,
                        undonePaste,
                        undoneCut,
                        redone,
                    }
                },
                { cut, legacy },
            )
            expect(result.pasted).toBe(true)
            expect(result.selectedHeights).toEqual([0, 1, 6, 4])
            expect(result.importedSignature).toEqual(result.savedSignature)
            expect(result.undonePaste).toEqual(result.afterClipboardOperation)
            expect(result.undoneCut).toEqual(result.before)
            expect(result.redone).toEqual(result.afterPaste)
        })
    }
}

test('clipboard mappings refresh after loading a different chart and editing its group and stage targets', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, show, history, view, point, settings, nextTick } =
            window.editorTest
        const { copy, getClipboardAnchor } = await appImport<
            typeof import('../../src/editor/commands/copy')
        >('/src/editor/commands/copy/index.ts')
        const { clipboardEntry, setClipboardData } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const { getPasteNoteEntities, pasteAtPosition } = await appImport<
            typeof import('../../src/editor/tools/paste')
        >('/src/editor/tools/paste/index.ts')
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        const groupA = 1 as typeof base.groupId
        const groupB = 2 as typeof base.groupId
        const stageA = 1 as typeof base.stageId
        const stageB = 2 as typeof base.stageId
        const stage = fixtures.interaction.stages.values().next().value!
        show({
            ...fixtures.interaction,
            isDynamicStages: true,
            groups: new Map([
                [groupA, { name: 'Source A' }],
                [groupB, { name: 'Source B' }],
            ]),
            stages: new Map([
                [stageA, { ...stage, name: 'Source A' }],
                [stageB, { ...stage, name: 'Source B' }],
            ]),
            stagePivotEvents: [{ ...pivot, stageId: stageA, beat: 0, pivotLane: 3 }],
            slides: [
                [
                    {
                        ...base,
                        beat: 4,
                        left: 0,
                        size: 2,
                        elevation: 0,
                        groupId: groupA,
                        stageId: stageA,
                    },
                    {
                        ...base,
                        beat: 4,
                        left: 1,
                        size: 2,
                        elevation: 1,
                        groupId: groupB,
                        stageId: stageB,
                        isAttached: true,
                    },
                    {
                        ...base,
                        beat: 4,
                        left: 4,
                        size: 2,
                        elevation: 4,
                        groupId: groupB,
                        stageId: stageB,
                    },
                ],
            ],
        })
        settings.maxLane = 0
        view.layout = 'composed'
        await nextTick()
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: notes })
        view.pointer = { ...view.pointer, ...point(4, 4) }
        copy.execute()
        const payload = JSON.parse(clipboardEntry.value!.text)
        payload.anchor = getClipboardAnchor(notes, payload.entities, notes[0])
        setClipboardData(payload)
        getPasteNoteEntities() // Warm the mapping cache against the source chart.
        const results = []
        for (const dynamic of [false, true]) {
            const destGroupA = 9 as typeof groupA
            const destGroupB = 10 as typeof groupA
            const destStageA = 7 as typeof stageA
            const destStageB = 8 as typeof stageA
            show({
                ...fixtures.interaction,
                isDynamicStages: dynamic,
                slides: [],
                groups: new Map([
                    [destGroupA, { name: 'Destination A' }],
                    [destGroupB, { name: 'Destination B' }],
                ]),
                stages: new Map([
                    [destStageA, { ...stage, name: 'Destination A' }],
                    [destStageB, { ...stage, name: 'Destination B' }],
                ]),
                stagePivotEvents: dynamic
                    ? [{ ...pivot, stageId: destStageB, beat: 0, pivotLane: -2 }]
                    : [],
            })
            view.layout = 'composed'
            view.groupId = destGroupB
            view.stageId = destStageB
            await nextTick()
            const mapped = getPasteNoteEntities().map((note) => [note.groupId, note.stageId])
            await pasteAtPosition(2, 4, { ctrl: false, shift: false }, { composed: true })
            const pasted = history.state.value.selectedEntities.filter(
                (entity) => entity.type === 'note',
            )
            const focus = pasted[0]!
            const position = dynamic
                ? createComposedLayout(history.state.value).notePosition(focus)
                : focus
            results.push({
                dynamic,
                mapped,
                targets: pasted.map((note) => [note.groupId, note.stageId]),
                heights: pasted.map((note) => note.elevation),
                displayCenter: position.left + position.size / 2,
            })
        }
        return results
    })
    for (const item of result) {
        expect(item.mapped).toEqual([
            [9, 7],
            [10, 8],
            [10, 8],
        ])
        expect(item.targets).toEqual([
            [10, item.dynamic ? 8 : 7],
            [10, 8],
            [10, 8],
        ])
        expect(item.heights).toEqual([0, 1, 4])
        expect(item.displayCenter).toBeCloseTo(2, 9)
    }
})
