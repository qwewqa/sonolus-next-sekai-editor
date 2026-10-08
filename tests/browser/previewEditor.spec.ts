import { expect, test, type Page } from '@playwright/test'

declare global {
    interface Window {
        encoded: number[]
        encodedRate: number
    }
}

const sampleRate = 22050

/** A 3 s, 440 Hz sine at half amplitude, as 16-bit mono WAV. */
const tone = () => {
    const length = sampleRate * 3
    const wav = Buffer.alloc(44 + length * 2)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + length * 2, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sampleRate, 24)
    wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(length * 2, 40)
    for (let i = 0; i < length; i++)
        wav.writeInt16LE(
            Math.round(16383 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
            44 + i * 2,
        )
    return wav
}

// Records the samples the preview encodes, from the first channel.
const recorder = (encoder: string) => `function Recorder(...args) {
    window.encodedRate = args[1]
    const instance = new ${encoder}(...args)
    const encode = instance.encodeBuffer
    instance.encodeBuffer = (left, right) => {
        window.encoded.push(...left)
        return encode.call(instance, left, right)
    }
    return instance
}
export { Recorder as Mp3Encoder,`

test.beforeEach(async ({ page }) => {
    await page.route('**/@breezystack_lamejs.js*', async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
            /export \{ (\w+) as Mp3Encoder,/,
            (_, encoder: string) => recorder(encoder),
        )
        await route.fulfill({ response, body })
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(async () => {
        const { showModal } = await import('/src/modals/index.ts')
        const { default: component } =
            await import('/src/editor/utilities/previewEditor/PreviewEditorModal.vue')
        void showModal(component, {})
    })
    const dialog = page.getByRole('dialog')
    const chooser = page.waitForEvent('filechooser')
    await dialog.locator('input[type="button"]').click()
    await (await chooser).setFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: tone() })
    await expect(dialog.locator('input[type="button"]').first()).toHaveValue(/^00:03/)
})

/** Fills Start, End, Fade Start and Fade End, in that order. */
const fill = async (page: Page, values: number[]) => {
    const fields = page.getByRole('dialog').locator('input[type="number"]')
    for (const [i, value] of values.entries()) {
        await fields.nth(i).fill(`${value}`)
        await fields.nth(i).press('Tab')
    }
}

/** The samples the preview encodes at its rate, and the peak of the last 300. */
const generate = async (page: Page) => {
    await page.evaluate(() => (window.encoded = []))
    const downloading = page.waitForEvent('download')
    await page.getByRole('dialog').getByRole('button', { name: 'Generate' }).click()
    await downloading
    return page.evaluate(() => ({
        length: window.encoded.length,
        rate: window.encodedRate,
        tail: Math.max(...window.encoded.slice(-300).map(Math.abs)) / 32768,
    }))
}

test('an End past the audio fades out by the end of the audio', async ({ page }) => {
    // The defaults: End 30 s, 1 s fades.
    const { length, rate, tail } = await generate(page)
    expect(length).toBe(rate * 3)
    expect(tail).toBeLessThan(0.01)
})

test('the last encoded chunk stops at End', async ({ page }) => {
    // At 48 kHz, End lands 52 samples into a 1152-sample chunk.
    await fill(page, [0, 2.593073, 0, 0.05])
    const { length, rate, tail } = await generate(page)
    expect(length).toBe(Math.floor(rate * 2.593073) + 1)
    expect(tail).toBeLessThan(0.1)
})

test('a Start past the audio is refused', async ({ page }) => {
    await fill(page, [5])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('alert')).toHaveText('Start is past the end of the audio')
    await expect(dialog.getByRole('button', { name: 'Generate' })).toBeDisabled()
})

test('a Start exactly at the end of the audio is refused', async ({ page }) => {
    // The tone is 3 s long, so nothing would play.
    await fill(page, [3])
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('alert')).toHaveText('Start is past the end of the audio')
    await expect(dialog.getByRole('button', { name: 'Generate' })).toBeDisabled()
})
