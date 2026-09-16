import type { CSSProperties } from 'vue'
import { createBlob } from './utils/canvas'
import { timeout } from './utils/promise'
import { createSpectrumSampler, FFT_BINS } from './waveform/fft'

export type Waveform = {
    images: string[]
    style: CSSProperties
}

export const waveformDuration = 10

const createdUrls: string[] = []

export const createWaveform = async (
    buffer: AudioBuffer,
    type: 'off' | 'fft' | 'volume',
): Promise<Waveform | undefined> => {
    if (type === 'off') return

    const { pps, w, h, pixels, style } =
        type === 'fft' ? await createPixelsFFT(buffer) : createPixelsVolume(buffer)

    const images: string[] = []

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = waveformDuration * pps

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Unexpected missing canvas context')

    const imageData = ctx.createImageData(w, canvas.height)
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < canvas.height; y++) {
            const i = (x + y * w) * 4

            imageData.data[i + 0] = 255
            imageData.data[i + 1] = 255
            imageData.data[i + 2] = 255
        }
    }

    const count = Math.ceil(h / canvas.height)
    for (let i = 0; i < count; i++) {
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < canvas.height; y++) {
                imageData.data[(x + (canvas.height - 1 - y) * w) * 4 + 3] =
                    pixels[x + (i * canvas.height + y) * w] ?? 0
            }
        }
        ctx.putImageData(imageData, 0, 0)

        const blob = await createBlob(canvas)
        images.push(URL.createObjectURL(blob))
    }

    createdUrls.push(...images)

    return {
        images,
        style,
    }
}

export const cleanupWaveform = () => {
    for (const url of createdUrls) {
        URL.revokeObjectURL(url)
    }

    createdUrls.length = 0
}

const createPixelsFFT = async (buffer: AudioBuffer) => {
    const pps = 100
    const w = FFT_BINS
    const h = Math.floor(buffer.duration * pps) + 1
    const pixels = new Uint8Array(w * h)
    const sample = createSpectrumSampler(
        Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
    )

    for (let y = 0; y < h; y++) {
        // Match offline-audio suspension's render-quantum alignment without
        // depending on suspend/resume, which Firefox does not implement.
        const end = Math.min(buffer.length, Math.ceil(((y / pps) * buffer.sampleRate) / 128) * 128)
        sample(end, pixels.subarray(y * w, (y + 1) * w))
        // Keep long music imports responsive without creating a full-length
        // offline render buffer or thousands of suspension promises.
        if (y && y % 256 === 0) await timeout(0)
    }

    return {
        pps,
        w,
        h,
        pixels,
        style: {},
    }
}

const createPixelsVolume = (buffer: AudioBuffer) => {
    const pps = 200

    const w = 50
    const h = Math.floor(buffer.duration * pps) + 1

    const pixels = new Uint8Array(w * h)

    let maxValue = 0
    const channels = [...Array(buffer.numberOfChannels).keys()].map((i) => buffer.getChannelData(i))
    const values = [...Array(h).keys()].map((y) => {
        let count = 0
        let sum = 0

        const min = Math.floor((y / pps) * buffer.sampleRate)
        const max = Math.floor(((y + 1) / pps) * buffer.sampleRate)

        for (const channel of channels) {
            for (let i = min; i < max; i++) {
                count++
                sum += Math.abs(channel[i] ?? 0)
            }
        }

        const value = sum / count
        if (value > maxValue) maxValue = value

        return value
    })

    for (const [y, value] of values.entries()) {
        const length = (value / maxValue) * w
        for (let x = 0; x < length; x++) {
            pixels[x + y * w] = 255
        }
    }

    return {
        pps,
        w,
        h,
        pixels,
        style: {
            imageRendering: 'pixelated',
        },
    }
}
