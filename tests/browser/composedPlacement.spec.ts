import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const errors = new WeakMap<Page, string[]>()
const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const seed = async (
    page: Page,
    options: { empty?: boolean; size?: number; dynamic?: boolean; basic?: boolean } = {},
) => {
    await page.evaluate(({ empty, size, dynamic, basic }) => {
        const { fixtures, show, view, settings } = window.editorTest
        const note = fixtures.interaction.slides[0]![0]!
        const pivot = fixtures.events.stagePivotEvents[0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: dynamic ?? true,
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 0, eventEase: 'linear' },
                    { ...pivot, beat: 8, pivotLane: 8, eventEase: 'linear' },
                    { ...pivot, stageId: 2 as typeof pivot.stageId, beat: 0, pivotLane: -4 },
                ],
                stageTransformEvents: [
                    { ...transform, beat: 0, xTranslation: 1, eventEase: 'linear' },
                ],
                slides: empty ? [] : [[{ ...note, beat: 4, left: -2, size: size ?? 2 }]],
            },
            3,
        )
        view.layout = basic ? 'basic' : 'composed'
        view.snapping = 'absolute'
        view.division = 4
        view.laneDivision = 4
        view.laneSnapping = 'relative'
        settings.width = 32
    }, options)
    await settle(page)
}

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const startDrag = async (
    page: Page,
    from: [lane: number, beat: number],
    to: [lane: number, beat: number],
) => {
    const start = await point(page, ...from)
    const end = await point(page, ...to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await settle(page)
}

test.beforeEach(async ({ page }) => {
    const runtimeErrors: string[] = []
    errors.set(page, runtimeErrors)
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

for (const [tool, shortcut] of [
    ['note', 'a'],
    ['slide', 's'],
] as const) {
    test(`${tool}: composed creation and ghost snap in the target stage at the snapped beat`, async ({
        page,
    }) => {
        await seed(page, { empty: true })
        await page.keyboard.press(shortcut)
        // Beat 6.1 snaps to 6: offset is 7, then the local lane snaps to -2.75.
        const target = await point(page, 4.37, 6.1)
        await page.mouse.move(target.x, target.y)
        await settle(page)
        const expected = [{ type: 'note', beat: 6, left: -2.75, size: 2 }]
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual(expected)
        await page.mouse.click(target.x, target.y)
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(expected)
        await page.keyboard.press('z')
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual([])
        await page.keyboard.press('y')
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(expected)
    })

    test(`${tool}: copied and isolated stages determine creation coordinates`, async ({ page }) => {
        await seed(page)
        await page.evaluate(async (tool) => {
            const { history, appImport } = window.editorTest
            const { createTransaction } = await appImport<
                typeof import('../../src/state/transaction')
            >('/src/state/transaction.ts')
            const { editSelectedNote } = await appImport<
                typeof import('../../src/state/operations/note')
            >('/src/state/operations/note.ts')
            const transaction = createTransaction(history.state.value)
            const original = [...history.state.value.store.slides.note.values()].flat()[0]!
            const selected = editSelectedNote(transaction, original, {
                stageId: 2 as typeof original.stageId,
            })
            history.replaceState(transaction.commit(selected))
            if (tool === 'note') {
                const { defaultNoteProperties } = await appImport<
                    typeof import('../../src/editor/tools/note')
                >('/src/editor/tools/note/index.ts')
                defaultNoteProperties.value = { copyProperties: true }
            } else {
                const { defaultSlideProperties } = await appImport<
                    typeof import('../../src/editor/tools/slide')
                >('/src/editor/tools/slide/index.ts')
                defaultSlideProperties.value = { copyProperties: true }
            }
        }, tool)
        await page.keyboard.press(shortcut)
        const target = await point(page, -3, 6)
        await page.mouse.click(target.x, target.y)
        expect(
            await page.evaluate(() => {
                const note = window.editorTest.history.state.value.selectedEntities[0]!
                return note.type === 'note' && [note.stageId, note.beat, note.left]
            }),
        ).toEqual([2, 6, 1])
        await page.evaluate(() => {
            window.editorTest.view.stageId = 1 as NonNullable<typeof window.editorTest.view.stageId>
        })
        const isolated = await point(page, 6, 7)
        await page.mouse.click(isolated.x, isolated.y)
        expect(
            await page.evaluate(() => {
                const note = window.editorTest.history.state.value.selectedEntities[0]!
                return note.type === 'note' && [note.stageId, note.beat, note.left]
            }),
        ).toEqual([1, 7, -2])
    })

    test(`${tool}: moves follow the pointer across changing pivots, with matching ghost, undo, and cancel`, async ({
        page,
    }) => {
        await seed(page)
        await page.keyboard.press(shortcut)
        await startDrag(page, [4, 4], [4, 6])
        const moved = [{ type: 'note', beat: 6, left: -4, size: 2 }]
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual(moved)
        await page.mouse.up()
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(moved)
        await page.keyboard.press('z')
        const original = [{ type: 'note', beat: 4, left: -2, size: 2 }]
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(original)
        await startDrag(page, [4, 4], [6, 6])
        await page.keyboard.press('Escape')
        await page.mouse.up()
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(original)
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([])
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })

    test(`${tool}: returning a composed drag to its origin creates no undo record`, async ({
        page,
    }) => {
        await seed(page)
        await page.keyboard.press(shortcut)
        await startDrag(page, [4, 4], [6, 6])
        const start = await point(page, 4, 4)
        await page.mouse.move(start.x, start.y)
        await page.mouse.up()
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual([
            { type: 'note', beat: 4, left: -2, size: 2 },
        ])
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })

    test(`${tool}: edge resizing samples the note beat and preserves the opposite edge`, async ({
        page,
    }) => {
        for (const [start, finish, left, size] of [
            [3.1, 1, -4, 4],
            [4.9, 7, -2, 4],
            [4.9, 3.1, -2, 0.25],
        ]) {
            await seed(page)
            await page.keyboard.press(shortcut)
            await startDrag(page, [start!, 4], [finish!, 6])
            const resized = [{ type: 'note', beat: 4, left, size }]
            expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual(
                resized,
            )
            await page.mouse.up()
            expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(resized)
            await page.keyboard.press('z')
            expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        }
    })

    test(`${tool}: drag creation uses local lanes at the destination beat`, async ({ page }) => {
        await seed(page, { empty: true })
        await page.keyboard.press(shortcut)
        await startDrag(page, [3, 4], [8, 6])
        const created = [{ type: 'note', beat: 6, left: -2, size: 3 }]
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual(created)
        await page.mouse.up()
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(created)
    })

    test(`${tool}: zero-width note centers move in composed coordinates`, async ({ page }) => {
        await seed(page, { size: 0 })
        await page.keyboard.press(shortcut)
        await startDrag(page, [3, 4], [3, 6])
        await page.mouse.up()
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual([
            { type: 'note', beat: 6, left: -4, size: 0 },
        ])
    })

    test(`${tool}: exact event jumps use the incoming pivot for placement`, async ({ page }) => {
        await seed(page, { empty: true })
        await page.evaluate(() => {
            const { history, fixtures, view } = window.editorTest
            const pivot = fixtures.events.stagePivotEvents[0]!
            const chart = {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [],
                stagePivotEvents: [
                    { ...pivot, beat: 0, pivotLane: 0, eventEase: 'linear' as const },
                    { ...pivot, beat: 4, pivotLane: 2, eventEase: 'linear' as const },
                    { ...pivot, beat: 4, pivotLane: 8, eventEase: 'linear' as const },
                ],
            }
            history.resetState(false, chart, 0, 'composed-jump.json')
            view.time = 3
        })
        await page.keyboard.press(shortcut)
        const target = await point(page, 3, 4)
        await page.mouse.move(target.x, target.y)
        await settle(page)
        const expected = [{ type: 'note', beat: 4, left: 1, size: 2 }]
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual(expected)
        await page.mouse.click(target.x, target.y)
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(expected)
    })

    test(`${tool}: attached notes are targeted at their composed connector and retain attachment`, async ({
        page,
    }) => {
        await seed(page)
        await page.evaluate(() => {
            const { fixtures, show, view } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            const pivot = fixtures.events.stagePivotEvents[0]!
            show(
                {
                    ...fixtures.interaction,
                    isDynamicStages: true,
                    stagePivotEvents: [
                        { ...pivot, beat: 0, pivotLane: 0, eventEase: 'linear' },
                        { ...pivot, beat: 8, pivotLane: 8, eventEase: 'linear' },
                        { ...pivot, stageId: 2 as typeof pivot.stageId, beat: 0, pivotLane: -4 },
                    ],
                    slides: [
                        [
                            { ...base, beat: 2, left: -2 },
                            { ...base, beat: 4, left: -2, isAttached: true },
                            { ...base, beat: 6, left: -2, stageId: 2 as typeof base.stageId },
                        ],
                    ],
                },
                3,
            )
            view.layout = 'composed'
        })
        await settle(page)
        await page.keyboard.press(shortcut)
        // At beat 4, interpolate both stage centers (3 and -5), giving -1.
        const target = await point(page, -1, 4)
        await page.mouse.move(target.x, target.y)
        await settle(page)
        expect(await page.evaluate(() => window.editorTest.snapshot().hovered)).toEqual([
            { type: 'note', beat: 4, left: -2, size: 2 },
        ])
        await startDrag(page, [-1, 4], [-1, 5])
        await page.mouse.up()
        expect(
            await page.evaluate(() => {
                const note = window.editorTest.history.state.value.selectedEntities[0]!
                return note.type === 'note' && [note.beat, note.left, note.size, note.isAttached]
            }),
        ).toEqual([5, -2, 2, true])
    })

    test(`${tool}: Basic and non-dynamic charts keep existing placement coordinates`, async ({
        page,
    }) => {
        for (const options of [{ basic: true }, { dynamic: false }]) {
            await seed(page, { ...options, empty: true })
            await page.keyboard.press(shortcut)
            const target = await point(page, 4, 6)
            await page.mouse.click(target.x, target.y)
            expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual([
                { type: 'note', beat: 6, left: 4, size: 2 },
            ])
        }
    })
}
