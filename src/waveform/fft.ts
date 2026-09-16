export const FFT_SIZE = 64
export const FFT_BINS = FFT_SIZE / 2

const window = Float64Array.from(
    { length: FFT_SIZE },
    (_, i) =>
        0.42 -
        0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE) +
        0.08 * Math.cos((4 * Math.PI * i) / FFT_SIZE),
)
const cosine = Float64Array.from({ length: FFT_BINS }, (_, i) =>
    Math.cos((-2 * Math.PI * i) / FFT_SIZE),
)
const sine = Float64Array.from({ length: FFT_BINS }, (_, i) =>
    Math.sin((-2 * Math.PI * i) / FFT_SIZE),
)
const reversed = Uint8Array.from({ length: FFT_SIZE }, (_, i) => {
    let value = 0
    for (let bit = 0; bit < 6; bit++) {
        value = value * 2 + (i & 1)
        i >>= 1
    }
    return value
})

const getChannelWeights = (count: number): readonly number[] => {
    switch (count) {
        case 2:
            return [0.5, 0.5]
        case 4:
            return [0.25, 0.25, 0.25, 0.25]
        case 6:
            return [Math.SQRT1_2, Math.SQRT1_2, 1, 0, 0.5, 0.5]
        default:
            // Web Audio uses discrete mixing for unsupported speaker layouts.
            return [1]
    }
}

/**
 * Matches the 64-point AnalyserNode spectrum, including speaker downmixing,
 * Blackman windowing, 0.8 smoothing and the default -100 to -30 dB byte scale.
 * https://www.w3.org/TR/webaudio/#fft-windowing-and-smoothing-over-time
 *
 * endFrame is the exclusive end of the audio already rendered. Call in time
 * order; repeated frames reuse their spectrum without advancing smoothing.
 */
export const createSpectrumSampler = (channels: readonly Float32Array[]) => {
    const weights = getChannelWeights(channels.length)
    const inputs = channels
        .map((data, i) => ({ data, weight: weights[i] ?? 0 }))
        .filter(({ weight }) => weight !== 0)
    const real = new Float64Array(FFT_SIZE)
    const imaginary = new Float64Array(FFT_SIZE)
    const smoothed = new Float64Array(FFT_BINS)
    const bytes = new Uint8Array(FFT_BINS)
    let previousFrame = -1

    return (endFrame: number, output: Uint8Array): void => {
        if (endFrame === previousFrame) {
            output.set(bytes)
            return
        }
        previousFrame = endFrame
        imaginary.fill(0)

        for (let i = 0; i < FFT_SIZE; i++) {
            let sample = 0
            const frame = endFrame - FFT_SIZE + i
            for (const { data, weight } of inputs) {
                sample += (data[frame] ?? 0) * weight
            }
            real[reversed[i] ?? 0] = sample * (window[i] ?? 0)
        }

        for (let length = 2; length <= FFT_SIZE; length *= 2) {
            const half = length / 2
            const step = FFT_SIZE / length
            for (let start = 0; start < FFT_SIZE; start += length) {
                for (let i = 0; i < half; i++) {
                    const even = start + i
                    const odd = even + half
                    const angle = i * step
                    const cos = cosine[angle] ?? 0
                    const sin = sine[angle] ?? 0
                    const oddReal = (real[odd] ?? 0) * cos - (imaginary[odd] ?? 0) * sin
                    const oddImaginary = (real[odd] ?? 0) * sin + (imaginary[odd] ?? 0) * cos
                    const evenReal = real[even] ?? 0
                    const evenImaginary = imaginary[even] ?? 0
                    real[even] = evenReal + oddReal
                    imaginary[even] = evenImaginary + oddImaginary
                    real[odd] = evenReal - oddReal
                    imaginary[odd] = evenImaginary - oddImaginary
                }
            }
        }

        for (let i = 0; i < FFT_BINS; i++) {
            const magnitude = Math.hypot(real[i] ?? 0, imaginary[i] ?? 0) / FFT_SIZE
            const value = 0.8 * (smoothed[i] ?? 0) + 0.2 * magnitude
            const finiteValue = Number.isFinite(value) ? value : 0
            smoothed[i] = finiteValue
            bytes[i] = Math.max(0, Math.min(255, ((20 * Math.log10(finiteValue) + 100) / 70) * 255))
        }
        output.set(bytes)
    }
}
