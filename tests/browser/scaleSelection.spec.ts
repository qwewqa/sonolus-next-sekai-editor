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

test('elevation scaling preserves same-beat slide order, connectors, and untouched slides', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { scaleSelection } = await import('/src/state/operations/scaleSelection.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [-3, 0, 3].map((left, index) => ({
                    ...base,
                    beat: 4,
                    left,
                    elevation: index + 1,
                    connectorEase: 'in',
                })),
                [{ ...base, beat: 8, elevation: 9 }],
            ],
        })
        const source = history.state.value
        const [slide, untouched] = [...source.store.slides.note.values()]
        if (!slide || !untouched || !slide[0] || !slide[2]) throw new Error('Missing slide')
        const oldConnection = source.store.slides.connector.get(slide[0].slideId)?.[0]
        if (!oldConnection) throw new Error('Missing slide connector')
        const scaled = scaleSelection(source, [slide[2], oldConnection, slide[0]], 'elevation', 2)
        const updated = scaled.store.slides.note.get(slide[0].slideId)!
        const connectors = scaled.store.slides.connector.get(slide[0].slideId)!
        return {
            notes: updated.map((note) => [
                note.left,
                note.beat,
                note.elevation,
                note.connectorEase,
            ]),
            connectors: connectors.map((connector) => [connector.head.left, connector.tail.left]),
            currentConnections: connectors.every(
                (connector) => updated.includes(connector.head) && updated.includes(connector.tail),
            ),
            selected: scaled.selectedEntities.map((entity) =>
                entity.type === 'note' ? entity.left : entity.type,
            ),
            selectedInStore: scaled.selectedEntities.every((entity) =>
                updated.includes(entity as never),
            ),
            staleSelectionRemoved: !scaled.selectedEntities.includes(oldConnection),
            sourceNotes: slide.map((note) => [note.left, note.elevation]),
            sourceUnchanged: history.state.value === source,
            untouched: scaled.store.slides.note.get(untouched[0]!.slideId) === untouched,
            groups: scaled.groups === source.groups,
            stages: scaled.stages === source.stages,
            noHistory: !history.canUndo.value,
        }
    })
    expect(result).toEqual({
        notes: [
            [-3, 4, 1, 'in'],
            [0, 4, 2, 'in'],
            [3, 4, 5, 'in'],
        ],
        connectors: [
            [-3, 0],
            [0, 3],
        ],
        currentConnections: true,
        selected: [3, -3],
        selectedInStore: true,
        staleSelectionRemoved: true,
        sourceNotes: [
            [-3, 1],
            [0, 2],
            [3, 3],
        ],
        sourceUnchanged: true,
        untouched: true,
        groups: true,
        stages: true,
        noHistory: true,
    })
})

