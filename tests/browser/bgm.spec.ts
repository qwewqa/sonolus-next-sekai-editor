import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        bgmTestErrors: string[]
        bgmImportGate: {
            held: boolean
            encoded: number
            created: string[]
            revoked: string[]
            release: () => void
        }
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

// Pause the second tile at a real asynchronous browser boundary. The first
// tile already owns a blob URL, so cancellation must clean up partial results.
const trackWaveformTiles = (heldTile = 2) => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    const createUrl = URL.createObjectURL
    const revokeUrl = URL.revokeObjectURL
    const gate = (window.bgmImportGate = {
        held: false,
        encoded: 0,
        created: [] as string[],
        revoked: [] as string[],
        release: () => {},
    })
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        const hold = ++gate.encoded === heldTile
        toBlob.call(
            this,
            (blob) => {
                if (hold) {
                    gate.held = true
                    gate.release = () => {
                        gate.held = false
                        callback(blob)
                    }
                } else {
                    callback(blob)
                }
            },
            type,
            quality,
        )
    }
    URL.createObjectURL = (blob) => {
        const url = createUrl.call(URL, blob)
        gate.created.push(url)
        return url
    }
    URL.revokeObjectURL = (url) => {
        gate.revoked.push(url)
        revokeUrl.call(URL, url)
    }
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
            const dimensions: { width: number; height: number }[] = []
            for (const url of waveform?.images ?? []) {
                const bitmap = await createImageBitmap(await (await fetch(url)).blob())
                dimensions.push({ width: bitmap.width, height: bitmap.height })
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
                dimensions,
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
            if (mode === 'fft') {
                expect(result.dimensions).toEqual([{ width: 128, height: 2000 }])
            }
        }
    })
}

test('FFT tiles retain opposite-phase stereo without smearing attacks into silence', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const result = await page.evaluate(async () => {
        const { createWaveform, cleanupWaveform } = await import('/src/waveform.ts')
        const sampleRate = 48000
        const spectra: number[][] = []
        for (const numberOfChannels of [1, 2]) {
            const buffer = new AudioBuffer({
                numberOfChannels,
                length: sampleRate / 10,
                sampleRate,
            })
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const samples = buffer.getChannelData(channel)
                for (let i = 960; i < 1920; i++) {
                    samples[i] =
                        0.1 * Math.sin((2 * Math.PI * 1500 * i) / sampleRate) * (channel ? -1 : 1)
                }
            }
            const waveform = (await createWaveform(buffer, 'fft'))!
            const bitmap = await createImageBitmap(await (await fetch(waveform.images[0]!)).blob())
            const canvas = document.createElement('canvas')
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(bitmap, 0, 0)
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const rows = []
            for (let row = 0; row < 20; row++) {
                for (let x = 0; x < 128; x++) {
                    rows.push(data[((1999 - row) * 128 + x) * 4 + 3]!)
                }
            }
            spectra.push(rows)
            bitmap.close()
        }
        cleanupWaveform()
        return {
            mono: spectra[0]!,
            stereo: spectra[1]!,
            attack: spectra[0]!.slice(4 * 128 + 4, 5 * 128),
            silence: spectra[0]!.slice(12 * 128),
        }
    })
    expect(result.stereo, 'opposite-phase channels retain the same spectral power').toEqual(
        result.mono,
    )
    expect(result.attack.some((alpha) => alpha > 0)).toBe(true)
    expect(
        result.silence.every((alpha) => alpha === 0),
        'no trailing history smoothing',
    ).toBe(true)
})

