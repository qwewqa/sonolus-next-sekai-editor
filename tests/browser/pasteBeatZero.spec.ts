import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// A paste that would start before beat 0 moves later as a whole, ghost included.

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

const brief = (notes: { beat: number; left: number; isAttached: boolean; slideId?: unknown }[]) =>
    notes
        .map(({ beat, left, isAttached }) => ({ beat, left, isAttached }))
        .sort((a, b) => a.beat - b.beat)

const ghost = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.view.entities.creating.flatMap((entity) =>
            entity.type === 'note'
                ? [{ beat: entity.beat, left: entity.left, isAttached: entity.isAttached }]
                : [],
        ),
    )

const pastedNotes = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities.flatMap((entity) =>
            entity.type === 'note'
                ? [
                      {
                          beat: entity.beat,
                          left: entity.left,
                          isAttached: entity.isAttached,
                          slideId: entity.slideId,
                      },
                  ]
                : [],
        ),
    )

/** Head at 2, tick at 3, attached tick at 4, flick tail at 6, copied from its tail. */
const copySlideFromTail = async (page: Page) => {
    await page.evaluate(() => {
        const { show, fixtures, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 2, left: -2, size: 2 },
                        { ...base, beat: 3, left: -2, size: 2 },
                        { ...base, beat: 4, isAttached: true },
                        { ...base, beat: 6, left: -2, size: 2, flickDirection: 'up' },
                    ],
                ],
            },
            1.5,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    const tail = await point(page, -1, 6)
    await page.mouse.move(tail.x, tail.y)
    await settle(page)
    await page.keyboard.press('c')
    await page.keyboard.press('v')
}

const shifted = [
    { beat: 0, left: -2, isAttached: false },
    { beat: 1, left: -2, isAttached: false },
    { beat: 2, left: -2, isAttached: true },
    { beat: 4, left: -2, isAttached: false },
]

test('a paste that would start before beat 0 lands whole, starting at 0, as its ghost shows', async ({
    page,
}) => {
    await copySlideFromTail(page)
    const target = await point(page, -1, 1)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    expect(brief(await ghost(page))).toEqual(shifted)
    await page.mouse.click(target.x, target.y)
    const pasted = await pastedNotes(page)
    expect(brief(pasted)).toEqual(shifted)
    // One slide, not a lone note.
    expect(new Set(pasted.map((note) => note.slideId)).size).toBe(1)
})

test('dragging a paste below beat 0 keeps it whole, as its ghost shows', async ({ page }) => {
    await copySlideFromTail(page)
    const start = await point(page, -1, 5)
    const end = await point(page, 3, 0.5)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2)
    await page.mouse.move(end.x, end.y)
    await settle(page)
    const moved = shifted.map((note) => ({ ...note, left: note.left + 4 }))
    expect(brief(await ghost(page))).toEqual(moved)
    await page.mouse.up()
    expect(brief(await pastedNotes(page))).toEqual(moved)
})

test('an elevation paste before beat 0 shifts the same way, ghost included', async ({ page }) => {
    await copySlideFromTail(page)
    const result = await page.evaluate(async () => {
        const { history, appImport } = window.editorTest
        const actions = await appImport<typeof import('../../src/editor/elevation/actions')>(
            '/src/editor/elevation/actions.ts',
        )
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        const modifiers = { ctrl: false, shift: false }
        const preview = actions.previewElevationPaste(-1, 0, 1, modifiers)
        await actions.pasteElevationNotes(-1, 0, 1, modifiers)
        const beats = (notes: { beat: number }[]) => notes.map((note) => note.beat).sort()
        return {
            preview: beats(preview),
            pasted: beats(history.state.value.selectedEntities),
        }
    })
    expect(result.preview).toEqual([0, 1, 2, 4])
    expect(result.pasted).toEqual([0, 1, 2, 4])
})

test('a shifted paste keeps a same-beat time scale pair in order', async ({ page }) => {
    const order = await page.evaluate(async () => {
        const { show, fixtures, history, appImport } = window.editorTest
        const { pasteAtPosition } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const clipboard =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        const timeScale = (beat: number, value: number) => ({
            ...fixtures.events.timeScales[0]!,
            beat,
            timeScale: value,
        })
        const base = fixtures.interaction.slides[0]![0]!
        show({
            ...fixtures.events,
            timeScales: [timeScale(2, 2), timeScale(2, 0.5)],
            slides: [[{ ...base, beat: 4 }]],
        })
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...window.editorTest.store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale' || entity.type === 'note',
            ),
        })
        copy.execute()
        // The note anchors at 4; at 1 the pair would land at -1.
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        const data = clipboard.clipboardEntry.value!.data!
        await pasteAtPosition(data.lane, 1 - data.beat, { ctrl: false, shift: false })
        const state = history.state.value
        const { entities } = serializeToLevelData(
            1000,
            true,
            0,
            state.store,
            state.groups,
            state.stages,
        )
        const value = (entity: (typeof entities)[number], name: string) =>
            (entity.data.find((item) => item.name === name) as { value: number } | undefined)?.value
        return {
            timeScales: entities
                .filter((entity) => entity.archetype === '#TIMESCALE_CHANGE')
                .map((entity) => [value(entity, '#BEAT'), value(entity, '#TIMESCALE')]),
            notes: [...state.store.slides.note.values()].flat().map((note) => note.beat),
        }
    })
    expect(order.timeScales).toEqual([
        [0, 2],
        [0, 0.5],
        [2, 2],
        [2, 0.5],
    ])
    expect(order.notes.sort()).toEqual([2, 4])
})

test('event joints a chart without dynamic stages drops never shift the paste', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { show, fixtures, history, store } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.events,
                cameraEvents: [{ ...fixtures.events.cameraEvents[0]!, beat: 0 }],
                stageMaskEvents: [],
                stagePivotEvents: [],
                stageStyleEvents: [],
                stageTransformEvents: [],
                timeScales: [],
                slides: [[{ ...base, beat: 2, left: -1, size: 2 }]],
            },
            1.5,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' || entity.type === 'cameraEventJoint',
            ),
        })
    })
    const note = await point(page, 0, 2)
    await page.mouse.move(note.x, note.y)
    await settle(page)
    await page.keyboard.press('c')
    await page.evaluate(() => {
        const { show, fixtures } = window.editorTest
        show({ ...fixtures.interaction, slides: [] }, 1.5)
    })
    await page.keyboard.press('v')

    // At beat 1 the camera event would land at -1, but only the note lands.
    const target = await point(page, 0, 1)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    const creating = await page.evaluate(() =>
        window.editorTest.view.entities.creating.map(({ type, beat }) => ({ type, beat })),
    )
    expect(creating).toEqual([{ type: 'note', beat: 1 }])

    await page.mouse.click(target.x, target.y)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect
        .poll(async () => brief(await pastedNotes(page)).map(({ beat }) => beat))
        .toEqual([1])
})
