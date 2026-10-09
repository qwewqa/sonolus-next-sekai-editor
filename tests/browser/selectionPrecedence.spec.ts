import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const point = (page: Page) => page.evaluate(() => window.editorTest.point(0, 4))
const selected = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities.map((entity) =>
            entity.type === 'note' ? `note:${entity.noteStyle}` : entity.type,
        ),
    )
const click = async (page: Page) => {
    const at = await point(page)
    await page.mouse.click(at.x, at.y)
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, settings, view, appImport } = window.editorTest
        const events = fixtures.events
        const note = { ...fixtures.interaction.slides[0]![0]!, beat: 4, left: -1, size: 2 }
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 4, bpm: 120 },
                ],
                cameraEvents: [
                    { ...events.cameraEvents[0]!, beat: 4, cameraLeft: -2, cameraSize: 4 },
                ],
                stageMaskEvents: [
                    { ...events.stageMaskEvents[0]!, beat: 4, maskLeft: -2, maskSize: 4 },
                ],
                stagePivotEvents: [
                    { ...events.stagePivotEvents[0]!, beat: 4, pivotLane: 0, yOffset: 0 },
                ],
                stageStyleEvents: [{ ...events.stageStyleEvents[0]!, beat: 4, editorLane: 0 }],
                stageTransformEvents: [
                    { ...events.stageTransformEvents[0]!, beat: 4, xTranslation: 0 },
                ],
                timeScales: [{ ...events.timeScales[0]!, beat: 4, editorLane: 0, timeScale: 1 }],
                slides: [
                    [{ ...note, noteStyle: 'red' }],
                    [{ ...note, noteStyle: 'blue', groupId: 2 as typeof note.groupId }],
                    [
                        { ...note, beat: 2 },
                        { ...note, beat: 6 },
                    ],
                ],
            },
            2,
        )
        settings.showPreview = false
        settings.showSidebar = false
        settings.mouseSecondaryTool = 'selectContextMenu'
        view.layout = 'basic'
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('select')
    })
})

for (const layout of ['basic', 'composed'] as const) {
    test(`${layout} clicks cycle notes then event categories in requested priority`, async ({
        page,
    }) => {
        await page.evaluate((layout) => {
            window.editorTest.view.layout = layout
        }, layout)
        const expected = [
            'note:red',
            'note:blue',
            'stageTransformEventJoint',
            'stageStyleEventJoint',
            'stagePivotEventJoint',
            'stageMaskEventJoint',
            'cameraEventJoint',
            'timeScale',
            'note:red',
        ]
        for (const entity of expected) {
            await click(page)
            expect(await selected(page)).toEqual([entity])
        }
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

for (const layout of ['basic', 'composed'] as const) {
    test(`${layout} fixed BPM lane cycles notes then time scale then BPM`, async ({ page }) => {
        await page.evaluate((layout) => {
            const { fixtures, show, view } = window.editorTest
            const note = { ...fixtures.interaction.slides[0]![0]!, beat: 4, left: 5.5, size: 2 }
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    bpms: [
                        { beat: 0, bpm: 120 },
                        { beat: 4, bpm: 120 },
                    ],
                    timeScales: [
                        {
                            ...fixtures.events.timeScales[0]!,
                            beat: 4,
                            editorLane: 6.5,
                            timeScale: 1,
                        },
                    ],
                    slides: [[{ ...note, noteStyle: 'red' }], [{ ...note, noteStyle: 'blue' }]],
                },
                2,
            )
            view.layout = layout
        }, layout)
        const at = await page.evaluate(() => window.editorTest.point(6.5, 4))
        for (const entity of ['note:red', 'note:blue', 'timeScale', 'bpm', 'note:red']) {
            await page.mouse.click(at.x, at.y)
            expect(await selected(page)).toEqual([entity])
        }
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

test('category sorting preserves typed-note and box hit order and excludes connector bodies', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport } = window.editorTest
        const hits = await appImport<typeof import('../../src/editor/tools/utils')>(
            '/src/editor/tools/utils.ts',
        )
        const at = window.editorTest.point(0, 4)
        const all = hits.hitAllEntitiesAtPoint(at.x, at.y)
        const typed = hits.hitEntitiesAtPoint('note', at.x, at.y)
        const box = hits.hitAllEntitiesInSelection({
            laneMin: -0.1,
            laneMax: 0.1,
            timeMin: 1.99,
            timeMax: 2.01,
        })
        return {
            pointNotes: all
                .filter((entity) => entity.type === 'note')
                .map((note) => note.noteStyle),
            typedNotes: typed.map((note) => note.noteStyle),
            boxTypes: box.map((entity) => entity.type),
            pointTypes: all.map((entity) => entity.type),
        }
    })
    expect(result.pointNotes).toEqual(['red', 'blue'])
    expect(result.pointNotes).toEqual(result.typedNotes)
    expect(result.pointTypes).not.toContain('connector')
    expect(result.boxTypes).not.toEqual(result.pointTypes)
    expect([...result.boxTypes].sort()).toEqual([...result.pointTypes].sort())
})

test('hidden and dimmed notes are excluded before category priority applies', async ({ page }) => {
    await page.evaluate(() => {
        const { view } = window.editorTest
        view.groupVisibility = new Map([[2 as NonNullable<typeof view.groupId>, 'hidden']])
    })
    await click(page)
    expect(await selected(page)).toEqual(['note:red'])
    await click(page)
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
    await page.evaluate(() => {
        const { view, history } = window.editorTest
        view.groupVisibility = new Map()
        view.groupId = 1 as NonNullable<typeof view.groupId>
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await click(page)
    expect(await selected(page)).toEqual(['note:red'])
    await click(page)
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
    await page.evaluate(() => {
        const { view, history } = window.editorTest
        view.visibilities = { ...view.visibilities, note: false }
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await click(page)
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
})

test('an already selected event keeps context-menu and drag ownership over notes', async ({
    page,
}) => {
    for (let i = 0; i < 3; i++) await click(page)
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
    const at = await point(page)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
    await page.keyboard.press('Escape')
    const delta = await page.evaluate(
        () => window.editorTest.view.w / window.editorTest.settings.width,
    )
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + delta, at.y, { steps: 5 })
    await page.mouse.up()
    expect(await selected(page)).toEqual(['stageTransformEventJoint'])
    expect(
        await page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()]
                .filter((entity) => entity.type === 'stageTransformEventJoint')
                .map((entity) => entity.xTranslation),
        ),
    ).toEqual([1])
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()]
                .flat()
                .every((note) => note.left === -1),
        ),
    ).toBe(true)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('Eraser chooses the first note ahead of overlapping events', async ({ page }) => {
    await page.evaluate(async () => {
        const { switchToolTo } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools')
        >('/src/editor/tools/index.ts')
        switchToolTo('eraser')
    })
    await click(page)
    expect(
        await page.evaluate(() =>
            [...window.editorTest.history.state.value.store.slides.note.values()]
                .flat()
                .filter((note) => note.beat === 4)
                .map((note) => note.noteStyle),
        ),
    ).toEqual(['blue'])
    expect(
        await page.evaluate(
            () =>
                [...window.editorTest.store.getAllEntities()].filter(
                    (entity) => entity.type === 'stageTransformEventJoint',
                ).length,
        ),
    ).toBe(1)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