test('beat scaling preserves selected destinations and replaces only occupied matching event lanes', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { scaleSelection } = await import('/src/state/operations/scaleSelection.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.events
        const [firstGroup, secondGroup] = [...chart.groups.keys()]
        const [firstStage, secondStage] = [...chart.stages.keys()]
        const camera = chart.cameraEvents[0]!
        const mask = chart.stageMaskEvents[0]!
        const pivot = chart.stagePivotEvents[0]!
        const style = chart.stageStyleEvents[0]!
        const transform = chart.stageTransformEvents[0]!
        const timeScale = chart.timeScales[0]!
        show({
            ...chart,
            slides: [],
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 180 },
                { beat: 8, bpm: 240 },
                { beat: 12, bpm: 200 },
            ],
            timeScales: [
                { ...timeScale, beat: 4, groupId: firstGroup!, timeScale: 1 },
                { ...timeScale, beat: 8, groupId: firstGroup!, timeScale: 9 },
                { ...timeScale, beat: 8, groupId: secondGroup!, timeScale: 3 },
            ],
            cameraEvents: [
                { ...camera, beat: 4, cameraZoom: 1 },
                { ...camera, beat: 8, cameraZoom: 9 },
            ],
            stageMaskEvents: [
                { ...mask, beat: 4, stageId: firstStage!, maskSize: 6 },
                { ...mask, beat: 8, stageId: firstStage!, maskSize: 9 },
                { ...mask, beat: 8, stageId: secondStage!, maskSize: 3 },
            ],
            stagePivotEvents: [
                { ...pivot, beat: 4, stageId: firstStage!, pivotLane: 1 },
                { ...pivot, beat: 8, stageId: firstStage!, pivotLane: 9 },
                { ...pivot, beat: 8, stageId: secondStage!, pivotLane: 3 },
            ],
            stageStyleEvents: [
                { ...style, beat: 4, stageId: firstStage!, noteAlpha: 0.2 },
                { ...style, beat: 8, stageId: firstStage!, noteAlpha: 0.9 },
                { ...style, beat: 8, stageId: secondStage!, noteAlpha: 0.3 },
            ],
            stageTransformEvents: [
                { ...transform, beat: 4, stageId: firstStage!, elevation: 2 },
                { ...transform, beat: 8, stageId: firstStage!, elevation: 9 },
                { ...transform, beat: 8, stageId: secondStage!, elevation: 3 },
            ],
        })
        const source = history.state.value
        const types = [
            'bpm',
            'timeScale',
            'cameraEventJoint',
            'stageMaskEventJoint',
            'stagePivotEventJoint',
            'stageStyleEventJoint',
            'stageTransformEventJoint',
        ] as const
        const selected = types.flatMap((type) =>
            [...source.store.grid[type].values()]
                .flatMap((bucket) => [...bucket])
                .filter((entity) =>
                    entity.type === 'bpm' ? entity.beat !== 12 : entity.beat === 4,
                ),
        )
        const scaled = scaleSelection(source, selected, 'beat', 2)
        const all = <T extends (typeof types)[number]>(type: T) =>
            [...scaled.store.grid[type].values()].flatMap((bucket) => [...bucket])
        return {
            bpms: all('bpm')
                .map((entity) => [entity.beat, entity.bpm])
                .sort((a, b) => a[0]! - b[0]!),
            timeScales: all('timeScale')
                .map((entity) => [entity.groupId === firstGroup, entity.beat, entity.timeScale])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            camera: all('cameraEventJoint').map((entity) => [entity.beat, entity.cameraZoom]),
            mask: all('stageMaskEventJoint')
                .map((entity) => [entity.stageId === firstStage, entity.beat, entity.maskSize])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            pivot: all('stagePivotEventJoint')
                .map((entity) => [entity.stageId === firstStage, entity.beat, entity.pivotLane])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            style: all('stageStyleEventJoint')
                .map((entity) => [entity.stageId === firstStage, entity.beat, entity.noteAlpha])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            transform: all('stageTransformEventJoint')
                .map((entity) => [entity.stageId === firstStage, entity.beat, entity.elevation])
                .sort((a, b) => Number(b[0]) - Number(a[0])),
            selected: scaled.selectedEntities.map((entity) => [entity.type, entity.beat]),
            sourceUnchanged: history.state.value === source,
            originalTempoBeats: [...source.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => entity.beat),
            noHistory: !history.canUndo.value,
        }
    })
    expect(result.bpms).toEqual([
        [0, 120],
        [8, 180],
        [12, 200],
        [16, 240],
    ])
    expect(result.timeScales).toEqual([
        [true, 8, 1],
        [false, 8, 3],
    ])
    expect(result.camera).toEqual([[8, 1]])
    expect(result.mask).toEqual([
        [true, 8, 6],
        [false, 8, 3],
    ])
    expect(result.pivot).toEqual([
        [true, 8, 1],
        [false, 8, 3],
    ])
    expect(result.style).toEqual([
        [true, 8, 0.2],
        [false, 8, 0.3],
    ])
    expect(result.transform).toEqual([
        [true, 8, 2],
        [false, 8, 3],
    ])
    expect(result.selected).toEqual([
        ['bpm', 0],
        ['bpm', 8],
        ['bpm', 16],
        ['timeScale', 8],
        ['cameraEventJoint', 8],
        ['stageMaskEventJoint', 8],
        ['stagePivotEventJoint', 8],
        ['stageStyleEventJoint', 8],
        ['stageTransformEventJoint', 8],
    ])
    expect(result.sourceUnchanged).toBe(true)
    expect(result.originalTempoBeats).toEqual([0, 4, 8, 12])
    expect(result.noHistory).toBe(true)
})

