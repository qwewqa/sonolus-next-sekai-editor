import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('meter property previews, commits, undoes and survives zero-based serialization', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { show, fixtures, history, settings } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 4, bpm: 90, meter: 3 },
                ],
            },
            3,
        )
        settings.showSidebar = true
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.grid.bpm.values()]
                .flatMap((set) => [...set])
                .filter((entity) => entity.beat === 4),
        })
    })
    await expect(page.getByLabel('Beat', { exact: true })).toHaveValue('5')
    const meter = page.getByLabel('Meter', { exact: true })
    await expect(meter).toHaveValue('3')
    await meter.fill('5')
    expect(
        await page.evaluate(async () => {
            const { getPreviewState } = await import('/src/preview/edit.ts')
            const source = window.editorTest.history.state.value
            return [source.bpms[1]!.meter, getPreviewState(source).bpms[1]!.meter]
        }),
    ).toEqual([3, 5])
    await meter.press('Tab')
    expect(await page.evaluate(() => window.editorTest.history.state.value.bpms[1]!.meter)).toBe(5)
    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(meter).toHaveValue('3')
    await meter.fill('0')
    await meter.press('Tab')
    await expect(meter).toHaveValue('3')
    const exported = await page.evaluate(async () => {
        const { serializeToLevelDataEntities } =
            await import('/src/levelData/entities/serialize/index.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const source = window.editorTest.history.state.value
        const entities = serializeToLevelDataEntities(
            source.initialLife,
            source.isDynamicStages,
            source.store,
            source.groups,
            source.stages,
        )
        const bpms = parseLevelDataChart(entities).bpms
        const legacy = parseLevelDataChart(
            entities.map((entity) => ({
                ...entity,
                data: entity.data.filter((data) => data.name !== 'meter'),
            })),
        ).bpms
        return { bpms, legacy }
    })
    expect(exported.bpms).toEqual([
        { beat: 0, bpm: 120, meter: 4 },
        { beat: 4, bpm: 90, meter: 3 },
    ])
    expect(exported.legacy.map((bpm) => bpm.meter)).toEqual([4, 4])
})

test('one-based note fields keep copied, pasted and exported beats zero-based', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { show, fixtures, settings, history } = window.editorTest
        const chart = fixtures.interaction
        show({ ...chart, slides: [[{ ...chart.slides[0]![0]!, beat: 0 }]] }, 3)
        settings.showSidebar = true
        const source = history.state.value
        history.replaceState({
            ...source,
            selectedEntities: [...source.store.slides.note.values()].flat(),
        })
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
    })
    const beat = page.getByLabel('Beat', { exact: true })
    await expect(beat).toHaveValue('1')
    await beat.fill('1.25')
    await beat.press('Tab')
    expect((await page.evaluate(() => window.editorTest.snapshot())).notes[0]!.beat).toBe(0.25)
    const copied = await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        const { clipboardEntry } = await import('/src/clipboard/index.ts')
        void commands.copy.execute()
        const entry = clipboardEntry.value!
        return { wire: JSON.parse(entry.text), beat: entry.data!.chart.slides[0]![0]!.beat }
    })
    expect(copied.wire.beat).toBe(0.25)
    expect(copied.beat).toBe(0.25)
    expect(
        copied.wire.entities.flatMap((entity: { data: { name: string; value?: number }[] }) =>
            entity.data.filter((data) => data.name === '#BEAT').map((data) => data.value),
        ),
    ).toContain(0.25)
    const pasted = await page.evaluate(async () => {
        const { pasteAtPosition } = await import('/src/editor/tools/paste/index.ts')
        await pasteAtPosition(1, 2, { ctrl: false, shift: false })
        return window.editorTest.snapshot().selected.map((entity) => entity.beat)
    })
    expect(pasted).toEqual([2.25])
    await expect(beat).toHaveValue('3.25')
    const saved = await page.evaluate(async () => {
        const { serializeToLevelDataEntities } =
            await import('/src/levelData/entities/serialize/index.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const source = window.editorTest.history.state.value
        return parseLevelDataChart(
            serializeToLevelDataEntities(
                source.initialLife,
                source.isDynamicStages,
                source.store,
                source.groups,
                source.stages,
            ),
        )
            .slides.flat()
            .map((note) => note.beat)
    })
    expect(saved.sort((a, b) => a - b)).toEqual([0.25, 2.25])
})

