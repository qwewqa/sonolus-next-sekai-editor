import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Same-beat pairs are discontinuous jumps; their order is what the engine plays.

test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

type Kind = 'timeScale' | 'bpm' | 'cameraEventJoint' | 'stageMaskEventJoint'

/** A pair of each kind at beat 4, with a neighbour before and after, and an optional 9. */
const showPairs = (page: Page, extra?: number) =>
    page.evaluate(async (extra) => {
        const { show, fixtures, nextTick } = window.editorTest
        const timeScale = (beat: number, value: number) => ({
            groupId: fixtures.events.timeScales[0]!.groupId,
            beat,
            editorLane: 8,
            timeScale: value,
            skip: 0,
            timeScaleEase: 'linear' as const,
            timeScaleTransition: 'timeScale' as const,
            hideNotes: false,
        })
        const camera = (beat: number, cameraZoom: number) => ({
            ...fixtures.events.cameraEvents[0]!,
            beat,
            cameraZoom,
            cameraRotation: 0,
        })
        const mask = (beat: number, maskSize: number) => ({
            ...fixtures.events.stageMaskEvents[0]!,
            beat,
            maskSize,
            isMaskNotes: false,
        })
        show(
            {
                ...fixtures.events,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 4, bpm: 120 },
                    { beat: 4, bpm: 180 },
                    { beat: 6, bpm: 200 },
                ],
                timeScales: [
                    timeScale(2, 0.5),
                    timeScale(4, 1),
                    timeScale(4, 2),
                    timeScale(6, 3),
                    ...(extra === undefined ? [] : [timeScale(extra, 9)]),
                ],
                cameraEvents: [
                    camera(2, 0.5),
                    camera(4, 1),
                    camera(4, 2),
                    camera(6, 3),
                    ...(extra === undefined ? [] : [camera(extra, 9)]),
                ],
                stageMaskEvents: [mask(2, 5), mask(4, 1), mask(4, 2), mask(6, 3)],
                stagePivotEvents: [],
                stageStyleEvents: [],
                stageTransformEvents: [],
                slides: [],
            },
            3,
        )
        await nextTick()
    }, extra)

/** Each kind's values in the order the exported level plays them. */
const exported = (page: Page) =>
    page.evaluate(async () => {
        const { history, appImport } = window.editorTest
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const state = history.state.value
        const { entities } = serializeToLevelData(
            1000,
            true,
            0,
            state.store,
            state.groups,
            state.stages,
        )
        const data = (entity: (typeof entities)[number], name: string) =>
            entity.data.find((item) => item.name === name)
        const ref = (entity: (typeof entities)[number]) => {
            const next = data(entity, 'next')
            return next && 'ref' in next ? next.ref : undefined
        }
        const chain = (archetype: string, key: string) => {
            const list = entities.filter((entity) => entity.archetype === archetype)
            const byName = new Map(list.map((entity) => [entity.name, entity]))
            const next = new Set(list.map(ref))
            const values: number[] = []
            let cursor = list.find((entity) => !next.has(entity.name))
            while (cursor) {
                values.push((data(cursor, key) as { value: number }).value)
                cursor = byName.get(ref(cursor))
            }
            return values
        }
        return {
            timeScale: chain('#TIMESCALE_CHANGE', '#TIMESCALE'),
            // BPM changes are listed loosely; the engine orders them by beat.
            bpm: entities
                .filter((entity) => entity.archetype === '#BPM_CHANGE')
                .map((entity) => ({
                    beat: (data(entity, '#BEAT') as { value: number }).value,
                    bpm: (data(entity, '#BPM') as { value: number }).value,
                }))
                .sort((a, b) => a.beat - b.beat)
                .map(({ bpm }) => bpm),
            // The editor's own timing uses the integrals in the same order.
            bpmIntegrals: state.bpms.map((integral) => Math.round(60 / integral.s)),
            cameraEventJoint: chain('CameraChange', 'zoom'),
            stageMaskEventJoint: chain('StageMaskChange', 'size'),
        }
    })

const original = {
    timeScale: [0.5, 1, 2, 3],
    bpm: [120, 120, 180, 200],
    bpmIntegrals: [120, 120, 180, 200],
    cameraEventJoint: [0.5, 1, 2, 3],
    // Masks export half their size.
    stageMaskEventJoint: [2.5, 0.5, 1, 1.5],
}

const pick = (page: Page, kind: Kind, values: number[]) =>
    page.evaluate(
        ({ kind, values }) =>
            [...window.editorTest.store.getAllEntities()].filter(
                (entity) =>
                    entity.type === kind &&
                    entity.beat === 4 &&
                    values.includes(
                        ((entity as unknown as Record<string, number>).timeScale ??
                            (entity as unknown as Record<string, number>).bpm ??
                            (entity as unknown as Record<string, number>).cameraZoom ??
                            (entity as unknown as Record<string, number>).maskSize)!,
                    ),
            ),
        { kind, values },
    )