test('notes and stage transforms share an elevation anchor and undo restores the original state', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { scaleSelection } = await import('/src/state/operations/scaleSelection.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.events
        const base = fixtures.interaction.slides[0]![0]!
        const transform = chart.stageTransformEvents[0]!
        show({
            ...chart,
            slides: [[{ ...base, beat: 4, left: -3, size: 2, elevation: 3 }]],
            stageTransformEvents: [
                { ...transform, beat: 0, elevation: -1 },
                { ...transform, beat: 8, elevation: 1 },
            ],
        })
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat()[0]!
        const transforms = [...source.store.grid.stageTransformEventJoint.values()].flatMap(
            (bucket) => [...bucket],
        )
        const camera = [...source.store.grid.cameraEventJoint.values()].flatMap((bucket) => [
            ...bucket,
        ])[0]!
        const scaled = scaleSelection(source, [note, ...transforms, camera], 'elevation', 2)
        const updated = [...scaled.store.slides.note.values()].flat()[0]!
        const stageElevations = [...scaled.store.grid.stageTransformEventJoint.values()]
            .flatMap((bucket) => [...bucket])
            .map((entity) => [entity.beat, entity.elevation])
        history.pushState(() => 'Scale elevation', scaled)
        const committed = history.state.value === scaled && history.canUndo.value
        history.undoState()
        const undone = history.state.value === source && !history.canUndo.value
        history.redoState()
        return {
            note: [updated.beat, updated.left, updated.size, updated.elevation],
            transforms: stageElevations,
            cameraRetained: scaled.selectedEntities.includes(camera),
            sourceNote: [note.beat, note.elevation],
            sourceTransforms: transforms.map((entity) => entity.elevation),
            committed,
            undone,
            redone: history.state.value === scaled,
        }
    })
    expect(result).toEqual({
        note: [4, -3, 2, 7],
        transforms: [
            [0, -1],
            [8, 3],
        ],
        cameraRetained: true,
        sourceNote: [4, 3],
        sourceTransforms: [-1, 1],
        committed: true,
        undone: true,
        redone: true,
    })
})

test('invalid factors, excessive grid spans, and read-only attached elevations do not change state', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { scaleSelection } = await import('/src/state/operations/scaleSelection.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [
                    { ...base, beat: 0, elevation: 0 },
                    { ...base, beat: 2, elevation: 9, isAttached: true },
                    { ...base, beat: 4, elevation: 2 },
                ],
                [{ ...base, beat: 2, elevation: 5 }],
            ],
        })
        const source = history.state.value
        const [slide, standalone] = [...source.store.slides.note.values()]
        if (!slide || !standalone) throw new Error('Missing scale fixture')
        const selected = [slide[0]!, slide[2]!]
        const factors = [0, -1, 1, Number.NaN, Infinity, -Infinity, 1e12, Number.MAX_VALUE]
        return {
            invalidBeats: factors.map(
                (factor) => scaleSelection(source, selected, 'beat', factor) === source,
            ),
            invalidElevations: factors
                .slice(0, 6)
                .map((factor) => scaleSelection(source, selected, 'elevation', factor) === source),
            attached:
                scaleSelection(source, [slide[1]!, standalone[0]!], 'elevation', 2) === source,
            beats: slide.map((note) => note.beat),
            elevations: slide.map((note) => note.elevation),
            sourceUnchanged: history.state.value === source,
            noHistory: !history.canUndo.value,
        }
    })
    expect(result).toEqual({
        invalidBeats: Array(8).fill(true),
        invalidElevations: Array(6).fill(true),
        attached: true,
        beats: [0, 2, 4],
        elevations: [0, 9, 2],
        sourceUnchanged: true,
        noHistory: true,
    })
})

test('a negative beat anchor retains the mandatory initial BPM while scaling selected timing points', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { scaleSelection } = await import('/src/state/operations/scaleSelection.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 180 },
                { beat: 8, bpm: 240 },
            ],
            slides: [[{ ...base, beat: -2 }]],
        })
        const source = history.state.value
        const note = [...source.store.slides.note.values()].flat()[0]!
        const selectedBpms = [...source.store.grid.bpm.values()]
            .flatMap((bucket) => [...bucket])
            .filter((entity) => entity.beat !== 8)
        const scaled = scaleSelection(source, [...selectedBpms, note], 'beat', 2)
        return {
            bpms: [...scaled.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.beat, entity.bpm])
                .sort((a, b) => a[0]! - b[0]!),
            selected: scaled.selectedEntities.map((entity) => [entity.type, entity.beat]),
            initialSource: [...source.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((entity) => [entity.beat, entity.bpm]),
            anchorRetained: scaled.store.slides.note.get(note.slideId)?.[0] === note,
            sourceUnchanged: history.state.value === source,
            noHistory: !history.canUndo.value,
        }
    })
    expect(result).toEqual({
        bpms: [
            [0, 120],
            [2, 120],
            [8, 240],
            [10, 180],
        ],
        selected: [
            ['bpm', 2],
            ['bpm', 10],
            ['note', -2],
        ],
        initialSource: [
            [0, 120],
            [4, 180],
            [8, 240],
        ],
        anchorRetained: true,
        sourceUnchanged: true,
        noHistory: true,
    })
})
