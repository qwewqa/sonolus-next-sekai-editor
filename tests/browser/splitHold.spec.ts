import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('splits after each selected note, preserves selection and supports undo and redo', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { fixtures, show, history, settings } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({ ...chart, slides: [[0, 1, 2, 3, 4].map((beat) => ({ ...base, beat }))] })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()][0]!
        history.replaceState({ ...source, selectedEntities: [notes[1]!, notes[3]!] })
        settings.toolbar = [['splitHold']]
    })
    await page.getByRole('button', { name: 'Split Slide', exact: true }).click()
    const snapshot = () =>
        page.evaluate(() => {
            const source = window.editorTest.history.state.value
            return {
                slides: [...source.store.slides.note.values()].map((notes) =>
                    notes.map((note) => note.beat),
                ),
                connectors: [...source.store.slides.connector.values()]
                    .flat()
                    .map((c) => [c.head.beat, c.tail.beat]),
                selected: source.selectedEntities.map((note) => note.beat),
                liveSelection: source.selectedEntities.every(
                    (entity) =>
                        entity.type === 'note' &&
                        source.store.slides.note.get(entity.slideId)?.includes(entity),
                ),
            }
        })
    const split = {
        slides: [[0, 1], [2, 3], [4]],
        connectors: [
            [0, 1],
            [2, 3],
        ],
        selected: [1, 3],
        liveSelection: true,
    }
    expect(await snapshot()).toEqual(split)
    await page.keyboard.press('z')
    expect((await snapshot()).slides).toEqual([[0, 1, 2, 3, 4]])
    await page.keyboard.press('y')
    expect(await snapshot()).toEqual(split)
})

test('materializes disrupted attachments while preserving complete attachment intervals', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { splitHold } = await import('/src/state/operations/splitHold.ts')
        const { getMaterializedNotePositions } =
            await import('/src/state/operations/notePositions.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [
                [
                    { ...base, beat: 0, left: -4, size: 2, elevation: 2, connectorEase: 'inQuad' },
                    { ...base, beat: 1, elevation: 9, isAttached: true },
                    { ...base, beat: 2, elevation: 9, isAttached: true },
                    { ...base, beat: 4, left: 4, size: 4, elevation: 4 },
                    { ...base, beat: 5, elevation: 9, isAttached: true },
                    { ...base, beat: 6, left: 2, size: 2, elevation: 6 },
                ],
            ],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()][0]!
        const positions = getMaterializedNotePositions(source, notes)
        const output = splitHold(source, [notes[1]!])
        const after = [...output.store.slides.note.values()].flat()
        return {
            expected: [notes[1]!, notes[2]!].map((note) => positions.get(note)),
            actual: after
                .filter((note) => note.beat === 1 || note.beat === 2)
                .map(({ left, size, elevation }) => ({ left, size, elevation })),
            attached: after.map((note) => note.isAttached),
            original: notes.map((note) => note.isAttached),
        }
    })
    expect(result.actual).toEqual(result.expected)
    expect(result.attached).toEqual([false, false, false, false, true, false])
    expect(result.original).toEqual([false, true, true, false, true, false])
})

test('new heads inherit their connector segment settings and equal-beat order stays intact', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { splitHold } = await import('/src/state/operations/splitHold.ts')
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
                        elevation: 0,
                        connectorType: 'guide',
                        connectorStyle: 'green',
                        connectorLayer: 'under',
                    },
                    { ...base, beat: 4, elevation: 1 },
                    {
                        ...base,
                        beat: 4,
                        elevation: 2,
                        isConnectorSeparator: true,
                        connectorType: 'damage',
                        connectorStyle: 'purple',
                    },
                    { ...base, beat: 4, elevation: 3 },
                    { ...base, beat: 4, elevation: 4 },
                ],
            ],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()][0]!
        const output = splitHold(source, [notes[0]!, notes[2]!])
        return {
            pieces: [...output.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.elevation),
            ),
            connectors: [...output.store.slides.connector.values()].flat().map((c) => ({
                elevations: [c.head.elevation, c.tail.elevation],
                type: c.segmentHead.connectorType,
                style: c.segmentHead.connectorStyle,
                layer: c.segmentHead.connectorLayer,
            })),
        }
    })
    expect(result.pieces).toEqual([[0], [1, 2], [3, 4]])
    expect(result.connectors).toEqual([
        { elevations: [1, 2], type: 'guide', style: 'green', layer: 'under' },
        { elevations: [3, 4], type: 'damage', style: 'purple', layer: 'top' },
    ])
})