/** Selects in stored order, or the reverse, as clicking the second first does. */
const select = (page: Page, kind: Kind, values: number[], reversed = false) =>
    page.evaluate(
        async ({ kind, values, reversed }) => {
            const { history, store, nextTick } = window.editorTest
            const selected = [...store.getAllEntities()].filter((entity) => {
                const record = entity as unknown as Record<string, number>
                const value = record.timeScale ?? record.bpm ?? record.cameraZoom ?? record.maskSize
                return entity.type === kind && entity.beat === 4 && values.includes(value!)
            })
            history.replaceState({
                ...history.state.value,
                selectedEntities: reversed ? selected.reverse() : selected,
            })
            await nextTick()
        },
        { kind, values, reversed },
    )

const edits: Record<Kind, Record<string, unknown>> = {
    timeScale: { hideNotes: true },
    bpm: { meter: 3 },
    cameraEventJoint: { cameraRotation: 5 },
    stageMaskEventJoint: { isMaskNotes: true },
}

const editSelection = (page: Page, object: Record<string, unknown>) =>
    page.evaluate(async (object) => {
        const { editSelectedEditableEntities } = await window.editorTest.appImport<
            typeof import('../../src/editor/sidebars/default')
        >('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities(object)
    }, object)

test('fixtures export each same-beat pair in its stored order', async ({ page }) => {
    await showPairs(page)
    expect(await exported(page)).toEqual(original)
})

for (const kind of Object.keys(edits) as Kind[]) {
    test.describe(kind, () => {
        test.beforeEach(async ({ page }) => showPairs(page))

        test('editing the first of a pair keeps the order', async ({ page }) => {
            await select(page, kind, [kind === 'bpm' ? 120 : 1])
            await editSelection(page, edits[kind])
            expect(await exported(page)).toEqual(original)
        })

        test('editing the second of a pair keeps the order', async ({ page }) => {
            await select(page, kind, [kind === 'bpm' ? 180 : 2])
            await editSelection(page, edits[kind])
            expect(await exported(page)).toEqual(original)
        })

        test('editing both together keeps the order', async ({ page }) => {
            await select(page, kind, kind === 'bpm' ? [120, 180] : [1, 2])
            await editSelection(page, edits[kind])
            expect(await exported(page)).toEqual(original)
        })

        test('moving a pair selected in reverse by Beat keeps the order', async ({ page }) => {
            await select(page, kind, kind === 'bpm' ? [120, 180] : [1, 2], true)
            await editSelection(page, { beat: 5 })
            expect(await exported(page)).toEqual(original)
        })

        if (kind !== 'bpm')
            test('brushing one keeps the order', async ({ page }) => {
                const targets = await pick(page, kind, [1])
                expect(targets).toHaveLength(1)
                await page.evaluate(
                    async ({ kind, object }) => {
                        const { store, appImport } = window.editorTest
                        const brush = await appImport<
                            typeof import('../../src/editor/tools/brush')
                        >('/src/editor/tools/brush/index.ts')
                        brush.brushProperties.value = object
                        brush.applyBrushToEntities(
                            [...store.getAllEntities()].filter(
                                (entity) =>
                                    entity.type === kind &&
                                    entity.beat === 4 &&
                                    ((entity as unknown as Record<string, number>).timeScale ??
                                        (entity as unknown as Record<string, number>).cameraZoom ??
                                        (entity as unknown as Record<string, number>).maskSize) ===
                                        1,
                            ),
                        )
                    },
                    { kind, object: edits[kind] },
                )
                expect(await exported(page)).toEqual(original)
            })
    })
}

test.describe('moving and pasting a pair keeps both', () => {
    test.beforeEach(async ({ page }) => showPairs(page))

    for (const kind of ['timeScale', 'bpm', 'cameraEventJoint'] as const) {
        test(`${kind}: a select-tool drag`, async ({ page }) => {
            await select(page, kind, kind === 'bpm' ? [120, 180] : [1, 2])
            const { from, to } = await page.evaluate((kind) => {
                const entity = window.editorTest.history.state.value.selectedEntities[0]!
                const lane = (entity as unknown as { hitbox: { lane: number } }).hitbox.lane
                void kind
                return {
                    from: window.editorTest.point(lane, 4),
                    to: window.editorTest.point(lane, 5),
                }
            }, kind)
            await page.evaluate(async () => {
                const { toolName } = await window.editorTest.appImport<
                    typeof import('../../src/editor/tools/state')
                >('/src/editor/tools/state.ts')
                toolName.value = 'select'
            })
            await page.mouse.move(from.x, from.y)
            await page.mouse.down()
            await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 4 })
            await page.mouse.move(to.x, to.y, { steps: 4 })
            await page.mouse.up()
            const after = await exported(page)
            // Both leave beat 4 together, before the neighbour at 6 and in their order.
            expect(after[kind]).toEqual(original[kind])
            const moved = await page.evaluate(
                (kind) =>
                    [...window.editorTest.store.getAllEntities()].filter(
                        (entity) => entity.type === kind && entity.beat > 4 && entity.beat < 6,
                    ).length,
                kind,
            )
            expect(moved).toBe(2)
            if (kind === 'bpm') expect(after.bpmIntegrals).toEqual(original.bpmIntegrals)
        })

        test(`${kind}: copy and paste`, async ({ page }) => {
            await select(page, kind, kind === 'bpm' ? [120, 180] : [1, 2])
            await page.evaluate(async () => {
                const { appImport } = window.editorTest
                const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
                    '/src/editor/commands/copy/index.ts',
                )
                const { pasteAtPosition } = await appImport<
                    typeof import('../../src/editor/tools/paste')
                >('/src/editor/tools/paste/index.ts')
                copy.execute()
                await pasteAtPosition(0, 4, { ctrl: false, shift: false })
            })
            const after = await exported(page)
            const pair = kind === 'bpm' ? [120, 180] : [1, 2]
            expect(after[kind]).toEqual([...original[kind], ...pair])
            if (kind === 'bpm') expect(after.bpmIntegrals).toEqual([...original.bpm, ...pair])
        })
    }

    // Time scales and events; same-beat BPM pairs are not valid charts.
    for (const kind of ['timeScale', 'cameraEventJoint'] as const)
        for (const command of ['copy', 'cut'] as const)
            test(`${kind}: ${command} of a pair selected in reverse pastes it in order`, async ({
                page,
            }) => {
                await select(page, kind, [1, 2], true)
                await page.evaluate(async (command) => {
                    const { appImport } = window.editorTest
                    const { commands } = await appImport<
                        typeof import('../../src/editor/commands')
                    >('/src/editor/commands/index.ts')
                    const { pasteAtPosition } = await appImport<
                        typeof import('../../src/editor/tools/paste')
                    >('/src/editor/tools/paste/index.ts')
                    await commands[command].execute()
                    await pasteAtPosition(0, 4, { ctrl: false, shift: false })
                }, command)
                const after = await exported(page)
                // Cut takes the pair from beat 4; both paste it at 8, in its order.
                const kept =
                    command === 'cut'
                        ? original[kind].filter((_, index) => index !== 1 && index !== 2)
                        : original[kind]
                expect(after[kind]).toEqual([...kept, 1, 2])
            })
})

