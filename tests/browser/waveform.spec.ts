import { expect, test } from '@playwright/test'
import type { EditorDrawContext } from '../../src/editor/canvas/types'

test.beforeEach(async ({ page }) => {
    // Keep this a real Canvas test without unrelated app rendering. Module
    // imports still come from Vite and exercise the production renderer.
    await page.route('**/__waveform-test', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }),
    )
    await page.addInitScript(() => {
        // Firefox has no imageSmoothingQuality implementation. Make the test
        // independent of Chromium's optional higher-quality interpolation too.
        Object.defineProperty(CanvasRenderingContext2D.prototype, 'imageSmoothingQuality', {
            configurable: true,
            get: () => 'low',
            set: () => {},
        })
    })
    await page.goto('/__waveform-test')
})

test('5 ms waveform attacks survive minimum zoom and fractional scrolling', async ({ page }) => {
    const samples = await page.evaluate(async () => {
        const { createWaveformRenderer } = await import('/src/editor/canvas/waveform.ts')
        const source = document.createElement('canvas')
        source.width = 128
        source.height = 2000
        const sourceContext = source.getContext('2d')!
        const output = document.createElement('canvas')
        output.width = 256
        output.height = 1003
        const ctx = output.getContext('2d')!
        const context = { ctx, scale: 32, pixelRatio: 1, ups: -100 / 32 } as EditorDrawContext
        const results: { row: number; translation: number; alpha: number; center: number }[] = []

        for (const row of [100, 101]) {
            const pixels = sourceContext.createImageData(128, 2000)
            pixels.data.fill(255)
            for (let y = 0; y < 2000; y++) {
                for (let x = 0; x < 128; x++) {
                    pixels.data[(y * 128 + x) * 4 + 3] = y === row && x < 4 ? 255 : 0
                }
            }
            sourceContext.putImageData(pixels, 0, 0)
            const waveform = {
                images: [source.toDataURL()],
                style: { imageRendering: 'pixelated' },
            }
            let loaded: () => void = () => {}
            const ready = new Promise<void>((resolve) => (loaded = resolve))
            const renderer = createWaveformRenderer(() => loaded())
            const draw = (translation: number) => {
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.clearRect(0, 0, output.width, output.height)
                ctx.setTransform(32, 0, 0, 32, 128, 1000 + translation)
                renderer.draw(context, waveform, 0, { min: 0, max: 9.99 })
            }
            draw(0)
            await ready
            for (const translation of [0.25, 0.75]) {
                draw(translation)
                // The first four columns are the FFT peak strip, mirrored at
                // x=128. Sample inside its right half, away from the seam.
                const pixels = ctx.getImageData(129, 0, 1, output.height).data
                let alpha = 0
                let weightedPosition = 0
                for (let y = 0; y < output.height; y++) {
                    const value = pixels[y * 4 + 3]!
                    alpha += value
                    weightedPosition += (y + 0.5) * value
                }
                results.push({ row, translation, alpha, center: weightedPosition / alpha })
            }
            renderer.clear()
        }
        return results
    })

    for (const { row, translation, alpha, center } of samples) {
        expect(
            alpha,
            `attack row ${row} at ${translation}px translation disappeared`,
        ).toBeGreaterThan(0)
        expect(Math.abs(center - ((row + 0.5) / 2 + translation))).toBeLessThanOrEqual(1)
    }
})

