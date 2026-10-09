import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('copy identifies the grabbed note when raw coordinates coincide across stages', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, show, history, view, point, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [{ ...base, beat: 2, left: 0, size: 2 }],
                    [{ ...base, stageId: 2 as never, beat: 2, left: 0, size: 2 }],
                ],
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 0 },
                    { ...pivot, stageId: 2 as never, beat: 0, pivotLane: 8 },
                ],
            },
            1,
        )
        settings.maxLane = 0
        view.layout = 'composed'
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        view.pointer = { ...view.pointer, ...point(9, 2) }
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { clipboardEntry, setClipboardData } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const { pasteAtPosition, paste, pasteGhostState } = await appImport<
            typeof import('../../src/editor/tools/paste')
        >('/src/editor/tools/paste/index.ts')
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        copy.execute()
        const payload = JSON.parse(clipboardEntry.value!.text)
        // Force a parse round-trip, preserving only serialized raw data and anchor identity.
        setClipboardData({ ...payload, source: { ...payload.source, extra: true } })
        const anchor = clipboardEntry.value!.data!.anchor
        const target = point(10, 4)
        paste.hover?.(target.x, target.y, { ctrl: false, shift: false })
        const shown = pasteGhostState()!
            .selectedEntities.filter((entity) => entity.type === 'note')
            .map(({ left }) => left)
        await pasteAtPosition(10, 2, { ctrl: false, shift: false }, { composed: true })
        const layout = createComposedLayout(history.state.value)
        return {
            hasAnchor: Number.isInteger(payload.anchor),
            anchor,
            shown,
            raw: history.state.value.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map(({ left }) => left),
            displayed: history.state.value.selectedEntities
                .filter((entity) => entity.type === 'note')
                .map((note) => layout.notePosition(note).left),
            noDisplayMetadata: payload.composed === undefined,
        }
    })
    expect(result).toEqual({
        hasAnchor: true,
        anchor: 1,
        shown: [1, 1],
        raw: [1, 1],
        displayed: [1, 9],
        noDisplayMetadata: true,
    })
})

test('legacy or out-of-range anchor metadata keeps raw clipboard content usable', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { clipboardEntry, setClipboardData } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        copy.execute()
        const payload = JSON.parse(clipboardEntry.value!.text)
        const results = []
        for (const anchor of [undefined, 999999, 0]) {
            setClipboardData({ ...payload, anchor })
            results.push({
                valid: !!clipboardEntry.value?.data,
                anchor: clipboardEntry.value?.data?.anchor ?? null,
                notes: clipboardEntry.value?.data?.chart.slides.flat().length,
            })
        }
        return results
    })
    expect(result).toEqual([
        { valid: true, anchor: null, notes: 4 },
        { valid: true, anchor: null, notes: 4 },
        { valid: true, anchor: null, notes: 4 },
    ])
})