test('a time scale moved into a group goes after the ones already at its beat', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { show, fixtures, history, store, nextTick, appImport } = window.editorTest
        const timeScale = (groupId: number, value: number) => ({
            ...fixtures.events.timeScales[0]!,
            groupId: groupId as never,
            beat: 4,
            timeScale: value,
        })
        // The other group's time scale is stored first.
        show({
            ...fixtures.events,
            timeScales: [timeScale(2, 5), timeScale(1, 1), timeScale(1, 2)],
        })
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale' && entity.groupId === (2 as never),
            ),
        })
        const { moveSelectionTo } = await appImport<
            typeof import('../../src/editor/workspace/manager/objects')
        >('/src/editor/workspace/manager/objects.ts')
        await moveSelectionTo('groupId', 1)
    })
    expect((await exported(page)).timeScale).toEqual([1, 2, 5])
})

for (const [kind, key] of [
    ['timeScale', 'groupId'],
    ['stageMaskEventJoint', 'stageId'],
] as const)
    test(`a ${key} change of a ${kind} pair selected in reverse keeps the order`, async ({
        page,
    }) => {
        await showPairs(page)
        await select(page, kind, [1, 2], true)
        const target = await page.evaluate(
            ({ key }) =>
                (window.editorTest.history.state.value.selectedEntities[0] as never)[key] === 1
                    ? 2
                    : 1,
            { key },
        )
        await editSelection(page, { [key]: target })
        const values = await page.evaluate(
            ({ kind, key, target }) =>
                [...(window.editorTest.history.state.value.store.grid[kind].get(4) ?? [])]
                    .filter(
                        (entity) =>
                            entity.beat === 4 &&
                            (entity as unknown as Record<string, number>)[key] === target,
                    )
                    .map(
                        (entity) =>
                            (entity as unknown as Record<string, number>).timeScale ??
                            (entity as unknown as Record<string, number>).maskSize,
                    ),
            { kind, key, target },
        )
        expect(values).toEqual([1, 2])
    })

