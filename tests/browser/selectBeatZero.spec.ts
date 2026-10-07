import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// A Select move that would start before beat 0 stops there as a whole, ghost included.

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

type Brief = { beat: number; left: number; isAttached: boolean }
const brief = (notes: Brief[]) =>
    notes
        .map(({ beat, left, isAttached }) => ({ beat, left, isAttached }))
        .sort((a, b) => a.beat - b.beat)

/** Head at 1, attached tick at 2, tail at 3, all selected, plus the beat-0 BPM if asked. */
const seedSlide = (page: Page, withBpm: boolean) =>
    page.evaluate((withBpm) => {
        const { show, fixtures, history, view, store } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 1, left: -4 },
                        { ...base, beat: 2, isAttached: true },
                        { ...base, beat: 3, left: -2 },
                    ],
                ],
            },
            1.5,
        )
        view.snapping = 'absolute'
        view.division = 4

        history.replaceState({
            ...history.state.value,
            selectedEntities: [
                ...[...history.state.value.store.slides.note.values()].flat(),
                ...(withBpm
                    ? [...store.getAllEntities()].filter(
                          (entity) => entity.type === 'bpm' && entity.beat === 0,
                      )
                    : []),
            ],
        })
    }, withBpm)

const dragTail = async (page: Page) => {
    const start = await point(page, -1, 3)
    const end = await point(page, -1, 0.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, (start.y + end.y) / 2)
    await page.mouse.move(end.x, end.y)
    await settle(page)
    const ghost = await page.evaluate(() =>
        window.editorTest.view.entities.creating.flatMap((entity) =>
            entity.type === 'note'
                ? [{ beat: entity.beat, left: entity.left, isAttached: entity.isAttached }]
                : [],
        ),
    )
    await page.mouse.up()
    await settle(page)
    return ghost
}

const result = (page: Page) =>
    page.evaluate(async () => {
        const { history, appImport } = window.editorTest
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const { parseLevelDataChart } = await appImport<
            typeof import('../../src/chart/parse/levelData/index')
        >('/src/chart/parse/levelData/index.ts')
        const state = history.state.value
        const notes = [...state.store.slides.note.values()].flat()
        const level = serializeToLevelData(
            state.initialLife,
            state.isDynamicStages,
            state.bgm.offset,
            state.store,
            state.groups,
            state.stages,
        )
        const reparsed = parseLevelDataChart(level.entities)
        return {
            notes,
            slides: new Set(notes.map((note) => note.slideId)).size,
            bpms: [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
                entity.type === 'bpm' ? [{ beat: entity.beat, bpm: entity.bpm }] : [],
            ),
            reparsed: reparsed.slides.map((slide) =>
                slide.map(({ beat, left, isAttached }) => ({ beat, left, isAttached })),
            ),
        }
    })

const moved = [
    { beat: 0, left: -4, isAttached: false },
    { beat: 1, left: -3, isAttached: true },
    { beat: 2, left: -2, isAttached: false },
]

test('a Select move that would start before beat 0 moves the whole slide, as its ghost shows', async ({
    page,
}) => {
    await seedSlide(page, false)
    expect(brief(await dragTail(page))).toEqual(moved)
    const { notes, slides, reparsed } = await result(page)
    expect(brief(notes)).toEqual(moved)
    expect(slides).toBe(1)
    // The tick stays attached through save and reopen.
    expect(reparsed).toEqual([moved])
})

test('the beat-0 BPM stays put in a Select move earlier and does not stop the rest', async ({
    page,
}) => {
    await seedSlide(page, true)
    expect(brief(await dragTail(page))).toEqual(moved)
    const { notes, slides, bpms } = await result(page)
    expect(brief(notes)).toEqual(moved)
    expect(slides).toBe(1)
    expect(bpms).toEqual([{ beat: 0, bpm: 120 }])
})
