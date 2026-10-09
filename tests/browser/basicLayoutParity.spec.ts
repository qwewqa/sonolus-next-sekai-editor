import { expect, test, type Browser, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const baselineUrl = process.env.EDITOR_BASELINE_URL

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const click = async (page: Page, lane: number, beat: number) => {
    const target = await point(page, lane, beat)
    await page.mouse.click(target.x, target.y)
}

const drag = async (page: Page, from: [number, number], to: [number, number]) => {
    const start = await point(page, ...from)
    const end = await point(page, ...to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 4 })
    await settle(page)
}

const checkpoint = async (page: Page) => {
    // Labels and tick outlines depend on a 500 ms activity window. Compare the
    // same visual phase even when other browser workers delay these commands.
    await page.evaluate(() => {
        window.editorTest.view.lastActive = Number.NEGATIVE_INFINITY
    })
    await settle(page)
    return page.evaluate(async () => {
        const { store, history, view, appImport } = window.editorTest
        const { isViewRecentlyActive } =
            await appImport<typeof import('../../src/editor/view')>('/src/editor/view.ts')
        const serialize = (value: unknown) =>
            JSON.stringify(value, (key, item: unknown) =>
                ['slideId', 'useInfoOf'].includes(key)
                    ? undefined
                    : item instanceof Map || item instanceof Set
                      ? [...item]
                      : item,
            )
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-chart')!
        const overlay = document.querySelector<HTMLCanvasElement>('canvas.editor-overlay')!
        const capture = async () => {
            // Read both surfaces and their inputs together. Hashing can yield to
            // another animation frame, so no live state is read after this point.
            const inputs = {
                entities: serialize([...store.getAllEntities()]),
                selected: serialize(history.state.value.selectedEntities),
                creating: serialize(view.entities.creating),
                hovered: serialize(view.entities.hovered),
                selection: serialize(view.selection),
                hoverTime: view.hoverTime,
                isHoverHidden: view.isHoverHidden,
                time: view.time,
                lane: view.lane,
                recentlyActive: isViewRecentlyActive.value,
                canUndo: history.canUndo.value,
            }
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
            const overlayPixels = overlay
                .getContext('2d')!
                .getImageData(0, 0, overlay.width, overlay.height)
            const images = { chart: canvas.toDataURL(), overlay: overlay.toDataURL() }
            const dimensions = { width: canvas.width, height: canvas.height }
            const [digest, overlayDigest] = await Promise.all([
                crypto.subtle.digest('SHA-256', pixels.data),
                crypto.subtle.digest('SHA-256', overlayPixels.data),
            ])
            const hex = (buffer: ArrayBuffer) =>
                [...new Uint8Array(buffer)]
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('')
            return {
                ...inputs,
                images,
                canvas: {
                    ...dimensions,
                    sha256: hex(digest),
                    overlaySha256: hex(overlayDigest),
                },
            }
        }
        let previous = await capture()
        // A delayed overlay invalidation can outlive two RAF callbacks under
        // browser load. Require stable state and pixels across rendered frames;
        // never compare against the other layout while choosing a snapshot.
        for (let frame = 0; frame < 10; frame++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            await window.editorTest.nextTick()
            const current = await capture()
            if (JSON.stringify(current) === JSON.stringify(previous)) return current
            previous = current
        }
        throw new Error('Editor state and canvas pixels did not stabilize within 10 frames')
    })
}