test('a sideways drag keeps a time-scale pair and its order', async ({ page }) => {
    await showPairs(page)
    await select(page, 'timeScale', [1, 2])
    const { from, to } = await page.evaluate(() => ({
        from: window.editorTest.point(8, 4),
        to: window.editorTest.point(6, 4),
    }))
    await page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        toolName.value = 'select'
    })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
    const lanes = await page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .filter((entity) => entity.type === 'timeScale' && entity.beat === 4)
            .map((entity) => (entity as unknown as { editorLane: number }).editorLane),
    )
    expect(lanes).toHaveLength(2)
    expect(lanes[0]).not.toBe(8)
    expect((await exported(page)).timeScale).toEqual(original.timeScale)
})

/** Drags a selected object of `kind` sideways by `lanes` with the select tool. */
const dragSideways = async (page: Page, kind: Kind | 'note', lanes: number) => {
    const { from, to } = await page.evaluate(
        ({ kind, lanes }) => {
            const { history, point } = window.editorTest
            const entity = history.state.value.selectedEntities.find(
                (entity) => entity.type === kind,
            )!
            return {
                from: point(entity.hitbox!.lane, 4),
                to: point(entity.hitbox!.lane + lanes, 4),
            }
        },
        { kind, lanes },
    )
    await page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        toolName.value = 'select'
    })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
}

for (const kind of ['timeScale', 'cameraEventJoint', 'stageMaskEventJoint'] as const)
    for (const value of [1, 2])
        test(`a sideways drag of ${kind} ${value} alone keeps its pair and the order`, async ({
            page,
        }) => {
            await showPairs(page)
            await select(page, kind, [value])
            // The selected one's place, and the partner itself, at beat 4.
            const places = (partner?: unknown) =>
                page.evaluate(
                    ({ kind, partner }) => {
                        const { history } = window.editorTest
                        const { selectedEntities, store } = history.state.value
                        const pair = [...(store.grid[kind].get(4) ?? [])].filter(
                            (entity) => entity.beat === 4,
                        )
                        const moved = pair.find((entity) => selectedEntities.includes(entity))!
                        const other = pair.find((entity) => entity !== moved)
                        const keep = window as unknown as { partner?: unknown }
                        if (!partner) keep.partner = other
                        return {
                            count: pair.length,
                            index: pair.indexOf(moved),
                            lane: moved.hitbox!.lane,
                            same: other === keep.partner,
                        }
                    },
                    { kind, partner },
                )
            const before = await places()
            await dragSideways(page, kind, -1)
            const after = await places(true)
            // It moved at its beat, kept its place and left its partner alone.
            expect(after.lane).not.toBe(before.lane)
            expect(after).toMatchObject({ count: 2, index: before.index, same: true })
        })

test('a sideways drag with a BPM of a pair selected keeps its partner', async ({ page }) => {
    await showPairs(page)
    await page.evaluate(async () => {
        const { history, fixtures, appImport, nextTick } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { addNote } = await appImport<typeof import('../../src/state/mutations/slides/note')>(
            '/src/state/mutations/slides/note.ts',
        )
        const { createSlideId } = await appImport<typeof import('../../src/state/entities/slides')>(
            '/src/state/entities/slides/index.ts',
        )
        const transaction = createTransaction(history.state.value)
        const [note] = addNote(transaction, createSlideId(), {
            ...fixtures.interaction.slides[0]![0]!,
            beat: 4,
            left: -1,
            size: 2,
            isAttached: false,
        })
        const bpm = [...history.state.value.store.grid.bpm.get(4)!].find(
            (entity) => entity.beat === 4 && entity.bpm === 120,
        )!
        history.replaceState(transaction.commit([bpm, note!]))
        await nextTick()
    })
    await dragSideways(page, 'note', -1)
    const lefts = await page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
            entity.type === 'note' ? [entity.left] : [],
        ),
    )
    expect(lefts).toEqual([-2])
    const after = await exported(page)
    expect(after.bpm).toEqual(original.bpm)
    expect(after.bpmIntegrals).toEqual(original.bpmIntegrals)
})