test('standalone notes and tails are no-ops; mixed selections retain unrelated objects', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { splitHold, getSplitHoldNotes } = await import('/src/state/operations/splitHold.ts')
        const { fixtures, show, history } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [[{ ...base, beat: 1 }], [2, 3, 4].map((beat) => ({ ...base, beat }))],
        })
        const source = history.state.value
        const [single, slide] = [...source.store.slides.note.values()]
        const bpm = [...source.store.grid.bpm.values()].flatMap((entities) => [...entities])[0]!
        const connector = [...source.store.slides.connector.values()].flat()[0]!
        const output = splitHold(source, [single![0]!, slide![0]!, slide![0]!, bpm, connector])
        return {
            noop: splitHold(source, [single![0]!, slide!.at(-1)!]) === source,
            cuts: getSplitHoldNotes(source, [slide![0]!, slide![0]!]).length,
            beats: [...output.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.beat),
            ),
            selected: output.selectedEntities.map((entity) => entity.type),
            bpmUnchanged: output.selectedEntities.includes(bpm),
            groupsUnchanged: output.groups === source.groups,
            sourceBeats: [...source.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.beat),
            ),
        }
    })
    expect(result).toEqual({
        noop: true,
        cuts: 1,
        beats: [[1], [2], [3, 4]],
        selected: ['note', 'note', 'note', 'bpm'],
        bpmUnchanged: true,
        groupsUnchanged: true,
        sourceBeats: [[1], [2, 3, 4]],
    })
})

test('context menu offers Split Slide only for notes with a following connection', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, settings } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({ ...chart, slides: [[3, 4, 5, 6].map((beat) => ({ ...base, beat }))] })
        settings.mouseSecondaryTool = 'selectContextMenu'
    })
    const point = await page.evaluate(() => window.editorTest.point(-3, 4))
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Split Slide', exact: true }).click()
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.beat),
            ),
        ),
    ).toEqual([
        [3, 4],
        [5, 6],
    ])
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Split Slide', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.beat),
            ),
        ),
    ).toEqual([[3, 4, 5, 6]])
})

test('localized Split Slide works in the elevation editor on a phone', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(async () => {
        const { openElevationEditor } = await import('/src/editor/elevation/state.ts')
        const { fixtures, show, history, settings } = window.editorTest
        const chart = fixtures.interaction
        const base = chart.slides[0]![0]!
        show({
            ...chart,
            slides: [[0, 1, 2, 3].map((elevation) => ({ ...base, beat: 4, elevation }))],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()][0]!
        history.replaceState({ ...source, selectedEntities: [notes[1]!] })
        settings.locale = 'ja'
        settings.elevationEditorSideBySide = 'disallow'
        settings.toolbar = [['splitHold']]
        openElevationEditor(4)
    })
    await expect(page.locator('canvas.elevation-canvas')).toBeVisible()
    const button = page.getByRole('button', { name: 'スライドを分割', exact: true })
    await expect(button).toBeVisible()
    const bounds = await button.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath('phone-split-hold.png') })
    await button.click()
    await expect(page.locator('canvas.elevation-canvas')).toBeVisible()
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.elevation),
            ),
        ),
    ).toEqual([
        [0, 1],
        [2, 3],
    ])
    await page.keyboard.press('z')
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()].map((notes) =>
                notes.map((note) => note.elevation),
            ),
        ),
    ).toEqual([[0, 1, 2, 3]])
})

test('Help explains outgoing cuts, final notes and undo in English and Japanese on a phone', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const section = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Split Slide', exact: true }),
    })
    await section.scrollIntoViewIfNeeded()
    await expect(section).toBeVisible()
    await expect(section).toContainText('each selected note to the next note')
    await expect(section).toContainText('Selecting the final note of a slide has no effect.')
    await expect(section).toContainText('All cuts form one undoable edit.')
    const bounds = await section.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await page.evaluate(() => {
        window.editorTest.settings.locale = 'ja'
    })
    const translated = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'スライドを分割', exact: true }),
    })
    await expect(translated).toContainText('選択した各ノーツから次のノーツへの接続が切れ')
    await expect(translated).toContainText('最後のノーツを選択しても変化はありません')
    await expect(translated).toContainText('1回の操作で元に戻せます')
})
