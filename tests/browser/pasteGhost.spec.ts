import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// The paste ghost draws slides as they'll land: connectors, ticks and attached ticks.

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

/** Head at 2, a tick at 3, an attached tick at 4 and a flick tail at 6, copied from the note at the anchor. */
const copySlide = async (page: Page, anchor: { lane: number; beat: number }) => {
    await page.evaluate(() => {
        const { show, fixtures, history } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: [
                    [
                        { ...base, beat: 2, left: -4, size: 2 },
                        { ...base, beat: 3, left: -2, size: 2 },
                        { ...base, beat: 4, isAttached: true },
                        { ...base, beat: 6, left: 2, size: 2, flickDirection: 'up' },
                    ],
                ],
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    const hover = await point(page, anchor.lane, anchor.beat)
    await page.mouse.move(hover.x, hover.y)
    await settle(page)
    await page.keyboard.press('c')
    await page.keyboard.press('v')
}

/** The ghost's notes with the role each draws as, and its connectors. */
const ghost = (page: Page) =>
    page.evaluate(async () => {
        const { appImport, view, history } = window.editorTest
        const { getNoteVisualType } = await appImport<
            typeof import('../../src/editor/canvas/notes')
        >('/src/editor/canvas/notes.ts')
        const { pasteGhostInfos } = await appImport<typeof import('../../src/editor/tools/paste')>(
            '/src/editor/tools/paste/index.ts',
        )
        const creating = view.entities.creating
        return {
            notes: creating
                .flatMap((entity) => (entity.type === 'note' ? [entity] : []))
                .sort((a, b) => a.beat - b.beat)
                .map((note) => ({
                    beat: note.beat,
                    left: note.left,
                    type: getNoteVisualType(
                        note,
                        history.state.value.store.slides.info.get(note.slideId) ??
                            pasteGhostInfos()?.get(note.slideId),
                    ),
                })),
            connectors: creating
                .flatMap((entity) => (entity.type === 'connector' ? [entity] : []))
                .map(({ head, tail }) => [head.beat, tail.beat]),
        }
    })

const landed = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities
            .flatMap((entity) => (entity.type === 'note' ? [entity] : []))
            .sort((a, b) => a.beat - b.beat)
            .map(({ beat, left }) => ({ beat, left })),
    )

const expected = (offset: number) => ({
    notes: [
        { beat: 2 + offset, left: -4, type: 'head' },
        { beat: 3 + offset, left: -2, type: 'tick' },
        // A third of the way from the tick to the tail.
        { beat: 4 + offset, left: -2 + 4 / 3, type: 'tick' },
        { beat: 6 + offset, left: 2, type: 'tail' },
    ],
    connectors: [
        [2 + offset, 3 + offset],
        [3 + offset, 6 + offset],
    ],
})

test('the hover ghost draws connectors and ticks where the paste lands them', async ({ page }) => {
    await copySlide(page, { lane: -3, beat: 2 })
    const target = await point(page, -3, 4)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    const shown = await ghost(page)
    const { notes, connectors } = expected(2)
    expect(shown.connectors).toEqual(connectors)
    expect(shown.notes.map(({ beat, type }) => ({ beat, type }))).toEqual(
        notes.map(({ beat, type }) => ({ beat, type })),
    )
    for (const [i, note] of notes.entries()) expect(shown.notes[i]!.left).toBeCloseTo(note.left, 6)
    await page.mouse.click(target.x, target.y)
    expect(await landed(page)).toEqual(shown.notes.map(({ beat, left }) => ({ beat, left })))
})

test('a dragged ghost follows the drag and the beat 0 shift', async ({ page }) => {
    // From the tail, so at beat 1 the head would land at -3.
    await copySlide(page, { lane: 3, beat: 6 })
    const start = await point(page, 3, 7)
    const end = await point(page, 3, 1)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, (start.y + end.y) / 2)
    await page.mouse.move(end.x, end.y)
    await settle(page)
    const shown = await ghost(page)
    const { notes, connectors } = expected(-2)
    expect(shown.connectors).toEqual(connectors)
    expect(shown.notes.map(({ type }) => type)).toEqual(notes.map(({ type }) => type))
    await page.mouse.up()
    expect(await landed(page)).toEqual(shown.notes.map(({ beat, left }) => ({ beat, left })))
})

/** The slide copied with the BPM change at 3.5 among the given BPMs, hovering a paste at beat 5. */
const hoverPasteWithBpm = async (page: Page, bpms: { beat: number; bpm: number }[]) => {
    await page.evaluate((bpms) => {
        const { show, fixtures, history, store } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                bpms,
                slides: [
                    [
                        { ...base, beat: 2, left: -4, size: 2 },
                        { ...base, beat: 3, left: -2, size: 2 },
                        { ...base, beat: 4, isAttached: true },
                        { ...base, beat: 6, left: 2, size: 2, flickDirection: 'up' },
                    ],
                ],
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' || (entity.type === 'bpm' && entity.beat === 3.5),
            ),
        })
    }, bpms)
    const hover = await point(page, -3, 2)
    await page.mouse.move(hover.x, hover.y)
    await settle(page)
    await page.keyboard.press('c')
    await page.keyboard.press('v')
    const target = await point(page, -3, 5)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    return target
}

// The attached tick lands by the pasted tempo, not the chart's.
const expectLandedAsShown = async (page: Page, target: { x: number; y: number }) => {
    const shown = await ghost(page)
    await page.mouse.click(target.x, target.y)
    const pasted = await landed(page)
    expect(pasted.map(({ beat }) => beat)).toEqual(shown.notes.map(({ beat }) => beat))
    for (const [i, note] of pasted.entries()) expect(shown.notes[i]!.left).toBeCloseTo(note.left, 6)
}

const bpms = [
    { beat: 0, bpm: 120 },
    { beat: 3.5, bpm: 30 },
    { beat: 5, bpm: 120 },
]

test('a pasted BPM change times the ghost as the paste does', async ({ page }) => {
    await expectLandedAsShown(page, await hoverPasteWithBpm(page, bpms))
})

test('a BPM pasted onto a same-beat pair times the ghost as the paste does', async ({ page }) => {
    // It lands at 5.5, replacing the first of the pair and following the second.
    const target = await hoverPasteWithBpm(page, [
        ...bpms,
        { beat: 5.5, bpm: 90 },
        { beat: 5.5, bpm: 200 },
    ])
    await expectLandedAsShown(page, target)
})

test('the ghost is dropped once a paste lands or the tool changes', async ({ page }) => {
    const hasGhost = () =>
        page.evaluate(async () => {
            const { pasteGhostInfos } = await window.editorTest.appImport<
                typeof import('../../src/editor/tools/paste')
            >('/src/editor/tools/paste/index.ts')
            return pasteGhostInfos() !== undefined
        })
    await copySlide(page, { lane: -3, beat: 2 })
    const target = await point(page, -3, 4)
    await page.mouse.move(target.x, target.y)
    await settle(page)
    expect(await hasGhost()).toBe(true)
    await page.mouse.click(target.x, target.y)
    await expect.poll(hasGhost).toBe(false)

    const next = await point(page, -3, 8)
    await page.mouse.move(next.x, next.y)
    await settle(page)
    expect(await hasGhost()).toBe(true)
    await page.evaluate(async () => {
        const { switchToolTo } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools')
        >('/src/editor/tools/index.ts')
        switchToolTo('select')
    })
    expect(await hasGhost()).toBe(false)
})