test.describe('flipping, scaling and nudging a pair keeps both', () => {
    test.beforeEach(async ({ page }) => showPairs(page))

    const transform = (page: Page, kind: Kind, operation: 'flip' | 'scale' | 'translate') =>
        page.evaluate(
            async ({ kind, operation }) => {
                const { history, store, appImport, nextTick } = window.editorTest
                // The initial BPM stays put; every other object of the kind moves.
                const selected = [...store.getAllEntities()].filter(
                    (entity) => entity.type === kind && entity.beat > 0,
                )
                history.replaceState({ ...history.state.value, selectedEntities: selected })
                if (operation === 'flip') {
                    const { flipVertical } = await appImport<
                        typeof import('../../src/editor/commands/flipVertical')
                    >('/src/editor/commands/flipVertical/index.ts')
                    flipVertical.execute()
                } else if (operation === 'scale') {
                    const { scaleSelection } = await appImport<
                        typeof import('../../src/state/operations/scaleSelection')
                    >('/src/state/operations/scaleSelection.ts')
                    history.pushState(
                        () => 'scale',
                        scaleSelection(history.state.value, selected, 'beat', 2, 2),
                    )
                } else {
                    const { translateSelection } = await appImport<
                        typeof import('../../src/state/operations/translateSelection')
                    >('/src/state/operations/translateSelection.ts')
                    history.pushState(
                        () => 'translate',
                        translateSelection(history.state.value, selected, 'beat', 1),
                    )
                }
                await nextTick()
            },
            { kind, operation },
        )

    for (const kind of ['timeScale', 'bpm', 'cameraEventJoint', 'stageMaskEventJoint'] as const) {
        // Flipped, each pair mirrors its order at its mirrored beat, as the jump runs back.
        const flipped = {
            timeScale: [3, 2, 1, 0.5],
            bpm: [120, 200, 180, 120],
            cameraEventJoint: [3, 2, 1, 0.5],
            stageMaskEventJoint: [1.5, 1, 0.5, 2.5],
        }[kind]

        test(`${kind}: flip vertically`, async ({ page }) => {
            await transform(page, kind, 'flip')
            const after = await exported(page)
            expect(after[kind]).toEqual(flipped)
            if (kind === 'bpm') expect(after.bpmIntegrals).toEqual(flipped)
        })

        for (const operation of ['scale', 'translate'] as const)
            test(`${kind}: ${operation} in time`, async ({ page }) => {
                await transform(page, kind, operation)
                const after = await exported(page)
                expect(after[kind]).toEqual(original[kind])
                if (kind === 'bpm') expect(after.bpmIntegrals).toEqual(original.bpmIntegrals)
            })
    }
})

/** Applies a selection transform to objects chosen by kind and beat. */
const transformChosen = (
    page: Page,
    operation: 'scale' | 'translate' | 'flipVertical',
    axis: 'beat' | 'width',
    choose: { kinds: string[]; beats: number[]; firstOfPair?: boolean; except?: number },
) =>
    page.evaluate(
        async ({ operation, axis, choose }) => {
            const { history, store, appImport } = window.editorTest
            const { scaleSelection } = await appImport<
                typeof import('../../src/state/operations/scaleSelection')
            >('/src/state/operations/scaleSelection.ts')
            const { translateSelection } = await appImport<
                typeof import('../../src/state/operations/translateSelection')
            >('/src/state/operations/translateSelection.ts')
            const { flipVertical } = await appImport<
                typeof import('../../src/state/operations/flipVertical')
            >('/src/state/operations/flipVertical.ts')
            const all = [...store.getAllEntities()]
            const selected = all.filter(
                (entity) =>
                    choose.kinds.includes(entity.type) &&
                    choose.beats.includes(entity.beat) &&
                    (entity as unknown as Record<string, number>).timeScale !== choose.except &&
                    (entity as unknown as Record<string, number>).cameraZoom !== choose.except &&
                    !(
                        choose.firstOfPair &&
                        entity.beat === 4 &&
                        all.find((other) => other.type === entity.type && other.beat === 4) !==
                            entity
                    ),
            )
            const source = { ...history.state.value, selectedEntities: selected }
            history.pushState(
                () => operation,
                operation === 'scale'
                    ? scaleSelection(source, selected, axis, 2)
                    : operation === 'translate'
                      ? translateSelection(source, selected, axis, 1)
                      : flipVertical(source, selected),
            )
        },
        { operation, axis, choose },
    )

test('scaling the width of one of a pair keeps the pair in order', async ({ page }) => {
    await showPairs(page)
    await transformChosen(page, 'scale', 'width', {
        kinds: ['timeScale', 'cameraEventJoint'],
        beats: [2, 4],
        firstOfPair: true,
    })
    const after = await exported(page)
    expect(after.timeScale).toEqual(original.timeScale)
    expect(after.cameraEventJoint).toEqual(original.cameraEventJoint)
})

for (const [operation, extra] of [
    ['scale', 10],
    ['translate', 7],
    ['flipVertical', 2],
] as const) {
    test(`${operation}: selected pairs stay, unselected objects at a destination are replaced`, async ({
        page,
    }) => {
        await showPairs(page, extra)
        await transformChosen(page, operation, 'beat', {
            kinds: ['bpm', 'timeScale', 'cameraEventJoint', 'stageMaskEventJoint'],
            beats: [2, 4, 6],
            except: 9,
        })
        // The unselected 9 sits where the last (or, flipped, the first) object lands.
        expect(await exported(page)).toEqual(
            operation === 'flipVertical'
                ? {
                      timeScale: [3, 2, 1, 0.5],
                      bpm: [120, 200, 180, 120],
                      bpmIntegrals: [120, 200, 180, 120],
                      cameraEventJoint: [3, 2, 1, 0.5],
                      stageMaskEventJoint: [1.5, 1, 0.5, 2.5],
                  }
                : original,
        )
    })
}