test('waveform zoom reuses reductions and returns to the original raster when enlarged', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { createWaveformRenderer } = await import('/src/editor/canvas/waveform.ts')
        const source = document.createElement('canvas')
        source.width = 128
        source.height = 2000
        const sourceContext = source.getContext('2d')!
        sourceContext.fillStyle = '#fff'
        sourceContext.fillRect(0, 101, 4, 1)
        const waveform = {
            images: [source.toDataURL()],
            style: { imageRendering: 'pixelated' },
        }
        const output = document.createElement('canvas')
        output.width = 256
        output.height = 4003
        const ctx = output.getContext('2d')!
        const context = { ctx, scale: 32, pixelRatio: 1, ups: -100 / 32 } as EditorDrawContext
        let allocations = 0
        let rasterWrites = 0
        const createElement = document.createElement.bind(document)
        document.createElement = ((...args: Parameters<typeof document.createElement>) => {
            if (args[0].toLowerCase() === 'canvas') allocations++
            return createElement(...args)
        }) as typeof document.createElement
        const putImageData = CanvasRenderingContext2D.prototype.putImageData
        CanvasRenderingContext2D.prototype.putImageData = function (...args) {
            rasterWrites++
            return Reflect.apply(putImageData, this, args)
        }
        const drawn: CanvasImageSource[] = []
        const drawImage = ctx.drawImage
        ctx.drawImage = function (...args) {
            drawn.push(args[0])
            return Reflect.apply(drawImage, this, args)
        }
        let loaded: () => void = () => {}
        const ready = new Promise<void>((resolve) => (loaded = resolve))
        const renderer = createWaveformRenderer(() => loaded())
        const draw = (pps: number, translation: number) => {
            drawn.length = 0
            context.ups = -pps / 32
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.clearRect(0, 0, output.width, output.height)
            ctx.setTransform(32, 0, 0, 32, 128, pps * 10 + translation)
            renderer.draw(context, waveform, 0, { min: 0, max: 9.99 })
        }
        draw(100, 0)
        await ready
        draw(100, 0.25)
        const reducedSource = drawn[0]
        const reducedHeight = reducedSource instanceof HTMLCanvasElement ? reducedSource.height : -1
        const initial = { allocations, rasterWrites }
        for (let i = 0; i < 4; i++) draw(100, i % 2 ? 0.25 : 0.75)
        const repeated = { allocations, rasterWrites }
        const reusesReducedSource = drawn.every((image) => image === reducedSource)
        draw(400, 0.25)
        const zoomedUsesOriginal = drawn.every(
            (image) => image instanceof HTMLImageElement && image.naturalHeight === 2000,
        )
        draw(100, 0.75)
        const returned = { allocations, rasterWrites }
        const returnsToCachedReduction = drawn.every((image) => image === reducedSource)
        renderer.clear()
        return {
            reducedHeight,
            initial,
            repeated,
            returned,
            reusesReducedSource,
            zoomedUsesOriginal,
            returnsToCachedReduction,
        }
    })

    expect(result.reducedHeight).toBeGreaterThan(0)
    expect(result.reducedHeight).toBeLessThanOrEqual(1000)
    expect(result.initial.allocations).toBeGreaterThan(0)
    expect(result.repeated).toEqual(result.initial)
    expect(result.returned).toEqual(result.initial)
    expect(result.reusesReducedSource).toBe(true)
    expect(result.zoomedUsesOriginal).toBe(true)
    expect(result.returnsToCachedReduction).toBe(true)
})

test('waveform attacks survive fractional DPR and downward backing-size rounding', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { createWaveformRenderer } = await import('/src/editor/canvas/waveform.ts')
        const { prepareSurface } = await import('/src/editor/canvas/surface.ts')
        const width = 204.8
        const height = 1600.2
        const pixelRatio = 1.25
        const scale = width / 8
        const ups = -160 / scale
        const output = document.createElement('canvas')
        const source = document.createElement('canvas')
        source.width = 128
        source.height = 2000
        const sourceContext = source.getContext('2d')!
        const samples: { row: number; alpha: number; error: number }[] = []
        let actualTilePixels = 0

        // These attacks are far from both tile edges. Without accounting for
        // backing-size rounding each disappears at the corresponding scroll phase.
        for (const [row, translation] of [
            [400, -0.45],
            [801, -0.4],
            [1602, -0.3],
        ] as const) {
            sourceContext.clearRect(0, 0, source.width, source.height)
            sourceContext.fillStyle = '#fff'
            sourceContext.fillRect(0, row, 4, 1)
            const waveform = {
                images: [source.toDataURL()],
                style: { imageRendering: 'pixelated' },
            }
            let loaded: () => void = () => {}
            const ready = new Promise<void>((resolve) => (loaded = resolve))
            const renderer = createWaveformRenderer(() => loaded())
            const top = -62.5 - translation / (scale * pixelRatio)
            const bounds = {
                l: -4,
                r: 4,
                t: top,
                b: top + height / scale,
                w: 8,
                h: height / scale,
            }
            const draw = () => {
                const ctx = prepareSurface(output, width, height, pixelRatio, bounds)!
                renderer.draw({ ctx, ups, scale, pixelRatio } as EditorDrawContext, waveform, 0, {
                    min: 0,
                    max: 9.99,
                })
                return ctx
            }
            draw()
            await ready
            const ctx = draw()
            const transform = ctx.getTransform()
            actualTilePixels = 10 * Math.abs(ups) * transform.d
            const pixels = ctx.getImageData(129, 0, 1, output.height).data
            let alpha = 0
            let weightedPosition = 0
            for (let y = 0; y < output.height; y++) {
                const value = pixels[y * 4 + 3]!
                alpha += value
                weightedPosition += (y + 0.5) * value
            }
            const expected =
                transform.f - actualTilePixels + ((row + 0.5) / 2000) * actualTilePixels
            samples.push({ row, alpha, error: Math.abs(weightedPosition / alpha - expected) })
            renderer.clear()
        }
        return {
            backingHeight: output.height,
            nominalTilePixels: 10 * Math.abs(ups) * scale * pixelRatio,
            actualTilePixels,
            samples,
        }
    })

    expect(result.backingHeight).toBe(2000)
    expect(result.nominalTilePixels).toBe(2000)
    expect(result.actualTilePixels).toBeLessThan(result.nominalTilePixels)
    for (const { row, alpha, error } of result.samples) {
        expect(alpha, `attack row ${row} disappeared after backing-size rounding`).toBeGreaterThan(
            0,
        )
        expect(error).toBeLessThanOrEqual(1.25)
    }
})
