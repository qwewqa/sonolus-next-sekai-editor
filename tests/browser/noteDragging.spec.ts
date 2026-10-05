import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const runtimeErrors = new WeakMap<Page, string[]>()
const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const seed = async (page: Page, size: number, width = 20) => {
    await page.evaluate(
        ({ size, width }) => {
            const { fixtures, show, view, settings } = window.editorTest
            const original = fixtures.interaction.slides[1]![0]!
            show({ ...fixtures.interaction, slides: [[{ ...original, left: 0, size }]] }, 3)
            view.snapping = 'absolute'
            view.division = 4
            settings.width = width
        },
        { size, width },
    )
    await settle(page)
}

const touch = (page: Page, type: string, point: { x: number; y: number }) =>
    page.evaluate(
        ({ type, point }) => {
            const target = document.querySelector('.editor')!
            const changedTouches = [
                new Touch({ identifier: 1, target, clientX: point.x, clientY: point.y }),
            ]
            target.dispatchEvent(
                new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
            )
        },
        { type, point },
    )

const drag = async (page: Page, startLane: number, endLane: number, cancel = false) => {
    const { start, end } = await page.evaluate(
        ({ startLane, endLane }) => ({
            start: window.editorTest.point(startLane, 5),
            end: window.editorTest.point(endLane, 6),
        }),
        { startLane, endLane },
    )
    await touch(page, 'touchstart', start)
    await touch(page, 'touchmove', end)
    await settle(page)
    await touch(page, cancel ? 'touchcancel' : 'touchend', end)
    await settle(page)
}

const notes = (page: Page) => page.evaluate(() => window.editorTest.snapshot().notes)
const original = (size: number) => [{ type: 'note', beat: 5, left: 0, size }]
const activate = async (page: Page, tool: string, shortcut: string) => {
    await page.keyboard.press(shortcut)
    await expect(page.locator('.bg-preview > span.flex-grow')).toHaveText(
        new RegExp(`^${tool}(?: |$)`),
    )
}

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