test('Make Vertical keeps a pair that was already one and merges the rest', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { show, fixtures, history, store, appImport } = window.editorTest
        const f = fixtures.events
        const note = fixtures.interaction.slides[0]![0]!
        show({
            ...f,
            timeScales: [
                { ...f.timeScales[0]!, beat: 5, timeScale: 5 },
                { ...f.timeScales[0]!, beat: 6, timeScale: 1 },
                { ...f.timeScales[0]!, beat: 6, timeScale: 2 },
            ],
            cameraEvents: [
                { ...f.cameraEvents[0]!, beat: 5, cameraZoom: 5 },
                { ...f.cameraEvents[0]!, beat: 6, cameraZoom: 1 },
                { ...f.cameraEvents[0]!, beat: 6, cameraZoom: 2 },
            ],
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            slides: [[{ ...note, beat: 4 }], [{ ...note, beat: 8 }]],
        })
        const { makeVertical } = await appImport<
            typeof import('../../src/state/operations/makeVertical')
        >('/src/state/operations/makeVertical.ts')
        // In beat order, as a box selection lists them; the latest beat wins a collision.
        const selected = [...store.getAllEntities()]
            .filter(
                (entity) => entity.type === 'note' || (entity.type !== 'bpm' && entity.beat >= 5),
            )
            .sort((a, b) => a.beat - b.beat)
        const next = makeVertical({ ...history.state.value, selectedEntities: selected }, selected)
        const at4 = (type: 'timeScale' | 'cameraEventJoint') =>
            [...(next.store.grid[type].get(4) ?? [])]
                .filter((entity) => entity.beat === 4)
                .map((entity) =>
                    entity.type === 'timeScale'
                        ? entity.timeScale
                        : (entity as never)['cameraZoom'],
                )
        return { timeScale: at4('timeScale'), camera: at4('cameraEventJoint') }
    })
    // The 5 from beat 5 is replaced by the pair from beat 6, which stays a pair in order.
    expect(result).toEqual({ timeScale: [1, 2], camera: [1, 2] })
})

test('flipping vertically mirrors event and time scale eases', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { show, fixtures, history, store, appImport } = window.editorTest
        const f = fixtures.events
        const eases = ['inQuad', 'outCubic', 'linear', 'inSine'] as const
        show({
            ...f,
            timeScales: eases.map((timeScaleEase, i) => ({
                ...f.timeScales[0]!,
                beat: 2 + i * 2,
                timeScale: i + 1,
                timeScaleEase,
            })),
            cameraEvents: eases.map((eventEase, i) => ({
                ...f.cameraEvents[0]!,
                beat: 2 + i * 2,
                cameraZoom: i + 1,
                eventEase,
            })),
            stageMaskEvents: [],
            stagePivotEvents: [],
            stageStyleEvents: [],
            stageTransformEvents: [],
            slides: [],
        })
        const { commands } = await appImport<typeof import('../../src/editor/commands')>(
            '/src/editor/commands/index.ts',
        )
        const read = () =>
            [...store.getAllEntities()]
                .flatMap((entity) =>
                    entity.type === 'timeScale'
                        ? [`ts ${entity.beat}:${entity.timeScale}:${entity.timeScaleEase}`]
                        : entity.type === 'cameraEventJoint'
                          ? [`cam ${entity.beat}:${entity.cameraZoom}:${entity.eventEase}`]
                          : [],
                )
                .sort()
        const before = read()
        const flip = () => {
            history.replaceState({
                ...history.state.value,
                // The last joint stays out of the selection, so its segment is unchanged.
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) =>
                        (entity.type === 'timeScale' || entity.type === 'cameraEventJoint') &&
                        entity.beat <= 6,
                ),
            })
            void commands.flipVertical.execute()
        }
        flip()
        const flipped = read()
        flip()
        return { flipped, restored: read(), before }
    })
    // Each segment runs back with the complement of its ease; the last still leads out.
    expect(result.flipped).toEqual([
        'cam 2:3:inCubic',
        'cam 4:2:outQuad',
        'cam 6:1:linear',
        'cam 8:4:inSine',
        'ts 2:3:inCubic',
        'ts 4:2:outQuad',
        'ts 6:1:linear',
        'ts 8:4:inSine',
    ])
    expect(result.restored).toEqual(result.before)
})

