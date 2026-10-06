import { expect, test, type Page } from '@playwright/test'
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

/** A pair of each kind at beat 4, with a neighbour before and after. */
const showPairs = (page: Page) =>
    page.evaluate(async () => {
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
                timeScales: [timeScale(2, 0.5), timeScale(4, 1), timeScale(4, 2), timeScale(6, 3)],
                cameraEvents: [camera(2, 0.5), camera(4, 1), camera(4, 2), camera(6, 3)],
                stageMaskEvents: [mask(2, 5), mask(4, 1), mask(4, 2), mask(6, 3)],
                stagePivotEvents: [],
                stageStyleEvents: [],
                stageTransformEvents: [],
                slides: [],
            },
            3,
        )
        await nextTick()
    })

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

const select = (page: Page, kind: Kind, values: number[]) =>
    page.evaluate(
        async ({ kind, values }) => {
            const { history, store, nextTick } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((entity) => {
                    const record = entity as unknown as Record<string, number>
                    const value =
                        record.timeScale ?? record.bpm ?? record.cameraZoom ?? record.maskSize
                    return entity.type === kind && entity.beat === 4 && values.includes(value!)
                }),
            })
            await nextTick()
        },
        { kind, values },
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
        // Flipped, each pair keeps its stored order at its mirrored beat.
        const flipped = {
            timeScale: [3, 1, 2, 0.5],
            bpm: [120, 200, 120, 180],
            cameraEventJoint: [3, 1, 2, 0.5],
            stageMaskEventJoint: [1.5, 0.5, 1, 2.5],
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