for (const [tool, shortcut] of [
    ['Note', 'a'],
    ['Slide', 's'],
    ['Select', 'f'],
] as const) {
    test(`${tool}: dragging a neighboring note center targets that note rather than the previous selection`, async ({
        page,
    }) => {
        for (const width of [390, 844]) {
            await page.setViewportSize({ width, height: 600 })
            await page.evaluate((width) => {
                const { fixtures, show, settings } = window.editorTest
                const note = fixtures.interaction.slides[1]![0]!
                show(
                    {
                        ...fixtures.interaction,
                        slides: [[{ ...note, left: 0, size: 1 }], [{ ...note, left: 1, size: 1 }]],
                    },
                    3,
                )
                settings.width = width === 390 ? 20 : 16
            }, width)
            await settle(page)
            await activate(page, tool, shortcut)
            const firstCenter = await page.evaluate(() => window.editorTest.point(0.5, 5))
            await touch(page, 'touchstart', firstCenter)
            await touch(page, 'touchend', firstCenter)
            await settle(page)
            expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual(
                original(1),
            )
            await drag(page, 1.5, 3.5)
            expect(await notes(page)).toEqual([
                { type: 'note', beat: 5, left: 0, size: 1 },
                { type: 'note', beat: 6, left: 3, size: 1 },
            ])
        }
    })

    test(`${tool}: mobile off-center body drags move narrow notes, preserving their size`, async ({
        page,
    }) => {
        for (const [size, startLane] of [
            [0, 0.1],
            [0.5, 0.35],
            [1, 0.35],
            [1, 0.65],
            [1.5, 0.85],
            [2, 0.75],
        ] as const) {
            await seed(page, size)
            expect(
                await page.evaluate(
                    () =>
                        [
                            ...window.editorTest.history.state.value.store.slides.note.values(),
                        ].flat()[0]?.hitbox?.w,
                ),
            ).toBe(size / 2)
            await activate(page, tool, shortcut)
            await drag(page, startLane, startLane + 2)
            expect(await notes(page)).toEqual([{ type: 'note', beat: 6, left: 2, size }])
            await page.keyboard.press('z')
            expect(await notes(page)).toEqual(original(size))
            expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
            await page.keyboard.press('y')
            expect(await notes(page)).toEqual([{ type: 'note', beat: 6, left: 2, size }])
        }
        await seed(page, 1)
        await activate(page, tool, shortcut)
        await drag(page, 0.35, 2.35, true)
        expect(await notes(page)).toEqual(original(1))
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([])
        await drag(page, 0.65, 2.65)
        expect(await notes(page)).toEqual([{ type: 'note', beat: 6, left: 2, size: 1 }])
    })

    test(`${tool}: narrow notes resize from the expanded hitbox beyond the visible body`, async ({
        page,
    }) => {
        // Keep an 844px editor beside the workspace's panel rails, whose width
        // depends on the pointer: the pixel margins below are calibrated for it.
        await page.setViewportSize({ width: 880, height: 600 })
        const docks = () =>
            page.evaluate(() =>
                [
                    ...document.querySelectorAll(
                        '[data-workspace-dock="left"], [data-workspace-dock="right"]',
                    ),
                ].reduce((sum, dock) => sum + dock.getBoundingClientRect().width, 0),
            )
        await expect
            .poll(
                async () => (await page.evaluate(() => window.editorTest.view.w)) + (await docks()),
            )
            .toBe(880)
        const rails = 880 - (await page.evaluate(() => window.editorTest.view.w))
        await page.setViewportSize({ width: 844 + rails, height: 600 })
        await expect.poll(() => page.evaluate(() => window.editorTest.view.w)).toBe(844)
        for (const size of [0, 0.5, 1, 1.5]) {
            for (const side of ['left', 'right'] as const) {
                await seed(page, size, 16)
                await activate(page, tool, shortcut)
                const startLane = size / 2 + (side === 'left' ? -0.7 : 0.7)
                if (size < 1.5) {
                    const outsidePixels = await page.evaluate(
                        ({ size, startLane, side }) => {
                            const { point } = window.editorTest
                            return Math.abs(
                                point(startLane, 5).x - point(side === 'left' ? 0 : size, 5).x,
                            )
                        },
                        { size, startLane, side },
                    )
                    expect(outsidePixels).toBeGreaterThan(10)
                    const outside = await page.evaluate(
                        (lane) => window.editorTest.point(lane, 5),
                        startLane,
                    )
                    await page.mouse.move(outside.x, outside.y)
                    await settle(page)
                    expect(await page.evaluate(() => window.editorTest.snapshot().hovered)).toEqual(
                        [],
                    )
                    const center = await page.evaluate(
                        (lane) => window.editorTest.point(lane, 5),
                        size === 0 ? 0.2 : size / 2,
                    )
                    await page.mouse.move(center.x, center.y)
                    await settle(page)
                    expect(await page.evaluate(() => window.editorTest.snapshot().hovered)).toEqual(
                        original(size),
                    )
                }
                await drag(page, startLane, side === 'left' ? -2 : 3)
                const resized = await notes(page)
                expect(resized).toHaveLength(1)
                expect(resized[0]!.beat).toBe(5)
                expect(resized[0]!.size).toBeGreaterThan(size)
                if (side === 'left') expect(resized[0]!.left! + resized[0]!.size!).toBe(size)
                else expect(resized[0]!.left).toBe(0)
                await page.keyboard.press('z')
                expect(await notes(page)).toEqual(original(size))
                expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(
                    false,
                )
            }
        }
    })

    test(`${tool}: mobile edge drags resize each end while preserving beat and the opposite edge`, async ({
        page,
    }) => {
        for (const [size, startLane, endLane, expectedLeft, expectedSize] of [
            [1, 0.1, -2, -2, 3],
            [1, 0.9, 3, 0, 3],
            [2, 0.25, -2, -2, 4],
            [2, 1.75, 4, 0, 4],
        ] as const) {
            await seed(page, size)
            await activate(page, tool, shortcut)
            await drag(page, startLane, endLane)
            expect(await notes(page)).toEqual([
                { type: 'note', beat: 5, left: expectedLeft, size: expectedSize },
            ])
            await page.keyboard.press('z')
            expect(await notes(page)).toEqual(original(size))
            expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        }
        await seed(page, 1)
        await activate(page, tool, shortcut)
        await drag(page, 0.1, -2, true)
        expect(await notes(page)).toEqual(original(1))
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        expect(await page.evaluate(() => window.editorTest.snapshot().creating)).toEqual([])
    })
}