test('Composed paste snaps one raw anchor for odd/even widths, stage parity and subdivisions', async ({
    page,
}) => {
    const failures = await page.evaluate(async () => {
        const { appImport, fixtures, show, history, view, point, settings } = window.editorTest
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { pasteAtPosition, paste, pasteGhostState } = await appImport<
            typeof import('../../src/editor/tools/paste')
        >('/src/editor/tools/paste/index.ts')
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        const failures: string[] = []
        settings.maxLane = 0
        for (const parity of ['even', 'odd'] as const)
            for (const divisionSize of [2, 3])
                for (const size of [1, 2, 1.5])
                    for (const division of [1, 2, 4])
                        for (const flip of [false, true]) {
                            const phase = parity === 'odd' && divisionSize % 2 === 1 ? 0.5 : 0
                            show(
                                {
                                    ...fixtures.interaction,
                                    isDynamicStages: true,
                                    slides: [
                                        [{ ...base, beat: 2, left: -1, size }],
                                        [
                                            {
                                                ...base,
                                                stageId: 2 as never,
                                                beat: 4,
                                                left: 2,
                                                size: 2,
                                            },
                                        ],
                                    ],
                                    stagePivotEvents: [
                                        {
                                            ...pivot,
                                            beat: 0,
                                            pivotLane: 0.25,
                                            divisionParity: parity,
                                            divisionSize,
                                        },
                                        { ...pivot, stageId: 2 as never, beat: 0, pivotLane: -2 },
                                    ],
                                },
                                2,
                            )
                            view.layout = 'composed'
                            view.laneDivision = division
                            history.replaceState({
                                ...history.state.value,
                                selectedEntities: [
                                    ...history.state.value.store.slides.note.values(),
                                ].flat(),
                            })
                            view.pointer = { ...view.pointer, ...point(-1 + size / 2 + 0.25, 2) }
                            copy.execute()
                            const pointer = 0.25 + size / 2 + 0.31
                            const target = point(pointer, 6)
                            paste.hover?.(target.x, target.y, { ctrl: false, shift: flip })
                            const ghost = pasteGhostState()!
                                .selectedEntities.filter((entity) => entity.type === 'note')
                                .map(({ left }) => left)
                            await pasteAtPosition(
                                pointer,
                                4,
                                { ctrl: false, shift: flip },
                                { composed: true },
                            )
                            const notes = history.state.value.selectedEntities.filter(
                                (entity) => entity.type === 'note',
                            )
                            const expected =
                                phase + Math.round((0.31 - phase) * division) / division
                            const rawDifference = flip ? size - 5 : 3
                            if (
                                Math.abs(notes[0]!.left - expected) > 1e-8 ||
                                Math.abs(notes[1]!.left - notes[0]!.left - rawDifference) > 1e-8 ||
                                ghost.some(
                                    (left, index) => Math.abs(left - notes[index]!.left) > 1e-8,
                                )
                            )
                                failures.push(
                                    `${parity}/${divisionSize}/${size}/${division}/${flip}`,
                                )
                        }
        return failures
    })
    expect(failures).toEqual([])
})

