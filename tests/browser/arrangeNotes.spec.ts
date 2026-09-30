import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('combine shortcut includes whole interleaved slides and supports undo and redo', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        const red = { ...base, connectorStyle: 'red' as const }
        const blue = { ...base, connectorStyle: 'blue' as const }
        show({
            ...chart,
            slides: [
                [
                    { ...red, beat: 1, left: -4 },
                    { ...red, beat: 3, left: 0 },
                ],
                [
                    { ...blue, beat: 2, left: -2 },
                    { ...blue, beat: 4, left: 2 },
                ],
                [{ ...base, beat: 9, left: 5 }],
            ],
        })
        const slides = [...history.state.value.store.slides.note.values()]
        history.replaceState({
            ...history.state.value,
            selectedEntities: [slides[1]![0]!, slides[0]![0]!],
        })
    })
    await page.keyboard.press('k')
    const combined = await page.evaluate(() => {
        const current = window.editorTest.history.state.value
        return {
            slides: [...current.store.slides.note.values()].map((notes) =>
                notes.map((n) => [n.beat, n.left]),
            ),
            selected: current.selectedEntities.map((n) => n.beat),
            connectors: [...current.store.slides.connector.values()]
                .flat()
                .map((c) => [c.head.beat, c.tail.beat, c.segmentHead.connectorStyle]),
        }
    })
    expect(combined.slides).toEqual([
        [[9, 5]],
        [
            [1, -4],
            [2, -2],
            [3, 0],
            [4, 2],
        ],
    ])
    expect(combined.selected).toEqual([1, 2, 3, 4])
    expect(combined.connectors).toEqual([
        [1, 2, 'red'],
        [2, 3, 'blue'],
        [3, 4, 'red'],
    ])
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((n) => n.beat),
            ),
        ),
    ).toEqual([[1, 3], [2, 4], [9]])
    await page.keyboard.press('y')
    expect(
        await page.evaluate(() =>
            window.editorTest.history.state.value.selectedEntities.map((n) => n.beat),
        ),
    ).toEqual([1, 2, 3, 4])
})

test('combining any subset of one slide is a no-op; tied beats have stable source order', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { combineNotes } = await import('/src/state/operations/combineNotes.ts')
        const { commands } = await import('/src/editor/commands/index.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [1, 2, 3].map((beat) => ({ ...base, beat, left: 2 })),
                [
                    { ...base, beat: 2, left: -3 },
                    { ...base, beat: 4, left: 0 },
                ],
            ],
        })
        const slides = [...history.state.value.store.slides.note.values()]
        const first = slides[0]!
        history.replaceState({ ...history.state.value, selectedEntities: first.slice(0, 2) })
        const source = history.state.value
        await commands.combineNotes.execute()
        const noHistory = history.state.value === source && !history.canUndo.value
        const forward = combineNotes(source, [first[0]!, slides[1]![0]!])
        const backward = combineNotes(source, [slides[1]![0]!, first[0]!])
        const ordered = (s: typeof source) =>
            [...s.store.slides.note.values()].flat().map((n) => [n.beat, n.left])
        return {
            noHistory,
            single: combineNotes(source, [first[1]!]) === source,
            empty: combineNotes(source, []) === source,
            whole: combineNotes(source, first) === source,
            forward: ordered(forward),
            backward: ordered(backward),
        }
    })
    expect(result).toMatchObject({ noHistory: true, single: true, empty: true, whole: true })
    expect(result.forward).toEqual([
        [1, 2],
        [2, 2],
        [2, -3],
        [3, 2],
        [4, 0],
    ])
    expect(result.backward).toEqual(result.forward)
})