for (const sampleRate of [44100, 48000]) {
    test(`FFT attack rows align across tile boundaries and audio endpoints at ${sampleRate} Hz`, async ({
        page,
    }) => {
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        const results = await page.evaluate(async (sampleRate) => {
            const { createWaveform, cleanupWaveform } = await import('/src/waveform.ts')
            const results = []
            for (const { duration, frames } of [
                {
                    duration: 10.01,
                    // Integer row arithmetic avoids rounding 9.995 * 44100
                    // just below its exact half-sample boundary.
                    frames: [
                        0,
                        Math.round((1999 * sampleRate) / 200),
                        10 * sampleRate,
                        Math.round((2001 * sampleRate) / 200),
                    ],
                },
                { duration: 10, frames: [10 * sampleRate - 1] },
            ]) {
                const buffer = new AudioBuffer({
                    numberOfChannels: 1,
                    length: Math.round(duration * sampleRate),
                    sampleRate,
                })
                for (const frame of frames) buffer.getChannelData(0)[frame] = 1
                const waveform = (await createWaveform(buffer, 'fft'))!
                const attackRows: number[] = []
                let mismatchedStripPixels = 0
                let paddedVisiblePixels = 0
                const dimensions = []
                for (const [tile, url] of waveform.images.entries()) {
                    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
                    dimensions.push({ width: bitmap.width, height: bitmap.height })
                    const canvas = document.createElement('canvas')
                    canvas.width = bitmap.width
                    canvas.height = bitmap.height
                    const ctx = canvas.getContext('2d')!
                    ctx.drawImage(bitmap, 0, 0)
                    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
                    for (let row = 0; row < 2000; row++) {
                        const globalRow = tile * 2000 + row
                        const rowOffset = (1999 - row) * 128 * 4
                        const alpha = data[rowOffset + 3]!
                        if (alpha) attackRows.push(globalRow)
                        for (let x = 1; x < 4; x++) {
                            if (data[rowOffset + x * 4 + 3] !== alpha) mismatchedStripPixels++
                        }
                        if (globalRow >= Math.ceil(buffer.duration * 200)) {
                            for (let x = 0; x < 128; x++) {
                                if (data[rowOffset + x * 4 + 3]) paddedVisiblePixels++
                            }
                        }
                    }
                    bitmap.close()
                }
                results.push({ attackRows, dimensions, mismatchedStripPixels, paddedVisiblePixels })
            }
            cleanupWaveform()
            return results
        }, sampleRate)
        expect(results[0]).toEqual({
            attackRows: [0, 1999, 2000, 2001],
            dimensions: [
                { width: 128, height: 2000 },
                { width: 128, height: 2000 },
            ],
            mismatchedStripPixels: 0,
            paddedVisiblePixels: 0,
        })
        expect(
            results[1],
            'exact ten-second audio needs one tile and retains its last sample',
        ).toEqual({
            attackRows: [1999],
            dimensions: [{ width: 128, height: 2000 }],
            mismatchedStripPixels: 0,
            paddedVisiblePixels: 0,
        })
    })
}

test('FFT import revokes completed tiles when encoding a later tile fails', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const result = await page.evaluate(async () => {
        const { createWaveform, cleanupWaveform } = await import('/src/waveform.ts')
        const toBlob = HTMLCanvasElement.prototype.toBlob
        const createUrl = URL.createObjectURL
        const revokeUrl = URL.revokeObjectURL
        const created: string[] = []
        const revoked: string[] = []
        let encoded = 0
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
            if (++encoded === 2) {
                callback(null)
            } else {
                toBlob.call(this, callback, type, quality)
            }
        }
        URL.createObjectURL = (blob) => {
            const url = createUrl.call(URL, blob)
            created.push(url)
            return url
        }
        URL.revokeObjectURL = (url) => {
            revoked.push(url)
            revokeUrl.call(URL, url)
        }
        let failure = ''
        try {
            await createWaveform(new AudioBuffer({ length: 480001, sampleRate: 48000 }), 'fft')
        } catch (error) {
            failure = String(error)
        } finally {
            cleanupWaveform()
            HTMLCanvasElement.prototype.toBlob = toBlob
            URL.createObjectURL = createUrl
            URL.revokeObjectURL = revokeUrl
        }
        return { failure, encoded, created, revoked }
    })
    expect(result.failure).toContain('Unexpected missing blob')
    expect(result.encoded).toBe(2)
    expect(result.created).toHaveLength(1)
    expect(result.revoked).toEqual(result.created)
})

test('cancelled BGM import cannot overwrite a replacement or leak partial FFT tiles', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => (window.editorTest.settings.waveform = 'fft'))
    await page.evaluate(trackWaveformTiles)

    await page.keyboard.press('m')
    const dialogs = page.getByRole('dialog')
    const file = dialogs.first().locator('input[type="button"]')
    const firstChooser = page.waitForEvent('filechooser')
    await file.click()
    await (
        await firstChooser
    ).setFiles({ name: 'cancelled.wav', mimeType: 'audio/wav', buffer: wav(10.01) })
    await expect.poll(() => page.evaluate(() => window.bgmImportGate.held)).toBe(true)
    const firstUrl = await page.evaluate(() => window.bgmImportGate.created[0]!)
    await expect(dialogs).toHaveCount(2)

    // Escape dismisses the native dialog without invoking its close button.
    // Cancellation therefore has to work on unmount as well as button clicks.
    await page.keyboard.press('Escape')
    await expect(dialogs).toHaveCount(1)
    const replacementChooser = page.waitForEvent('filechooser')
    await file.click()
    await (
        await replacementChooser
    ).setFiles({ name: 'replacement.wav', mimeType: 'audio/wav', buffer: wav(0.021) })
    await expect(file).toHaveValue(/^00:/)
    await expect(dialogs).toHaveCount(1)
    const replacementDuration = await file.inputValue()

    await page.evaluate(() => window.bgmImportGate.release())
    await expect.poll(() => page.evaluate(() => window.bgmImportGate.revoked)).toContain(firstUrl)
    await expect(file).toHaveValue(replacementDuration)
    expect(await page.evaluate(() => window.bgmImportGate.created.length)).toBe(2)
    await dialogs.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialogs).toHaveCount(0)
    const result = await page.evaluate(() => {
        const { filename, buffer, waveform } = window.editorTest.history.state.value.bgm
        return {
            filename,
            duration: buffer?.duration,
            images: waveform?.images,
            created: window.bgmImportGate.created,
            revoked: window.bgmImportGate.revoked,
        }
    })
    expect(result.filename).toBe('replacement')
    expect(result.duration).toBeCloseTo(0.021, 3)
    expect(result.images).toEqual([result.created[1]])
    expect(result.revoked).toEqual([firstUrl])
})

