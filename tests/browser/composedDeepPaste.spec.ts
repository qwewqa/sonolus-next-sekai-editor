import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('static context paste ignores a layout preference change while clipboard is read', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, view, point } = window.editorTest
        const notes = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: [notes[0]!] })
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        copy.execute()
        const { clipboardEntry } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const text = clipboardEntry.value!.text
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => {
                view.layout = 'composed'
                return text
            },
        })
        const { pasteAtContextPosition } = await appImport<
            typeof import('../../src/editor/contextMenuPaste')
        >('/src/editor/contextMenuPaste.ts')
        const target = point(1, 6)
        return {
            pasted: await pasteAtContextPosition(target.x, target.y),
            count: [...history.state.value.store.slides.note.values()].flat().length,
        }
    })
    expect(result).toEqual({ pasted: true, count: 5 })
})

test('pastes ignore legacy composed coordinates, including cross-stage attached slides', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, show, fixtures, view } = window.editorTest
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { clipboardEntry, setClipboardData } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.interaction,
            isDynamicStages: true,
            stagePivotEvents: fixtures.events.stagePivotEvents,
            slides: [
                [
                    { ...base, beat: 2 },
                    { ...base, beat: 3, stageId: 2 as never, isAttached: true },
                    { ...base, beat: 5, left: 4 },
                ],
            ],
        })
        view.layout = 'composed'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        copy.execute()
        const legacy = JSON.parse(clipboardEntry.value!.text)
        const composed = {
            ...legacy,
            // Old clipboard exports may retain projected positions. These must
            // not replace authored lanes, even when pasting into Composed.
            composed: {
                lane: 1234,
                notes: legacy.entities.flatMap(
                    (entity: { data: { name: string }[] }, index: number) =>
                        entity.data.some((property) => property.name === '#TIMESCALE_GROUP') &&
                        entity.data.some((property) => property.name === 'lane')
                            ? [{ entity: index, left: 999, size: 99 }]
                            : [],
                ),
            },
        }
        const results: string[] = []
        for (const [dynamic, layout] of [
            [true, 'basic'],
            [true, 'composed'],
            [false, 'basic'],
            [false, 'composed'],
        ] as const) {
            const snapshots = []
            for (const data of [legacy, composed]) {
                show({ ...fixtures.interaction, isDynamicStages: dynamic, slides: [] })
                view.layout = layout
                setClipboardData(data)
                await pasteAtPosition(1, 3, { ctrl: false, shift: true }, { composed: true })
                snapshots.push(
                    JSON.stringify(
                        history.state.value.selectedEntities
                            .filter((entity) => entity.type === 'note')
                            .map(({ left, size, beat, isAttached, stageId }) => ({
                                left,
                                size,
                                beat,
                                isAttached,
                                stageId,
                            })),
                    ),
                )
            }
            if (snapshots[0] !== snapshots[1]) results.push(`${dynamic} ${layout}`)
        }
        return results
    })
    expect(result).toEqual([])
})

test('composed attached width drags enforce raw lane limits across different stage translations', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, show, fixtures, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                stageTransformEvents: [
                    { ...transform, stageId: base.stageId, beat: 0, xTranslation: 8 },
                    { ...transform, stageId: 2 as never, beat: 0, xTranslation: -8 },
                ],
                slides: [
                    [
                        { ...base, beat: 0, left: 0, size: 2 },
                        { ...base, beat: 1, left: 0, size: 2, isAttached: true },
                        { ...base, stageId: 2 as never, beat: 4, left: 0, size: 2 },
                    ],
                ],
            },
            1,
        )
        view.layout = 'composed'
        settings.maxLane = 6
        const selected = [...history.state.value.store.slides.note.values()].flat()
        history.replaceState({ ...history.state.value, selectedEntities: selected })
        const session = await appImport<
            typeof import('../../src/editor/commands/scaleSelection/session')
        >('/src/editor/commands/scaleSelection/session.ts')
        const { getPreviewState } =
            await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        session.beginScalingSession('width')
        const begun = session.beginScalingDrag(selected[1]!, 5)
        session.updateScalingDrag(13)
        const draft = getPreviewState(history.state.value)
        const note = draft.selectedEntities.find(
            (entity) => entity.type === 'note' && entity.beat === 1,
        )!
        if (note.type !== 'note') throw new Error('Missing note')
        const left = createComposedLayout(draft).notePosition(note).left
        session.cancelScalingSession()
        return {
            begun,
            left,
            raw: draft.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map((note) => note.left),
            attached: note.isAttached,
        }
    })
    expect(result).toEqual({ begun: true, left: 8, raw: [4, 4, 4], attached: true })
})