/** A slide with a same-beat pair at beat 2, optionally a separator on its second. */
const slidePair = (separator: boolean): Partial<NoteObject>[] => [
    { beat: 0, left: 0, connectorEase: 'inQuad' },
    { beat: 2, left: -4, connectorEase: 'outSine' },
    {
        beat: 2,
        left: 4,
        connectorEase: 'inCubic',
        ...(separator ? { isConnectorSeparator: true, connectorType: 'guide' } : {}),
    },
    ...(separator ? [] : [{ beat: 3, left: 0, isAttached: true }]),
    { beat: 4, left: 0, connectorEase: 'linear' },
]

/** Flips the whole slide, selected in stored order or the reverse, and flips it back. */
const flipSlide = (page: Page, separator: boolean, reversed: boolean) =>
    page.evaluate(
        async ({ notes, reversed }) => {
            const { show, fixtures, history, appImport } = window.editorTest
            const { flipVertical } = await appImport<
                typeof import('../../src/state/operations/flipVertical')
            >('/src/state/operations/flipVertical.ts')
            show({
                ...fixtures.interaction,
                slides: [
                    notes.map((note) => ({ ...fixtures.interaction.slides[0]![0]!, ...note })),
                ],
            })
            // Stored order, each connector's segment type, and attached places.
            const read = () => {
                const { store } = history.state.value
                const [infos] = [...store.slides.info.values()]
                const [connectors] = [...store.slides.connector.values()]
                return {
                    notes: infos!.map(
                        ({ note }) =>
                            `${note.beat}@${Math.round(note.left * 1000) / 1000}/${note.connectorEase}${note.isAttached ? '/A' : ''}${note.isConnectorSeparator ? '/S' : ''}`,
                    ),
                    connectors: connectors!.map(
                        ({ head, tail, segmentHead }) =>
                            `${head.beat}@${head.left}-${tail.beat}@${tail.left} ${segmentHead.connectorType}`,
                    ),
                }
            }
            const flip = () => {
                const notes = [...history.state.value.store.slides.note.values()].flat()
                const selected = reversed ? notes.reverse() : notes
                history.pushState(
                    () => 'flip',
                    flipVertical({ ...history.state.value, selectedEntities: selected }, selected),
                )
            }
            const before = read()
            flip()
            const flipped = read()
            flip()
            return { before, flipped, restored: read() }
        },
        { notes: slidePair(separator), reversed },
    )

for (const separator of [false, true])
    for (const reversed of [false, true])
        test(`flipping a slide${separator ? ' with a separator' : ''} mirrors its same-beat pair, selected ${reversed ? 'in reverse' : 'in order'}`, async ({
            page,
        }) => {
            const { before, flipped, restored } = await flipSlide(page, separator, reversed)
            // The path runs back through the pair, and each segment keeps its type.
            expect(flipped).toEqual(
                separator
                    ? {
                          notes: ['0@0/outCubic', '2@4/inSine/S', '2@-4/outQuad', '4@0/linear'],
                          connectors: ['0@0-2@4 guide', '2@4-2@-4 active', '2@-4-4@0 active'],
                      }
                    : {
                          notes: [
                              '0@0/outCubic',
                              '1@3.5/linear/A',
                              '2@4/inSine',
                              '2@-4/outQuad',
                              '4@0/linear',
                          ],
                          connectors: ['0@0-2@4 active', '2@4-2@-4 active', '2@-4-4@0 active'],
                      },
            )
            expect(restored).toEqual(before)
        })

test('a level file loads a time-scale pair along its chain, not its listing', async ({ page }) => {
    const loaded = await page.evaluate(async () => {
        const { parseLevelDataChart } = await window.editorTest.appImport<
            typeof import('../../src/chart/parse/levelData')
        >('/src/chart/parse/levelData/index.ts')
        const timeScale = (name: string, group: string, value: number, next?: string) => ({
            name,
            archetype: '#TIMESCALE_CHANGE',
            data: [
                { name: '#TIMESCALE_GROUP', ref: group },
                { name: '#BEAT', value: 4 },
                { name: '#TIMESCALE', value },
                { name: '#TIMESCALE_SKIP', value: 0 },
                { name: '#TIMESCALE_EASE', value: 0 },
                ...(next ? [{ name: 'next', ref: next }] : []),
            ],
        })
        const chart = parseLevelDataChart([
            { archetype: 'Initialization', data: [] },
            {
                archetype: '#BPM_CHANGE',
                data: [
                    { name: '#BEAT', value: 0 },
                    { name: '#BPM', value: 120 },
                ],
            },
            { name: 'a', archetype: '#TIMESCALE_GROUP', data: [{ name: 'first', ref: 'a1' }] },
            // Its first is missing; the file still loads, as before.
            { name: 'b', archetype: '#TIMESCALE_GROUP', data: [{ name: 'first', ref: 'gone' }] },
            // Listed second-first; the engine plays 1 then 2.
            timeScale('a2', 'a', 2),
            timeScale('a1', 'a', 1, 'a2'),
            // Outside any chain, still loaded.
            timeScale('a3', 'a', 3),
            timeScale('b1', 'b', 5),
        ])
        const groups = [...chart.groups.keys()]
        return chart.timeScales.map(
            ({ groupId, timeScale }) => `${groups.indexOf(groupId)}:${timeScale}`,
        )
    })
    expect(loaded).toEqual(['0:1', '0:2', '0:3', '1:5'])
})

