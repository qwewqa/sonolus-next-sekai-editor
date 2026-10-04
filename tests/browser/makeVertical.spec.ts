import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const errors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = []
    errors.set(page, pageErrors)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

test('Make Vertical preserves chronological slide order and current connector references', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [
                    {
                        ...base,
                        beat: 4,
                        left: -4,
                        elevation: 5,
                        connectorStyle: 'red',
                        isConnectorSeparator: true,
                    },
                    {
                        ...base,
                        beat: 6,
                        left: 0,
                        elevation: -2,
                        connectorStyle: 'blue',
                        isConnectorSeparator: true,
                    },
                    {
                        ...base,
                        beat: 8,
                        left: 4,
                        elevation: 8,
                        connectorStyle: 'green',
                        isConnectorSeparator: true,
                    },
                ],
                [{ ...base, beat: 10, elevation: 7 }],
            ],
        })
        const source = history.state.value
        const [slide, untouched] = [...source.store.slides.note.values()]
        if (!slide || !untouched) throw new Error('Missing vertical fixture')
        const oldConnection = source.store.slides.connector.get(slide[0]!.slideId)![0]!
        const vertical = makeVertical(source, [slide[2]!, oldConnection, slide[0]!, slide[1]!])
        const updated = vertical.store.slides.note.get(slide[0]!.slideId)!
        const connectors = vertical.store.slides.connector.get(slide[0]!.slideId)!
        return {
            notes: updated.map((note) => [note.beat, note.left, note.elevation]),
            connectors: connectors.map((connector) => [
                connector.head.left,
                connector.tail.left,
                connector.segmentHead.connectorStyle,
            ]),
            currentConnections: connectors.every(
                (connector) => updated.includes(connector.head) && updated.includes(connector.tail),
            ),
            selected: vertical.selectedEntities.map((entity) =>
                entity.type === 'note' ? entity.left : entity.type,
            ),
            staleSelectionRemoved: !vertical.selectedEntities.includes(oldConnection),
            sourceNotes: slide.map((note) => [note.beat, note.elevation]),
            untouched: vertical.store.slides.note.get(untouched[0]!.slideId) === untouched,
            groups: vertical.groups === source.groups,
            stages: vertical.stages === source.stages,
            sourceUnchanged: history.state.value === source,
            noHistory: !history.canUndo.value,
            idempotent: makeVertical(vertical, vertical.selectedEntities) === vertical,
        }
    })
    expect(result).toEqual({
        notes: [
            [4, -4, 0],
            [4, 0, 2],
            [4, 4, 4],
        ],
        connectors: [
            [-4, 0, 'red'],
            [0, 4, 'blue'],
        ],
        currentConnections: true,
        selected: [4, -4, 0],
        staleSelectionRemoved: true,
        sourceNotes: [
            [4, 5],
            [6, -2],
            [8, 8],
        ],
        untouched: true,
        groups: true,
        stages: true,
        sourceUnchanged: true,
        noHistory: true,
        idempotent: true,
    })
})

test('the context action uses the earliest selected note and supports one-step undo and redo', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history, settings } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show(
            {
                ...chart,
                slides: [
                    [{ ...base, beat: 4, left: -4, elevation: 3 }],
                    [{ ...base, beat: 8, left: 2, elevation: 1 }],
                ],
            },
            3,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat().reverse(),
        })
        settings.mouseSecondaryTool = 'selectContextMenu'
    })
    const initial = await page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()]
            .flat()
            .map((note) => [note.beat, note.left, note.elevation]),
    )
    const target = await page.evaluate(() => window.editorTest.point(-3, 4))
    await page.mouse.click(target.x, target.y, { button: 'right' })
    const action = page.getByRole('menuitem', { name: 'Make Vertical', exact: true })
    await expect(action).toBeVisible()
    await action.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    const values = () =>
        page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()]
                .flat()
                .map((note) => [note.beat, note.left, note.elevation]),
        )
    expect(await values()).toEqual([
        [4, -4, 0],
        [4, 2, 4],
    ])
    expect(
        await page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length),
    ).toBe(2)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
    await page.keyboard.press('z')
    expect(await values()).toEqual(initial)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await page.keyboard.press('y')
    expect(await values()).toEqual([
        [4, -4, 0],
        [4, 2, 4],
    ])
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Make Vertical', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
})