test('vertical shortcut reverses full slides with their colors and easing but keeps flick directions', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [
                    {
                        ...base,
                        beat: 1,
                        left: -4,
                        connectorStyle: 'blue',
                        connectorEase: 'in',
                        flickDirection: 'upLeft',
                    },
                    {
                        ...base,
                        beat: 2,
                        left: -3,
                        connectorStyle: 'yellow',
                        isAttached: true,
                        flickDirection: 'downRight',
                    },
                    {
                        ...base,
                        beat: 3,
                        left: -2,
                        size: 3,
                        isConnectorSeparator: true,
                        connectorType: 'guide',
                        connectorStyle: 'purple',
                        connectorEase: 'out',
                        connectorGuideAlpha: 0.2,
                    },
                    {
                        ...base,
                        beat: 6,
                        left: 2,
                        connectorStyle: 'black',
                        connectorEase: 'inOut',
                        connectorGuideAlpha: 0.8,
                    },
                ],
            ],
        })
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    const original = await page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()].flat(),
    )
    await page.keyboard.press('Shift+U')
    const flipped = await page.evaluate(() => {
        const { state } = window.editorTest.history
        return {
            notes: [...state.value.store.slides.note.values()].flat(),
            connectors: [...state.value.store.slides.connector.values()]
                .flat()
                .map((c) => [
                    c.head.beat,
                    c.tail.beat,
                    c.segmentHead.connectorType,
                    c.segmentHead.connectorStyle,
                ]),
        }
    })
    expect(flipped.notes.map((n) => n.beat)).toEqual([1, 4, 5, 6])
    expect(flipped.notes.map((n) => n.flickDirection)).toEqual([
        'none',
        'none',
        'downRight',
        'upLeft',
    ])
    expect(flipped.notes.map((n) => n.left)).toEqual([2, -2, -3.5, -4])
    expect(flipped.notes[0]).toMatchObject({
        connectorStyle: 'purple',
        connectorType: 'guide',
        connectorEase: 'in',
        connectorGuideAlpha: 0.8,
    })
    expect(flipped.notes[1]).toMatchObject({
        connectorStyle: 'blue',
        connectorType: 'active',
        connectorEase: 'out',
        connectorGuideAlpha: 0.2,
    })
    expect(flipped.connectors).toEqual([
        [1, 4, 'guide', 'purple'],
        [4, 6, 'active', 'blue'],
    ])
    await page.keyboard.press('Shift+U')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].flat(),
        ),
    ).toEqual(original)
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].flat(),
        ),
    ).toEqual(flipped.notes)
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].flat(),
        ),
    ).toEqual(original)
})

test('vertical flip swaps timing points without losing tempo, event, group or stage data', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { flipVertical } = await import('/src/state/operations/flipVertical.ts')
        const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const { validateChart } = await import('/src/chart/validate.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.events
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...chart,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 180 },
            ],
            slides: [[{ ...base, beat: 8 }]],
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
            'note',
        ] as const
        const selected = types.flatMap((type) =>
            [...source.store.grid[type].values()].flatMap((bucket) => [...bucket]),
        )
        const flipped = flipVertical(source, selected)
        const level = serializeToLevelData(
            flipped.initialLife,
            flipped.isDynamicStages,
            flipped.bgm.offset,
            flipped.store,
            flipped.groups,
            flipped.stages,
        )
        validateChart(parseLevelDataChart(level.entities))
        const expected = selected
            .map((n) => ({ type: n.type, beat: 19.5 - n.beat }))
            .sort((a, b) => a.type.localeCompare(b.type) || a.beat - b.beat)
        const actual = flipped.selectedEntities
            .map((n) => ({ type: n.type, beat: n.beat }))
            .sort((a, b) => a.type.localeCompare(b.type) || a.beat - b.beat)
        return {
            expected,
            actual,
            bpms: [...flipped.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((n) => [n.beat, n.bpm])
                .sort((a, b) => a[0]! - b[0]!),
            originalBpms: [...source.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((n) => [n.beat, n.bpm]),
            sourceUnchanged: history.state.value === source,
            groupsUnchanged: flipped.groups === source.groups,
            stagesUnchanged: flipped.stages === source.stages,
        }
    })
    expect(result.actual).toEqual(result.expected)
    expect(result.bpms).toEqual([
        [0, 120],
        [15.5, 180],
        [19.5, 120],
    ])
    expect(result.originalBpms).toEqual([
        [0, 120],
        [4, 180],
    ])
    expect(result).toMatchObject({
        sourceUnchanged: true,
        groupsUnchanged: true,
        stagesUnchanged: true,
    })
})