test('right ruler defaults to measures, hides the first beat and offers all three settings', async ({
    page,
}) => {
    expect(await page.evaluate(() => window.editorTest.settings.beatDisplay)).toBe('measure')
    await page.evaluate(async () => {
        const { commands } = await import('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    const display = page.getByRole('combobox', { name: 'Beat Display', exact: true })
    await expect(display).toHaveValue('measure')
    await display.selectOption('both')
    expect(
        await page.evaluate(() => localStorage.getItem('sonolus-next-sekai-editor.beatDisplay')),
    ).toBe('"both"')
    const labels = await page.evaluate(async () => {
        const { drawGrid } = await import('/src/editor/canvas/grid.ts')
        const { show, fixtures, history } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 2, bpm: 90 },
                ],
            },
            3,
        )
        const ctx = document.createElement('canvas').getContext('2d')!
        const text: string[] = []
        ctx.fillText = (label) => {
            if (!label.includes(':')) text.push(label)
        }
        const context = {
            ctx,
            scale: 20,
            pixelRatio: 1,
            bounds: { l: -8, r: 8, t: 10, b: 0, w: 16, h: 10 },
            ups: 1,
            state: history.state.value,
            defaultGroupId: undefined,
            showStageName: false,
            showGroupName: false,
            nameContrast: false,
            recentlyActive: false,
            fontFamily: 'sans-serif',
            fontMiddle: 0.25,
            figureMiddle: 0.35,
        }
        const results: Record<string, string[]> = {}
        for (const mode of ['beat', 'measure', 'both'] as const) {
            text.length = 0
            drawGrid(context, { min: 0, max: 4 }, { min: 0, max: 2 }, 4, 1, mode)
            results[mode] = [...text]
        }
        text.length = 0
        drawGrid(context, { min: 0, max: 4 }, { min: 0, max: 2 }, 4, 1, 'measure', true)
        results.underBpm = [...text]
        return results
    })
    expect(labels).toEqual({
        beat: ['2', '3', '4', '5'],
        measure: ['1.2', '2.1', '2.2', '2.3'],
        both: ['1.2 (2)', '2.1 (3)', '2.2 (4)', '2.3 (5)'],
        // The BPM label at beat 2 replaces its beat label.
        underBpm: ['1.2', '2.2', '2.3'],
    })
})

test('elevation beat input converts positions once and rejects values below displayed beat one', async ({
    page,
}) => {
    await page.keyboard.press('t')
    const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('1')
    await beat.press('Tab')
    expect(
        await page.evaluate(
            async () => (await import('/src/editor/elevation/state.ts')).elevationBeat.value,
        ),
    ).toBe(0)
    await expect(page.getByRole('button', { name: 'Previous Beat', exact: true })).toBeDisabled()
    await beat.fill('0')
    await beat.press('Tab')
    await expect(beat).toHaveValue('1')
    await beat.fill('1.25')
    await beat.press('Tab')
    expect(
        await page.evaluate(
            async () => (await import('/src/editor/elevation/state.ts')).elevationBeat.value,
        ),
    ).toBe(0.25)
    await beat.fill('1.125')
    await beat.press('Tab')
    expect(
        await page.evaluate(
            async () => (await import('/src/editor/elevation/state.ts')).elevationBeat.value,
        ),
    ).toBe(0.125)
})

test('measure modes emphasize off-grid boundaries and keep phone labels visible', async ({
    page,
}, testInfo) => {
    const strokes = await page.evaluate(async () => {
        const { drawGrid } = await import('/src/editor/canvas/grid.ts')
        const { show, fixtures, history } = window.editorTest
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 2.125, bpm: 120, meter: 3 },
                ],
            },
            3,
        )
        const ctx = document.createElement('canvas').getContext('2d')!
        let positions: number[] = []
        const results: { mode: string; width: number; alpha: number; positions: number[] }[] = []
        ctx.beginPath = () => {
            positions = []
        }
        ctx.moveTo = (_x, y) => {
            positions.push(y)
        }
        let mode = ''
        ctx.stroke = () => {
            results.push({ mode, width: ctx.lineWidth, alpha: ctx.globalAlpha, positions })
        }
        const context = {
            ctx,
            scale: 20,
            pixelRatio: 1,
            bounds: { l: -8, r: 8, t: 10, b: 0, w: 16, h: 10 },
            ups: 1,
            state: history.state.value,
            defaultGroupId: undefined,
            showStageName: false,
            showGroupName: false,
            nameContrast: false,
            recentlyActive: false,
            fontFamily: 'sans-serif',
            fontMiddle: 0.25,
            figureMiddle: 0.35,
        }
        for (const display of ['beat', 'measure', 'both'] as const) {
            mode = display
            drawGrid(context, { min: 0, max: 8 }, { min: 0, max: 4 }, 4, 1, display)
        }
        return results
    })
    expect(
        strokes
            .filter((stroke) => stroke.mode === 'beat')
            .every((stroke) => Math.abs(stroke.width - 0.1) < 1e-6),
    ).toBe(true)
    for (const mode of ['measure', 'both']) {
        const major = strokes.find(
            (stroke) => stroke.mode === mode && Math.abs(stroke.width - 0.15) < 1e-6,
        )!
        expect(major.alpha).toBeCloseTo(0.7)
        expect(major.positions).toEqual([0, 1.0625, 2.5625])
        expect(
            strokes.some(
                (stroke) =>
                    stroke.mode === mode &&
                    Math.abs(stroke.width - 0.1) < 1e-6 &&
                    Math.abs(stroke.alpha - 0.35) < 1e-6,
            ),
        ).toBe(true)
    }
    for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 812 })
        await page.evaluate(() => {
            window.editorTest.settings.beatDisplay = 'both'
        })
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`measure-grid-${width}.png`) })
    }
})