const exercise = async (
    browser: Browser,
    url: string,
    dynamic: boolean,
    layout: 'basic' | 'composed',
) => {
    const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
        await page.addInitScript(installCanvasCounters)
        // Frequent readbacks can make Chromium switch rasterizers mid-scenario.
        // Fix the backend for exact pixel parity; the ordinary browser suite
        // continues to exercise the application's default accelerated canvases.
        await page.addInitScript(() => {
            const getContext = HTMLCanvasElement.prototype.getContext
            Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
                value(
                    this: HTMLCanvasElement,
                    type: string,
                    options?: CanvasRenderingContext2DSettings,
                ) {
                    return getContext.call(
                        this,
                        type,
                        type === '2d' ? { ...options, willReadFrequently: true } : options,
                    )
                },
            })
        })
        // Keep the app's clipboard serialization and parsing, while other test
        // workers cannot replace this scenario's text in the machine clipboard.
        await page.addInitScript(() => {
            let text = ''
            Object.defineProperty(navigator, 'clipboard', {
                value: {
                    readText: () => Promise.resolve(text),
                    writeText: (value: string) => {
                        text = value
                        return Promise.resolve()
                    },
                },
            })
        })
        await page.goto(url)
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.evaluate(
            ({ dynamic, layout }) => {
                const { show, fixtures, view, settings } = window.editorTest
                const note = fixtures.interaction.slides[0]![0]!
                const pivot = fixtures.events.stagePivotEvents[0]!
                const mask = fixtures.events.stageMaskEvents[0]!
                const transform = fixtures.events.stageTransformEvents[0]!
                show(
                    {
                        ...fixtures.interaction,
                        isDynamicStages: dynamic,
                        stagePivotEvents: [
                            { ...pivot, beat: 0, pivotLane: 3 },
                            { ...pivot, beat: 12, pivotLane: -3 },
                        ],
                        stageMaskEvents: [{ ...mask, beat: 0 }],
                        stageTransformEvents: [{ ...transform, beat: 0, xTranslation: 2 }],
                        slides: [
                            [{ ...note, beat: 4, left: -2, size: 2 }],
                            [{ ...note, beat: 6, left: 2, size: 1 }],
                            [
                                { ...note, beat: 1, left: -6, size: 2 },
                                { ...note, beat: 3, left: -4, size: 2, isAttached: true },
                                { ...note, beat: 5, left: -2, size: 2 },
                            ],
                        ],
                    },
                    2.5,
                )
                // The HEAD editor safely ignores this extra property.
                view.layout = layout
                view.noteSize = 2
                view.division = 4
                view.laneDivision = 4
                view.laneSnapping = 'relative'
                view.snapping = 'absolute'
                settings.toolbar = [['note', 'slide', 'select', 'copy', 'paste', 'undo', 'redo']]
            },
            { dynamic, layout },
        )
        const snapshots: Record<string, Awaited<ReturnType<typeof checkpoint>>> = {}
        const save = async (name: string) => {
            snapshots[name] = await checkpoint(page)
            expect(snapshots[name]!.recentlyActive, `${name}: settled inactive rendering`).toBe(
                false,
            )
        }
        await page.keyboard.press('f')
        await save('initial')

        await page.keyboard.press('a')
        await click(page, 4.37, 8)
        await save('note placement')
        await drag(page, [5.25, 8], [3.25, 7])
        await save('note move ghost')
        await page.mouse.up()
        await save('note move')
        await drag(page, [4.15, 7], [5.5, 7.5])
        await save('note resize ghost')
        await page.mouse.up()
        await save('note resize')

        await page.keyboard.press('s')
        await click(page, -6, 8)
        await save('slide placement')

        await page.keyboard.press('f')
        await drag(page, [-7, 0.5], [7, 8.5])
        await page.mouse.up()
        await save('box selection')
        await drag(page, [-5, 8], [-4, 8.5])
        await save('selection move ghost')
        await page.mouse.up()
        await save('selection move')

        await page.keyboard.press('c')
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const { appImport } = window.editorTest
                    const { clipboardEntry } =
                        await appImport<typeof import('../../src/clipboard')>(
                            '/src/clipboard/index.ts',
                        )
                    return !!clipboardEntry.value?.data
                }),
            )
            .toBe(true)
        await page.keyboard.press('v')
        const paste = await point(page, 0, 5)
        await page.mouse.move(paste.x, paste.y)
        await save('paste ghost')
        await page.mouse.click(paste.x, paste.y)
        await save('paste')
        await page.keyboard.press('u')
        await save('flip')
        await page.keyboard.press('z')
        await save('undo')
        await page.keyboard.press('y')
        await save('redo')
        await page.keyboard.press('Delete')
        await save('delete')
        await page.keyboard.press('z')
        await save('undo delete')
        const noteCount = (name: string) =>
            (JSON.parse(snapshots[name]!.entities) as { type: string }[]).filter(
                (entity) => entity.type === 'note',
            ).length
        expect(noteCount('initial')).toBe(5)
        expect(noteCount('note placement')).toBe(6)
        expect(noteCount('slide placement')).toBe(7)
        expect(JSON.parse(snapshots['box selection']!.selected).length).toBeGreaterThan(3)
        for (const name of [
            'note move ghost',
            'note resize ghost',
            'selection move ghost',
            'paste ghost',
        ])
            expect(JSON.parse(snapshots[name]!.creating).length, name).toBeGreaterThan(0)
        expect(noteCount('paste')).toBeGreaterThan(noteCount('selection move'))
        expect(noteCount('delete')).toBeLessThan(noteCount('paste'))
        expect(noteCount('undo delete')).toBe(noteCount('paste'))
        expect(errors).toEqual([])
        return snapshots
    } finally {
        await context.close()
    }
}

const compare = async (
    actual: Awaited<ReturnType<typeof exercise>>,
    expected: Awaited<ReturnType<typeof exercise>>,
) => {
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
    for (const name of Object.keys(actual)) {
        const { canvas: actualCanvas, images: actualImages, ...actualState } = actual[name]!
        const { canvas: expectedCanvas, images: expectedImages, ...expectedState } = expected[name]!
        if (JSON.stringify(actualCanvas) !== JSON.stringify(expectedCanvas)) {
            for (const [label, images] of [
                ['actual', actualImages],
                ['expected', expectedImages],
            ] as const) {
                for (const [surface, data] of Object.entries(images)) {
                    await test.info().attach(`${name}-${label}-${surface}`, {
                        body: Buffer.from(data.split(',')[1]!, 'base64'),
                        contentType: 'image/png',
                    })
                }
            }
        }
        expect(actualState, `${name}: serialized authoring state`).toEqual(expectedState)
        expect(actualCanvas, `${name}: exact chart pixels`).toEqual(expectedCanvas)
    }
}

test('non-dynamic chart editing and pixels are identical in Basic and Composed', async ({
    browser,
    baseURL,
}) => {
    test.setTimeout(90_000)
    await compare(
        await exercise(browser, baseURL!, false, 'composed'),
        await exercise(browser, baseURL!, false, 'basic'),
    )
})

for (const dynamic of [false, true]) {
    test(`Basic ${dynamic ? 'dynamic' : 'ordinary'} chart editing and pixels match the pre-feature editor`, async ({
        browser,
        baseURL,
    }) => {
        test.skip(
            !baselineUrl,
            'Set EDITOR_BASELINE_URL to a server running the baseline revision.',
        )
        test.setTimeout(90_000)
        await compare(
            await exercise(browser, baseURL!, dynamic, 'basic'),
            await exercise(browser, baselineUrl!, dynamic, 'basic'),
        )
    })
}
