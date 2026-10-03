import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test('combine detaches attached notes at their displayed elevation instead of their stored value', async ({
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
                    { ...base, beat: 0, elevation: 2 },
                    { ...base, beat: 2, elevation: 9, isAttached: true },
                    { ...base, beat: 4, elevation: 4 },
                ],
                [{ ...base, beat: 1, elevation: 0 }],
            ],
        })
        const source = history.state.value
        const combined = combineNotes(source, [...source.store.slides.note.values()].flat())
        const middle = [...combined.store.slides.note.values()]
            .flat()
            .find((note) => note.beat === 2)!
        return {
            elevation: middle.elevation,
            attached: middle.isAttached,
            original: [...source.store.slides.note.values()][0]![1]!.elevation,
        }
    })
    expect(result).toEqual({ elevation: 3, attached: false, original: 9 })
})

test('combine preserves attached lane, width and elevation across BPM changes and different stages', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { combineNotes } = await import('/src/state/operations/combineNotes.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        const [headStage, tailStage] = [...chart.stages.keys()]
        show({
            ...chart,
            isDynamicStages: true,
            bpms: [
                { beat: 0, bpm: 120 },
                { beat: 2, bpm: 60 },
            ],
            stageTransformEvents: [
                {
                    stageId: headStage!,
                    beat: 0,
                    elevation: 1,
                    rotation: 0,
                    xTranslation: 0,
                    yTranslation: 0,
                    anchor: 'default',
                    eventEase: 'none',
                },
                {
                    stageId: tailStage!,
                    beat: 0,
                    elevation: 3,
                    rotation: 0,
                    xTranslation: 0,
                    yTranslation: 0,
                    anchor: 'default',
                    eventEase: 'none',
                },
            ],
            stagePivotEvents: [
                {
                    stageId: headStage!,
                    beat: 0,
                    pivotLane: 2,
                    divisionSize: 1,
                    divisionParity: 'even',
                    yOffset: 0,
                    yOffsetBeat: 0,
                    eventEase: 'none',
                },
                {
                    stageId: tailStage!,
                    beat: 0,
                    pivotLane: -2,
                    divisionSize: 1,
                    divisionParity: 'even',
                    yOffset: 0,
                    yOffsetBeat: 0,
                    eventEase: 'none',
                },
            ],
            slides: [
                [
                    { ...base, stageId: headStage!, beat: 0, left: -4, size: 2, elevation: 2 },
                    {
                        ...base,
                        stageId: headStage!,
                        beat: 2,
                        left: 0,
                        size: 1,
                        elevation: 9,
                        isAttached: true,
                    },
                    { ...base, stageId: tailStage!, beat: 4, left: 4, size: 4, elevation: 4 },
                ],
                [{ ...base, stageId: headStage!, beat: 1, left: 6, elevation: 0 }],
            ],
        })
        const source = history.state.value
        const combined = combineNotes(source, [...source.store.slides.note.values()].flat())
        const notes = [...combined.store.slides.note.values()].flat()
        const middle = notes.find((note) => note.beat === 2)!
        return {
            left: middle.left,
            size: middle.size,
            elevation: middle.elevation,
            center: middle.left + middle.size / 2 + 2,
            totalElevation: middle.elevation + 1,
            ordinary: notes
                .filter((note) => note.beat !== 2)
                .map((note) => [note.beat, note.left, note.size, note.elevation]),
        }
    })
    expect(result.left).toBeCloseTo(-8 / 3)
    expect(result.size).toBeCloseTo(8 / 3)
    expect(result.elevation).toBeCloseTo(10 / 3)
    expect(result.center).toBeCloseTo(2 / 3)
    expect(result.totalElevation).toBeCloseTo(13 / 3)
    expect(result.ordinary).toEqual([
        [0, -4, 2, 2],
        [1, 6, 2, 0],
        [4, 4, 4, 4],
    ])
})

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('combine joins independent notes at one beat from low to high elevation and supports undo', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({ ...chart, slides: [5, 1, 3].map((elevation) => [{ ...base, beat: 4, elevation }]) })
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat().reverse(),
        })
    })
    await page.keyboard.press('k')
    const elevations = () =>
        page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.elevation),
            ),
        )
    expect(await elevations()).toEqual([[1, 3, 5]])
    await page.keyboard.press('z')
    expect(await elevations()).toEqual([[5], [1], [3]])
    await page.keyboard.press('y')
    expect(await elevations()).toEqual([[1, 3, 5]])
})

test('combine retains existing downward connector order while placing independent notes by elevation', async ({
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
                [5, 1].map((elevation) => ({ ...base, beat: 4, elevation })),
                [{ ...base, beat: 4, elevation: 3 }],
            ],
        })
        const source = history.state.value
        const selected = [...source.store.slides.note.values()].flat().reverse()
        const combined = combineNotes(source, selected)
        return {
            elevations: [...combined.store.slides.note.values()]
                .flat()
                .map((note) => note.elevation),
            connections: [...combined.store.slides.connector.values()]
                .flat()
                .map((connector) => [connector.head.elevation, connector.tail.elevation]),
            original: [...source.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.elevation),
            ),
        }
    })
    expect(result.elevations).toEqual([3, 5, 1])
    expect(result.connections).toEqual([
        [3, 5],
        [5, 1],
    ])
    expect(result.original).toEqual([[5, 1], [3]])
})

test('combine sorts equal-beat notes by total stage and note elevation while time stays primary', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { combineNotes } = await import('/src/state/operations/combineNotes.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        const [raised, ground] = [...chart.stages.keys()]
        show({
            ...chart,
            isDynamicStages: true,
            stageTransformEvents: [
                {
                    stageId: raised!,
                    beat: 0,
                    elevation: 4,
                    rotation: 0,
                    xTranslation: 0,
                    yTranslation: 0,
                    anchor: 'default',
                    eventEase: 'none',
                },
            ],
            slides: [
                [{ ...base, stageId: raised!, beat: 4, elevation: 0, left: -4 }],
                [{ ...base, stageId: ground!, beat: 4, elevation: 2, left: 2 }],
                [{ ...base, stageId: ground!, beat: 3, elevation: 5, left: 5 }],
            ],
        })
        const source = history.state.value
        const combined = combineNotes(source, [...source.store.slides.note.values()].flat())
        return [...combined.store.slides.note.values()]
            .flat()
            .map((note) => [note.beat, note.left, note.elevation])
    })
    expect(result).toEqual([
        [3, 5, 5],
        [4, 2, 2],
        [4, -4, 0],
    ])
})