test('combining preserves attached note positions and connector colors from their original slides', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { combineNotes } = await import('/src/state/operations/combineNotes.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [
                    {
                        ...base,
                        beat: 1,
                        left: -5,
                        connectorEase: 'in',
                        connectorType: 'guide',
                        connectorStyle: 'purple',
                    },
                    { ...base, beat: 3, left: -4, isAttached: true },
                    { ...base, beat: 5, left: 3 },
                ],
                [{ ...base, beat: 2, left: 4, connectorType: 'damage', connectorStyle: 'cyan' }],
            ],
        })
        const source = history.state.value
        const slides = [...source.store.slides.note.values()]
        const selected = [slides[0]![1]!, slides[1]![0]!]
        const combined = combineNotes(source, selected)
        const positions = (s: typeof source) =>
            [...s.store.slides.note.values()]
                .flat()
                .map((n) => [n.beat, n.left, n.size, n.noteStyle, n.flickDirection])
                .sort((a, b) => Number(a[0]) - Number(b[0]))
        return {
            before: positions(source),
            after: positions(combined),
            originalAttached: slides[0]![1]!.isAttached,
            selected: combined.selectedEntities.length,
            segments: [...combined.store.slides.connector.values()]
                .flat()
                .map((c) => [
                    c.head.beat,
                    c.tail.beat,
                    c.segmentHead.connectorType,
                    c.segmentHead.connectorStyle,
                ]),
        }
    })
    expect(result.after).toEqual(result.before)
    expect(result.originalAttached).toBe(true)
    expect(result.selected).toBe(4)
    expect(result.segments).toEqual([
        [1, 2, 'guide', 'purple'],
        [2, 3, 'damage', 'cyan'],
        [3, 5, 'guide', 'purple'],
    ])
})

test('vertical flip handles occupied timing destinations within each group and leaves unselected notes alone', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { flipVertical } = await import('/src/state/operations/flipVertical.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        const timeScale = fixtures.events.timeScales[0]!
        const groupIds = [...chart.groups.keys()]
        show({
            ...chart,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 4, bpm: 180 },
            ],
            timeScales: [
                { ...timeScale, groupId: groupIds[0]!, beat: 1, timeScale: 2 },
                { ...timeScale, groupId: groupIds[0]!, beat: 3, timeScale: 3 },
                { ...timeScale, groupId: groupIds[1]!, beat: 3, timeScale: 4 },
            ],
            slides: [[{ ...base, beat: 0 }], [{ ...base, beat: 10 }]],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        const selected = [
            notes[0]!,
            ...[...source.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .filter((n) => n.beat === 4),
            ...[...source.store.grid.timeScale.values()]
                .flatMap((bucket) => [...bucket])
                .filter((n) => n.beat === 1),
        ]
        const flipped = flipVertical(source, selected)
        return {
            untouched: flipped.store.slides.note.get(notes[1]!.slideId)?.[0] === notes[1],
            selected: flipped.selectedEntities.map((n) => [n.type, n.beat]),
            bpms: [...flipped.store.grid.bpm.values()]
                .flatMap((bucket) => [...bucket])
                .map((n) => [n.beat, n.bpm]),
            timeScales: [...flipped.store.grid.timeScale.values()]
                .flatMap((bucket) => [...bucket])
                .map((n) => [n.beat, n.timeScale])
                .sort((a, b) => a[1]! - b[1]!),
            sameBeatNoOp: flipVertical(source, [notes[0]!]) === source,
        }
    })
    expect(result.untouched).toBe(true)
    expect(result.sameBeatNoOp).toBe(true)
    expect(result.selected).toEqual([
        ['note', 4],
        ['bpm', 0],
        ['timeScale', 3],
    ])
    expect(result.bpms).toEqual([[0, 180]])
    expect(result.timeScales).toEqual([
        [3, 2],
        [3, 4],
    ])
})