test('a faint BPM label under Show Other Objects still replaces its beat label', async ({
    page,
}) => {
    const texts = await page.evaluate(async () => {
        const { show, fixtures, settings, view } = window.editorTest
        settings.beatDisplay = 'measure'
        settings.showOtherObjects = true
        view.visibilities = { ...view.visibilities, bpm: false }
        const drawn: string[] = []
        const fillText = CanvasRenderingContext2D.prototype.fillText
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            if (
                this.canvas instanceof HTMLCanvasElement &&
                this.canvas.classList.contains('editor-chart')
            )
                drawn.push(text)
            return fillText.call(this, text, ...args)
        }
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 2, bpm: 90 },
                ],
            },
            1,
        )
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        CanvasRenderingContext2D.prototype.fillText = fillText
        return drawn
    })
    // The BPM change at beat 2 is drawn, faint, where measure 2.1 would be.
    expect(texts.some((text) => text.includes('90'))).toBe(true)
    expect(texts).toContain('1.2')
    expect(texts).not.toContain('2.1')
})

test('the grid knows where the time and beat labels over the chart lie', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
    // The grid leaves out its labels under these boxes; they follow the text's width.
    const boxes = () =>
        page.evaluate(async () => {
            const { edgeLabelBoxes } = await window.editorTest.appImport<
                typeof import('../../src/editor/edgeLabels')
            >('/src/editor/edgeLabels.ts')
            const pane = document.querySelector('canvas.editor-chart')!.getBoundingClientRect()
            const spans = [
                ...document.querySelectorAll<HTMLElement>(
                    '.chart-pane > div:first-of-type > div > span',
                ),
            ].map((span) => {
                const { left, right, top, bottom } = span.getBoundingClientRect()
                return [left - pane.left, right - pane.left, top - pane.top, bottom - pane.top]
            })
            const { left, right } = edgeLabelBoxes.value
            const stored = [left[0], right[0], left[1], right[1]].map((box) =>
                box ? [box.left, box.right, box.top, box.bottom] : [],
            )
            return { spans, stored }
        })
    const expectMatching = async () =>
        await expect
            .poll(async () => {
                const { spans, stored } = await boxes()
                return stored.every((box, index) =>
                    box.every((edge, side) => Math.abs(edge - spans[index]![side]!) < 0.5),
                )
            })
            .toBe(true)
    await expectMatching()
    await page.evaluate(() => (window.editorTest.settings.beatDisplay = 'both'))
    await expectMatching()
})

test('the grid knows where the hover time and beat labels lie', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 3))
    const matches = () =>
        page.evaluate(async () => {
            const { edgeLabelBoxes } = await window.editorTest.appImport<
                typeof import('../../src/editor/edgeLabels')
            >('/src/editor/edgeLabels.ts')
            const pane = document.querySelector('canvas.editor-chart')!.getBoundingClientRect()
            const spans = [
                ...document.querySelectorAll<HTMLElement>(
                    '.chart-pane > div:nth-of-type(2) > span',
                ),
            ]
            const { left, right } = edgeLabelBoxes.value
            return [left.at(-1), right.at(-1)].every((box, index) => {
                const rect = spans[index]!.getBoundingClientRect()
                return (
                    !!box &&
                    [
                        [box.left, rect.left - pane.left],
                        [box.right, rect.right - pane.left],
                        [box.top, rect.top - pane.top],
                        [box.bottom, rect.bottom - pane.top],
                    ].every(([a, b]) => Math.abs(a! - b!) < 0.5)
                )
            })
        })
    // At a whole second, as the pointer moves.
    for (const beat of [4, 5.5]) {
        const { x, y } = await page.evaluate((beat) => window.editorTest.point(0, beat), beat)
        await page.mouse.move(x, y)
        await expect.poll(matches).toBe(true)
    }
})

test('an edge label under the hover time and beat labels is hidden', async ({ page }) => {
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 5))
    const pane = (await page.locator('canvas.editor-chart').boundingBox())!
    const state = () =>
        page.evaluate(async () => {
            const { edgeLabelBoxes } = await window.editorTest.appImport<
                typeof import('../../src/editor/edgeLabels')
            >('/src/editor/edgeLabels.ts')
            const rows = document.querySelectorAll<HTMLElement>(
                '.chart-pane > div:first-of-type > div',
            )
            const visible = (row: Element) =>
                [...row.children].map((span) => getComputedStyle(span).visibility === 'visible')
            const { left, right } = edgeLabelBoxes.value
            return {
                top: visible(rows[0]!),
                bottom: visible(rows[1]!),
                boxes: [left.length, right.length],
            }
        })
    for (const [y, top, bottom] of [
        [15, false, true],
        [pane.height / 2, true, true],
        [pane.height - 15, true, false],
    ] as const) {
        await page.mouse.move(pane.x + pane.width / 2, pane.y + y)
        // A hidden label no longer hides the grid labels under it.
        await expect.poll(state).toEqual({
            top: [top, top],
            bottom: [bottom, bottom],
            boxes: top && bottom ? [3, 3] : [2, 2],
        })
    }
})