for (const transform of [false, true])
    for (const flip of [false, true])
        test(`mixed paste applies one raw translation to notes and controls (${transform ? 'pivot + transform' : 'pivot'}, flip ${flip})`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ transform, flip }) => {
                    const { appImport, fixtures, show, history, view, point, settings, store } =
                        window.editorTest
                    const base = fixtures.interaction.slides[0]![0]!
                    show(
                        {
                            ...fixtures.interaction,
                            isDynamicStages: true,
                            slides: [
                                [{ ...base, beat: 2, left: 0, size: 2 }],
                                [{ ...base, beat: 3, left: 3, size: 1 }],
                            ],
                            stagePivotEvents: [
                                { ...fixtures.events.stagePivotEvents[0]!, beat: 0, pivotLane: 4 },
                            ],
                            stageTransformEvents: transform
                                ? [
                                      {
                                          ...fixtures.events.stageTransformEvents[0]!,
                                          beat: 0,
                                          xTranslation: 2,
                                      },
                                  ]
                                : [],
                        },
                        2,
                    )
                    settings.maxLane = 0
                    view.layout = 'composed'
                    view.laneDivision = 1
                    history.replaceState({
                        ...history.state.value,
                        selectedEntities: [...store.getAllEntities()].filter(
                            (entity) =>
                                entity.type === 'note' ||
                                entity.type === 'stagePivotEventJoint' ||
                                entity.type === 'stageTransformEventJoint',
                        ),
                    })
                    view.pointer = { ...view.pointer, ...point(5 + (transform ? 2 : 0), 2) }
                    const { copy } = await appImport<
                        typeof import('../../src/editor/commands/copy')
                    >('/src/editor/commands/copy/index.ts')
                    const { pasteAtPosition, paste, pasteGhostState } = await appImport<
                        typeof import('../../src/editor/tools/paste')
                    >('/src/editor/tools/paste/index.ts')
                    const { createComposedLayout } =
                        await appImport<typeof import('../../src/editor/composed')>(
                            '/src/editor/composed.ts',
                        )
                    copy.execute()
                    // Flip around raw anchor center 1 first. Moving each authored
                    // coordinate by 2 moves the displayed anchor by 4 or 6 lanes.
                    const pivotBase = flip ? -2 : 4
                    const translationBase = transform ? (flip ? 0 : 2) : 0
                    const destination = pivotBase + translationBase + 1 + (transform ? 3 : 2) * 2
                    const target = point(destination, 6)
                    paste.hover?.(target.x, target.y, { ctrl: false, shift: flip })
                    const ghost = pasteGhostState()!
                    await pasteAtPosition(
                        destination,
                        4,
                        { ctrl: false, shift: flip },
                        { composed: true },
                    )
                    const snapshot = (source: typeof history.state.value) => {
                        const layout = createComposedLayout(source)
                        return source.selectedEntities.map((entity) => {
                            switch (entity.type) {
                                case 'note':
                                    return {
                                        type: entity.type,
                                        value: entity.left,
                                        display: layout.notePosition(entity).left,
                                    }
                                case 'stagePivotEventJoint':
                                    return { type: entity.type, value: entity.pivotLane }
                                case 'stageTransformEventJoint':
                                    return { type: entity.type, value: entity.xTranslation }
                                default:
                                    return { type: entity.type }
                            }
                        })
                    }
                    return {
                        ghost: snapshot(ghost),
                        committed: snapshot(history.state.value),
                        destination,
                    }
                },
                { transform, flip },
            )
            expect(result.ghost).toEqual(result.committed)
            expect(
                result.committed
                    .filter((entity) => entity.type === 'note')
                    .map((entity) => entity.value),
            ).toEqual([2, flip ? 0 : 5])
            expect(
                result.committed.find((entity) => entity.type === 'stagePivotEventJoint')?.value,
            ).toBe(flip ? 0 : 6)
            if (transform)
                expect(
                    result.committed.find((entity) => entity.type === 'stageTransformEventJoint')
                        ?.value,
                ).toBe(flip ? 2 : 4)
            expect(result.committed.find((entity) => entity.type === 'note')?.display).toBe(
                result.destination - 1,
            )
        })

test('mixed paste inverts the partial influence of a copied pivot before snapping', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, show, history, view, point, settings, store } =
            window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [[{ ...base, beat: 2, left: 0, size: 2 }]],
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 4, eventEase: 'linear' },
                    { ...pivot, beat: 8, pivotLane: 0, eventEase: 'linear' },
                ],
            },
            2,
        )
        settings.maxLane = 0
        view.layout = 'composed'
        view.laneDivision = 1
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' ||
                    (entity.type === 'stagePivotEventJoint' && entity.beat === 0),
            ),
        })
        view.pointer = { ...view.pointer, ...point(4, 2) }
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { pasteAtPosition, paste, pasteGhostState } = await appImport<
            typeof import('../../src/editor/tools/paste')
        >('/src/editor/tools/paste/index.ts')
        const { createComposedLayout } =
            await appImport<typeof import('../../src/editor/composed')>('/src/editor/composed.ts')
        copy.execute()
        // At beat 6 the copied pivot at 4 contributes half its value, so
        // translating both raw values by 2 moves the note three screen lanes.
        const target = point(6, 6)
        paste.hover?.(target.x, target.y, { ctrl: false, shift: false })
        const ghost = pasteGhostState()!
        await pasteAtPosition(6, 4, { ctrl: false, shift: false }, { composed: true })
        return [ghost, history.state.value].map((source) => {
            const note = source.selectedEntities.find((entity) => entity.type === 'note')!
            const control = source.selectedEntities.find(
                (entity) => entity.type === 'stagePivotEventJoint',
            )!
            return {
                left: note.left,
                pivot: control.pivotLane,
                display: createComposedLayout(source).notePosition(note).left,
            }
        })
    })
    expect(result).toEqual([
        { left: 2, pivot: 6, display: 5 },
        { left: 2, pivot: 6, display: 5 },
    ])
})