test('resetting the chart during BGM import leaves no late waveform URLs', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => (window.editorTest.settings.waveform = 'fft'))
    await page.evaluate(trackWaveformTiles)

    await page.keyboard.press('m')
    const dialogs = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialogs.locator('input[type="button"]').click()
    await (
        await chooser
    ).setFiles({ name: 'cancelled.wav', mimeType: 'audio/wav', buffer: wav(10.01) })
    await expect.poll(() => page.evaluate(() => window.bgmImportGate.held)).toBe(true)
    await page.evaluate(() => {
        window.editorTest.history.resetState(false)
        window.bgmImportGate.release()
    })
    await expect(dialogs).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.bgmImportGate.revoked.length)).toBe(1)
    const result = await page.evaluate(() => ({
        created: window.bgmImportGate.created,
        revoked: window.bgmImportGate.revoked,
        filename: window.editorTest.history.state.value.bgm.filename,
        hasBuffer: !!window.editorTest.history.state.value.bgm.buffer,
        hasWaveform: !!window.editorTest.history.state.value.bgm.waveform,
        canUndo: window.editorTest.history.canUndo.value,
    }))
    expect(result.created).toHaveLength(1)
    expect(result.revoked).toEqual(result.created)
    expect(result.filename).toBeUndefined()
    expect(result.hasBuffer).toBe(false)
    expect(result.hasWaveform).toBe(false)
    expect(result.canUndo).toBe(false)
})

test('aborting FFT work at its first yield prevents tile encoding', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const result = await page.evaluate(async () => {
        const { createWaveform } = await import('/src/waveform.ts')
        const controller = new AbortController()
        const toBlob = HTMLCanvasElement.prototype.toBlob
        let encoded = 0
        HTMLCanvasElement.prototype.toBlob = function (...args) {
            encoded++
            toBlob.apply(this, args)
        }
        let failure = ''
        try {
            // The async function runs synchronously until FFT's first yield.
            const pending = createWaveform(
                new AudioBuffer({ length: 48000 * 60, sampleRate: 48000 }),
                'fft',
                controller.signal,
            )
            controller.abort()
            await pending
        } catch (error) {
            failure = error instanceof DOMException ? error.name : String(error)
        } finally {
            HTMLCanvasElement.prototype.toBlob = toBlob
        }
        return { failure, encoded }
    })
    expect(result).toEqual({ failure: 'AbortError', encoded: 0 })
})

test('closing completed BGM drafts releases only URLs that were never committed', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => (window.editorTest.settings.waveform = 'fft'))
    await page.evaluate(trackWaveformTiles, 0)
    const dialogs = page.getByRole('dialog')

    for (const commit of [false, true]) {
        await page.keyboard.press('m')
        const file = dialogs.locator('input[type="button"]')
        const chooser = page.waitForEvent('filechooser')
        await file.click()
        await (
            await chooser
        ).setFiles({ name: 'draft.wav', mimeType: 'audio/wav', buffer: wav(0.021) })
        await expect(file).toHaveValue(/^00:/)
        await expect(dialogs).toHaveCount(1)
        if (commit) {
            await dialogs.getByRole('button', { name: 'Confirm', exact: true }).click()
        } else {
            await dialogs.locator('button').first().click()
        }
        await expect(dialogs).toHaveCount(0)
    }

    // Reopening and cancelling a dialog must not release the existing chart's
    // waveform. That image is also retained by history while the import is undone.
    await page.keyboard.press('m')
    await expect(dialogs).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialogs).toHaveCount(0)
    const result = await page.evaluate(async () => {
        const { history } = window.editorTest
        const images = history.state.value.bgm.waveform!.images
        history.undoState()
        const whileUndone = history.state.value.bgm.filename
        const response = await fetch(images[0]!)
        const bitmap = await createImageBitmap(await response.blob())
        const width = bitmap.width
        bitmap.close()
        history.redoState()
        return {
            created: window.bgmImportGate.created,
            revoked: window.bgmImportGate.revoked,
            images,
            restored: history.state.value.bgm.waveform!.images,
            whileUndone,
            width,
        }
    })
    expect(result.created).toHaveLength(2)
    expect(result.revoked).toEqual([result.created[0]])
    expect(result.images).toEqual([result.created[1]])
    expect(result.restored).toEqual(result.images)
    expect(result.whileUndone).toBeUndefined()
    expect(result.width).toBe(128)
})