test('one note anchors mixed events and collisions stay within the matching group and stage', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.events
        const base = fixtures.interaction.slides[0]![0]!
        const [firstGroup, secondGroup] = [...chart.groups.keys()]
        const [firstStage, secondStage] = [...chart.stages.keys()]
        const timeScale = chart.timeScales[0]!
        const camera = chart.cameraEvents[0]!
        const transform = chart.stageTransformEvents[0]!
        show({
            ...chart,
            slides: [[{ ...base, beat: 4, elevation: 3 }], [{ ...base, beat: 12, elevation: 9 }]],
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 999 },
                { beat: 8, bpm: 180 },
                { beat: 12, bpm: 240 },
            ],
            timeScales: [
                { ...timeScale, beat: 2, groupId: firstGroup!, timeScale: 0.5 },
                { ...timeScale, beat: 8, groupId: firstGroup!, timeScale: 2 },
                { ...timeScale, beat: 4, groupId: secondGroup!, timeScale: 3 },
            ],
            cameraEvents: [
                { ...camera, beat: 1, cameraZoom: 0.5 },
                { ...camera, beat: 9, cameraZoom: 2 },
            ],
            stageTransformEvents: [
                { ...transform, beat: 2, stageId: firstStage!, elevation: 7 },
                { ...transform, beat: 9, stageId: firstStage!, elevation: 11 },
                { ...transform, beat: 4, stageId: secondStage!, elevation: 3 },
            ],
        })
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat()[0]!
        const untouched = [...source.store.slides.note.values()].flat()[1]!
        const bpms = [...source.store.grid.bpm.values()]
            .flatMap((bucket) => [...bucket])
            .filter((entity) => entity.beat === 0 || entity.beat === 8)
        const times = [...source.store.grid.timeScale.values()]
            .flatMap((bucket) => [...bucket])
            .filter((entity) => entity.groupId === firstGroup)
        const cameras = [...source.store.grid.cameraEventJoint.values()].flatMap((bucket) => [
            ...bucket,
        ])
        const transforms = [...source.store.grid.stageTransformEventJoint.values()]
            .flatMap((bucket) => [...bucket])
            .filter((entity) => entity.stageId === firstStage)
        const vertical = makeVertical(source, [...bpms, ...times, ...cameras, ...transforms, note])
        return {
            note: [...vertical.store.slides.note.values()]
                .flat()
                .find((entity) => entity.slideId === note.slideId)!.elevation,
            bpms: [...vertical.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.beat, entity.bpm])
                .sort((a, b) => a[0]! - b[0]!),
            times: [...vertical.store.grid.timeScale.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.groupId === firstGroup, entity.beat, entity.timeScale])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            camera: [...vertical.store.grid.cameraEventJoint.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.beat, entity.cameraZoom]),
            transforms: [...vertical.store.grid.stageTransformEventJoint.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.stageId === firstStage, entity.beat, entity.elevation])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            selectedBeats: [...new Set(vertical.selectedEntities.map((entity) => entity.beat))],
            untouched: vertical.store.slides.note.get(untouched.slideId)![0] === untouched,
            sourceUnchanged: history.state.value === source && note.elevation === 3,
            noHistory: !history.canUndo.value,
        }
    })
    expect(result).toEqual({
        note: 0,
        bpms: [
            [0, 120],
            [4, 180],
            [12, 240],
        ],
        times: [
            [true, 4, 2],
            [false, 4, 3],
        ],
        camera: [[4, 2]],
        transforms: [
            [true, 4, 11],
            [false, 4, 3],
        ],
        selectedBeats: [4],
        untouched: true,
        sourceUnchanged: true,
        noHistory: true,
    })
})

test('attached interiors detach at their displayed lane and width before becoming vertical', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 2, bpm: 60 },
            ],
            slides: [
                [
                    { ...base, beat: 0, left: -4, size: 2, elevation: 2, connectorEase: 'linear' },
                    { ...base, beat: 2, left: 20, size: 10, elevation: 9, isAttached: true },
                    { ...base, beat: 4, left: 4, size: 4, elevation: 4 },
                ],
                [{ ...base, beat: 4, left: 6, elevation: 7 }],
            ],
        })
        const source = history.state.value
        const [slide, standalone] = [...source.store.slides.note.values()]
        const middle = slide![1]!
        const vertical = makeVertical(source, [standalone![0]!, middle])
        const updated = vertical.selectedEntities.find(
            (entity) => entity.type === 'note' && entity.slideId === middle.slideId,
        )
        if (!updated || updated.type !== 'note') throw new Error('Missing detached note')
        return {
            attached: updated.isAttached,
            beat: updated.beat,
            elevation: updated.elevation,
            left: updated.left,
            size: updated.size,
            other: vertical.selectedEntities
                .filter((entity) => entity !== updated)
                .map((entity) => (entity.type === 'note' ? [entity.beat, entity.elevation] : [])),
            original: [middle.beat, middle.elevation, middle.isAttached],
            sourceUnchanged: history.state.value === source,
        }
    })
    expect(result.attached).toBe(false)
    expect(result.beat).toBe(2)
    expect(result.elevation).toBe(0)
    expect(result.left).toBeCloseTo(-4 / 3)
    expect(result.size).toBeCloseTo(8 / 3)
    expect(result.other).toEqual([[2, 2]])
    expect(result.original).toEqual([2, 9, true])
    expect(result.sourceUnchanged).toBe(true)
})

test('common-beat notes retain their elevations and a single note is already vertical', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { canMakeVertical } = await import('/src/state/operations/makeVerticalValues.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [{ ...base, beat: 4, elevation: 2 }],
                [{ ...base, beat: 4, elevation: 0 }],
                [{ ...base, beat: 8, elevation: 3 }],
            ],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        return {
            noAction: !canMakeVertical(notes.slice(0, 2)),
            noOp: makeVertical(source, notes.slice(0, 2)) === source,
            singleZeroNoOp: makeVertical(source, [notes[1]!]) === source,
            singleElevatedNoOp: makeVertical(source, [notes[2]!]) === source,
            singleEnabled: canMakeVertical([notes[2]!]),
            elevations: notes.map((note) => note.elevation),
            noHistory: !history.canUndo.value,
        }
    })
    expect(result).toEqual({
        noAction: true,
        noOp: true,
        singleZeroNoOp: true,
        singleElevatedNoOp: true,
        singleEnabled: false,
        elevations: [2, 0, 3],
        noHistory: true,
    })
})

test('moving an event to a distant note anchor cannot expand a connected grid without bound', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.events
        const base = fixtures.interaction.slides[0]![0]!
        const camera = chart.cameraEvents[0]!
        show({
            ...chart,
            slides: [[{ ...base, beat: 1e12 }], [{ ...base, beat: 1e12 + 4 }]],
            cameraEvents: [
                { ...camera, beat: 0 },
                { ...camera, beat: 4 },
            ],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        const event = [...source.store.grid.cameraEventJoint.values()]
            .flatMap((bucket) => [...bucket])
            .find((entity) => entity.beat === 0)!
        return makeVertical(source, [...notes, event]) === source && !history.canUndo.value
    })
    expect(result).toBe(true)
})