test.describe('a lone time scale placed on a pair replaces both', () => {
    test.beforeEach(async ({ page }) => {
        await showPairs(page)
        // Another group's time scale at the beat, which stays.
        await page.evaluate(async () => {
            const { history, appImport, fixtures, nextTick } = window.editorTest
            const { createTransaction } = await appImport<
                typeof import('../../src/state/transaction')
            >('/src/state/transaction.ts')
            const { addTimeScale } = await appImport<
                typeof import('../../src/state/mutations/timeScale')
            >('/src/state/mutations/timeScale.ts')
            const transaction = createTransaction(history.state.value)
            addTimeScale(transaction, {
                ...fixtures.events.timeScales[0]!,
                groupId: 2 as never,
                beat: 4,
                timeScale: 7,
            })
            history.replaceState(transaction.commit([]))
            await nextTick()
        })
    })

    /** Selects time scales by beat and value. */
    const selectTimeScales = (page: Page, beat: number, values?: number[]) =>
        page.evaluate(
            async ({ beat, values }) => {
                const { history, store, nextTick } = window.editorTest
                history.replaceState({
                    ...history.state.value,
                    selectedEntities: [...store.getAllEntities()].filter(
                        (entity) =>
                            entity.type === 'timeScale' &&
                            entity.beat === beat &&
                            (!values || values.includes(entity.timeScale)),
                    ),
                })
                await nextTick()
            },
            { beat, values },
        )

    /** Each time scale at beat 4 as group:value, in stored order. */
    const atBeat4 = (page: Page) =>
        page.evaluate(() =>
            [...(window.editorTest.history.state.value.store.grid.timeScale.get(4) ?? [])]
                .filter((entity) => entity.beat === 4)
                .map((entity) => `${entity.groupId as number}:${entity.timeScale}`),
        )

    const copyAndPaste = (page: Page, beatOffset: number) =>
        page.evaluate(async (beatOffset) => {
            const { appImport } = window.editorTest
            const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
                '/src/editor/commands/copy/index.ts',
            )
            const { pasteAtPosition } = await appImport<
                typeof import('../../src/editor/tools/paste')
            >('/src/editor/tools/paste/index.ts')
            copy.execute()
            await pasteAtPosition(0, beatOffset, { ctrl: false, shift: false })
        }, beatOffset)

    test('pasted', async ({ page }) => {
        await selectTimeScales(page, 6)
        await copyAndPaste(page, -2)
        expect((await atBeat4(page)).sort()).toEqual(['1:3', '2:7'])
    })

    test('moved by its Beat', async ({ page }) => {
        await selectTimeScales(page, 6)
        await editSelection(page, { beat: 4 })
        expect((await atBeat4(page)).sort()).toEqual(['1:3', '2:7'])
    })

    test('dragged with the select tool', async ({ page }) => {
        await selectTimeScales(page, 6)
        const { from, to } = await page.evaluate(async () => {
            const { history, point, appImport } = window.editorTest
            const { beatToTime } = await appImport<typeof import('../../src/state/integrals/bpms')>(
                '/src/state/integrals/bpms.ts',
            )
            const { bpms, selectedEntities } = history.state.value
            const lane = selectedEntities[0]!.hitbox!.lane
            // Beat 6 plays after the tempo change at 4.
            return { from: point(lane, beatToTime(bpms, 6) * 2), to: point(lane, 4) }
        })
        await page.evaluate(async () => {
            const { toolName } = await window.editorTest.appImport<
                typeof import('../../src/editor/tools/state')
            >('/src/editor/tools/state.ts')
            toolName.value = 'select'
        })
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 4 })
        await page.mouse.move(to.x, to.y, { steps: 4 })
        await page.mouse.up()
        expect((await atBeat4(page)).sort()).toEqual(['1:3', '2:7'])
    })

    test('a pasted pair replaces the pair and stays one', async ({ page }) => {
        await selectTimeScales(page, 4, [1, 2])
        await copyAndPaste(page, 0)
        expect((await atBeat4(page)).filter((entry) => entry !== '2:7')).toEqual(['1:1', '1:2'])
    })
})
