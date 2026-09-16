import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        bgmTestErrors: string[]
    }
}

const wav = (duration: number) => {
    const sampleRate = 44100
    const length = Math.round(duration * sampleRate)
    const data = Buffer.alloc(44 + length * 2)
    data.write('RIFF', 0)
    data.writeUInt32LE(data.length - 8, 4)
    data.write('WAVEfmt ', 8)
    data.writeUInt32LE(16, 16)
    data.writeUInt16LE(1, 20)
    data.writeUInt16LE(1, 22)
    data.writeUInt32LE(sampleRate, 24)
    data.writeUInt32LE(sampleRate * 2, 28)
    data.writeUInt16LE(2, 32)
    data.writeUInt16LE(16, 34)
    data.write('data', 36)
    data.writeUInt32LE(length * 2, 40)
    for (let i = 0; i < length; i++) {
        data.writeInt16LE(
            Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 1000) * 16000),
            44 + i * 2,
        )
    }
    return data
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.bgmTestErrors = []
        window.addEventListener('error', (event) => window.bgmTestErrors.push(event.message))
        window.addEventListener('unhandledrejection', (event) =>
            window.bgmTestErrors.push(String(event.reason)),
        )
    })
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.bgmTestErrors), 'uncaught browser errors').toEqual([])
})

for (const { mode, duration, missingSuspend } of [
    { mode: 'fft', duration: 0.02, missingSuspend: true },
    { mode: 'fft', duration: 0.021, missingSuspend: true },
    { mode: 'fft', duration: 0.02, missingSuspend: false },
    { mode: 'volume', duration: 0.021, missingSuspend: true },
    { mode: 'off', duration: 0.021, missingSuspend: true },
] as const) {
    test(`BGM import with ${mode} waveform (${duration}s, suspend ${missingSuspend ? 'missing' : 'available'})`, async ({
        page,
    }) => {
        if (missingSuspend) {
            // Firefox exposes OfflineAudioContext but omits these optional methods.
            await page.addInitScript(() => {
                for (const method of ['suspend', 'resume']) {
                    Object.defineProperty(OfflineAudioContext.prototype, method, {
                        configurable: true,
                        value: undefined,
                    })
                }
            })
        }
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.evaluate((mode) => (window.editorTest.settings.waveform = mode), mode)

        await page.keyboard.press('m')
        const modal = page.getByRole('dialog')
        await expect(modal).toHaveCount(1)
        const file = modal.locator('input[type="button"]')
        const choosing = page.waitForEvent('filechooser')
        await file.click()
        await (
            await choosing
        ).setFiles({
            name: 'bgm-regression.wav',
            mimeType: 'audio/wav',
            buffer: wav(duration),
        })
        await expect(file).toHaveValue(/^00:/)
        await expect(modal).toHaveCount(1)
        await modal.getByRole('button', { name: 'Confirm', exact: true }).click()
        await expect(modal).toHaveCount(0)

        const result = await page.evaluate(async () => {
            const { buffer, filename, waveform } = window.editorTest.history.state.value.bgm
            let visiblePixels = 0
            for (const url of waveform?.images ?? []) {
                const bitmap = await createImageBitmap(await (await fetch(url)).blob())
                const canvas = document.createElement('canvas')
                canvas.width = bitmap.width
                canvas.height = bitmap.height
                const ctx = canvas.getContext('2d')!
                ctx.drawImage(bitmap, 0, 0)
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i]) visiblePixels++
                }
                bitmap.close()
            }
            return {
                filename,
                duration: buffer?.duration,
                images: waveform?.images.length ?? 0,
                visiblePixels,
                mode: window.editorTest.settings.waveform,
            }
        })
        expect(result.filename).toBe('bgm-regression')
        expect(result.duration).toBeCloseTo(duration, 3)
        expect(result.mode).toBe(mode)
        if (mode === 'off') {
            expect(result.images).toBe(0)
        } else {
            expect(result.images).toBe(1)
            expect(result.visiblePixels).toBeGreaterThan(0)
        }
    })
}

test('FFT waveform retains native analyser intensity for mono and stereo audio', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const differences = await page.evaluate(async () => {
        const { createSpectrumSampler, FFT_BINS } = await import('/src/waveform/fft.ts')
        const differences: {
            channels: number
            time: number
            bin: number
            native: number
            actual: number
        }[] = []
        const sampleRate = 48000
        for (const numberOfChannels of [1, 2]) {
            const ctx = new OfflineAudioContext(numberOfChannels, sampleRate / 5, sampleRate)
            const buffer = ctx.createBuffer(numberOfChannels, sampleRate / 5, sampleRate)
            const channels = Array.from({ length: numberOfChannels }, (_, channel) => {
                const samples = buffer.getChannelData(channel)
                for (let i = 0; i < samples.length; i++) {
                    const t = i / sampleRate
                    samples[i] =
                        0.018 * Math.sin(2 * Math.PI * (1378.125 + channel * 750) * t) +
                        0.009 * Math.cos(2 * Math.PI * (6250 - channel * 125) * t)
                }
                return samples
            })
            const sample = createSpectrumSampler(channels)
            const source = ctx.createBufferSource()
            source.buffer = buffer
            const analyser = ctx.createAnalyser()
            analyser.fftSize = FFT_BINS * 2
            source.connect(analyser)
            source.start()
            const suspensions = Array.from({ length: 11 }, (_, row) => {
                const time = row / 100
                return ctx.suspend(time).then(async () => {
                    const native = new Uint8Array(FFT_BINS)
                    const actual = new Uint8Array(FFT_BINS)
                    analyser.getByteFrequencyData(native)
                    sample(Math.ceil((time * sampleRate) / 128) * 128, actual)
                    for (let bin = 0; bin < FFT_BINS; bin++) {
                        if (Math.abs(native[bin]! - actual[bin]!) > 1) {
                            differences.push({
                                channels: numberOfChannels,
                                time,
                                bin,
                                native: native[bin]!,
                                actual: actual[bin]!,
                            })
                        }
                    }
                    await ctx.resume()
                })
            })
            await Promise.all([ctx.startRendering(), ...suspensions])
        }
        return differences
    })
    expect(differences, 'software spectrum differs by at most one opacity level').toEqual([])
})
