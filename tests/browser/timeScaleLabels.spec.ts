import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type Ink = { left: number; right: number; top: number; bottom: number; alpha: number }

for (const pixelRatio of [1, 1.25, 2]) {
    test(`time-scale ease glyphs match the shared curve at pixel ratio ${pixelRatio}`, async ({
        page,
    }) => {
        await page.goto('/')
        await page.evaluate(() => document.fonts.ready)
        const results = await page.evaluate(async (pixelRatio) => {
            const paths = {
                events: '/src/editor/canvas/events.ts',
                text: '/src/editor/canvas/text.ts',
                glyph: '/src/easeGlyph.ts',
                state: '/src/state/index.ts',
                bpms: '/src/state/integrals/bpms.ts',
            }
            const { drawEvent } = (await import(
                paths.events
            )) as typeof import('../../src/editor/canvas/events')
            const { measureFigureMiddle, measureTextMiddle } = (await import(
                paths.text
            )) as typeof import('../../src/editor/canvas/text')
            const { easeGlyphPathD } = (await import(
                paths.glyph
            )) as typeof import('../../src/easeGlyph')
            const { createState } = (await import(paths.state)) as typeof import('../../src/state')
            const { beatToTime } = (await import(
                paths.bpms
            )) as typeof import('../../src/state/integrals/bpms')

            const group = 1 as import('../../src/chart/groups').GroupId
            const timeScale = (
                beat: number,
                value: number,
                timeScaleEase: import('../../src/ease').TimeScaleEase,
            ) => ({
                groupId: group,
                beat,
                editorLane: 7,
                timeScale: value,
                skip: 0,
                timeScaleEase,
                timeScaleTransition: 'timeScale' as const,
                hideNotes: false,
            })
            const state = createState(
                {
                    initialLife: 1000,
                    isDynamicStages: false,
                    bpms: [{ beat: 0, bpm: 120 }],
                    groups: new Map([[group, { name: 'Default' }]]),
                    stages: new Map(),
                    cameraEvents: [],
                    stageMaskEvents: [],
                    stagePivotEvents: [],
                    stageStyleEvents: [],
                    stageTransformEvents: [],
                    timeScales: [
                        timeScale(0, 1, 'inQuad'),
                        timeScale(4, 2, 'outQuad'),
                        timeScale(8, 0.5, 'inStep'),
                    ],
                    slides: [],
                },
                0,
            )
            const entities = [...state.store.grid.timeScale.values()]
                .flatMap((set) => [...set])
                .sort((a, b) => a.beat - b.beat)

            const scale = 50
            const ups = -2
            const width = 240
            const height = 80
            const anchor = { x: 40, y: 40 }
            const fontFamily = 'ui-sans-serif, system-ui, sans-serif'
            const glyphBox = { left: 0.23, top: -0.17, width: 0.3, height: 0.34 }

            const measureInk = (
                ctx: CanvasRenderingContext2D,
                [x0, y0, x1, y1]: [number, number, number, number],
            ): Ink => {
                const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
                const ink = { left: Infinity, right: -1, top: Infinity, bottom: -1, alpha: 0 }
                for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
                    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
                        const value = pixels[(y * ctx.canvas.width + x) * 4 + 3]!
                        ink.alpha += value
                        if (value < 64) continue
                        ink.left = Math.min(ink.left, x)
                        ink.right = Math.max(ink.right, x)
                        ink.top = Math.min(ink.top, y)
                        ink.bottom = Math.max(ink.bottom, y)
                    }
                }
                return ink
            }

            const results = []
            for (const entity of entities) {
                const canvas = document.createElement('canvas')
                canvas.width = width * pixelRatio
                canvas.height = height * pixelRatio
                document.body.append(canvas)
                const ctx = canvas.getContext('2d')!
                const y = beatToTime(state.bpms, entity.beat) * ups
                const s = scale * pixelRatio
                // Puts the marker at the anchor.
                ctx.setTransform(
                    s,
                    0,
                    0,
                    s,
                    (anchor.x - 7 * scale) * pixelRatio,
                    (anchor.y - y * scale) * pixelRatio,
                )
                drawEvent(
                    {
                        ctx,
                        scale,
                        pixelRatio,
                        // The lanes the canvas shows, so labels keep their side.
                        bounds: {
                            l: 7 - anchor.x / scale,
                            r: 7 + (width - anchor.x) / scale,
                            t: 0,
                            b: 0,
                            w: width / scale,
                            h: 0,
                        },
                        ups,
                        state,
                        defaultGroupId: group,
                        showStageName: false,
                        showGroupName: false,
                        nameContrast: false,
                        recentlyActive: false,
                        fontFamily,
                        fontMiddle: measureTextMiddle(fontFamily, document.body),
                        figureMiddle: measureFigureMiddle(fontFamily),
                    },
                    entity,
                    false,
                )
                canvas.remove()

                // Device pixels of the glyph box, with room for the stroke.
                const box = {
                    left: (anchor.x + glyphBox.left * scale) * pixelRatio,
                    top: (anchor.y + glyphBox.top * scale) * pixelRatio,
                    width: glyphBox.width * scale * pixelRatio,
                    height: glyphBox.height * scale * pixelRatio,
                }
                const pad = 0.05 * scale * pixelRatio
                const quadrant = (right: boolean, bottom: boolean) =>
                    measureInk(ctx, [
                        box.left + (right ? box.width * 0.7 : -pad),
                        box.top + (bottom ? box.height * 0.7 : -pad),
                        box.left + (right ? box.width + pad : box.width * 0.3),
                        box.top + (bottom ? box.height + pad : box.height * 0.3),
                    ]).alpha
                const glyph = measureInk(ctx, [
                    box.left - pad,
                    box.top - pad,
                    box.left + box.width + pad,
                    box.top + box.height + pad,
                ])
                const label = measureInk(ctx, [
                    box.left + box.width + pad,
                    0,
                    canvas.width,
                    canvas.height,
                ])

                // The shared path, rasterized as SVG in the same box.
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
                svg.setAttribute('width', String(canvas.width))
                svg.setAttribute('height', String(canvas.height))
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
                const next = entities[entities.indexOf(entity) + 1]
                path.setAttribute(
                    'd',
                    easeGlyphPathD(
                        entity.timeScaleEase,
                        !!next && next.timeScale < entity.timeScale,
                        box.left,
                        box.top,
                        box.width,
                        box.height,
                    ),
                )
                path.setAttribute('fill', 'none')
                path.setAttribute('stroke', '#ff0')
                path.setAttribute('stroke-width', String(0.05 * scale * pixelRatio))
                path.setAttribute('stroke-linecap', 'round')
                path.setAttribute('stroke-linejoin', 'round')
                svg.append(path)
                const url = URL.createObjectURL(
                    new Blob([new XMLSerializer().serializeToString(svg)], {
                        type: 'image/svg+xml',
                    }),
                )
                const image = new Image()
                image.src = url
                await image.decode()
                const reference = document.createElement('canvas')
                reference.width = canvas.width
                reference.height = canvas.height
                const referenceContext = reference.getContext('2d')!
                if (entity.timeScaleEase !== 'inStep') referenceContext.drawImage(image, 0, 0)
                URL.revokeObjectURL(url)

                results.push({
                    ease: entity.timeScaleEase,
                    quadrants: {
                        topLeft: quadrant(false, false),
                        topRight: quadrant(true, false),
                        bottomLeft: quadrant(false, true),
                        bottomRight: quadrant(true, true),
                    },
                    glyph,
                    reference: measureInk(referenceContext, [
                        box.left - pad,
                        box.top - pad,
                        box.left + box.width + pad,
                        box.top + box.height + pad,
                    ]),
                    label,
                    text: measureInk(ctx, [box.left - pad, 0, canvas.width, canvas.height]),
                    glyphRight: box.left + box.width,
                })
            }
            return results
        }, pixelRatio)

        const [rising, falling, step] = results
        // Rising in-quad: holds at the start, then sweeps right toward the next value.
        expect(rising!.quadrants.bottomLeft).toBeGreaterThan(0)
        expect(rising!.quadrants.topRight).toBeGreaterThan(0)
        expect(rising!.quadrants.bottomRight).toBe(0)
        expect(rising!.quadrants.topLeft).toBe(0)
        // Falling out-quad: leaves the start sideways, toward the left.
        expect(falling!.quadrants.bottomRight).toBeGreaterThan(0)
        expect(falling!.quadrants.topLeft).toBeGreaterThan(0)
        expect(falling!.quadrants.bottomLeft).toBe(0)
        expect(falling!.quadrants.topRight).toBe(0)
        // A held step has no glyph: its value starts in the glyph's place.
        expect(step!.text.left).toBeLessThan(step!.glyphRight)

        for (const result of [rising!, falling!]) {
            for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
                expect(
                    Math.abs(result.glyph[edge] - result.reference[edge]),
                    `${result.ease}: ${edge} glyph edge`,
                ).toBeLessThanOrEqual(1)
            }
            // The value follows the glyph without touching it.
            expect(result.label.left).toBeGreaterThan(result.glyph.right + 1)
        }
    })
}

test('a BPM label stays drawn on the chart where a time scale label reaches the beat column', async ({
    page,
}) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const drawn = await page.evaluate(async () => {
        const { show, fixtures } = window.editorTest
        const texts: string[] = []
        const fillText = CanvasRenderingContext2D.prototype.fillText
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            if (
                this.canvas instanceof HTMLCanvasElement &&
                this.canvas.classList.contains('editor-chart')
            )
                texts.push(text)
            return fillText.call(this, text, ...args)
        }
        // At lane 5, the 15x label runs past lane 6.1 into the beat column, beside the BPM change.
        show(
            {
                ...fixtures.interaction,
                bpms: [
                    { beat: 0, bpm: 120 },
                    { beat: 6, bpm: 90 },
                ],
                timeScales: [
                    {
                        groupId: 1 as never,
                        beat: 6,
                        editorLane: 5,
                        timeScale: 15,
                        skip: 0,
                        timeScaleEase: 'inStep',
                        timeScaleTransition: 'timeScale',
                        hideNotes: false,
                    },
                ],
            },
            3,
        )
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        CanvasRenderingContext2D.prototype.fillText = fillText
        return texts
    })
    expect(drawn).toContain('15x')
    expect(drawn).toContain('90')
})
