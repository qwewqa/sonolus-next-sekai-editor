export const FFT_SIZE = 1024
export const FFT_BINS = 128
export const FFT_ONSET_BINS = 4
export const FFT_FREQUENCY_BINS = FFT_BINS - FFT_ONSET_BINS
export const FFT_ROWS_PER_SECOND = 200

const spectrumSize = FFT_SIZE / 2 + 1
const window = Float64Array.from(
    { length: FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE),
)
const cosine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) =>
    Math.cos((-2 * Math.PI * i) / FFT_SIZE),
)
const sine = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) =>
    Math.sin((-2 * Math.PI * i) / FFT_SIZE),
)
const reversed = Uint16Array.from({ length: FFT_SIZE }, (_, i) => {
    let value = 0
    for (let bit = 0; bit < 10; bit++) {
        value = value * 2 + (i & 1)
        i >>= 1
    }
    return value
})

const createBands = (sampleRate: number) => {
    const maximum = Math.min(16000, sampleRate / 2)
    const minimum = Math.min(50, maximum)
    const ratio = (maximum / minimum) ** (1 / (FFT_FREQUENCY_BINS - 1))
    const scale = FFT_SIZE / sampleRate

    return Array.from({ length: FFT_FREQUENCY_BINS }, (_, i) => {
        const center = minimum * ratio ** i * scale
        const start = center / Math.sqrt(ratio)
        const end = Math.min(FFT_SIZE / 2, center * Math.sqrt(ratio))
        if (end - start < 1) {
            // Narrow display bands interpolate the available FFT bins. They do
            // not imply finer bass resolution than the analysis window allows.
            const min = Math.floor(center)
            const fraction = center - min
            return { min, weights: Float64Array.of(1 - fraction, fraction) }
        }

        const min = Math.max(0, Math.floor(start + 0.5))
        const max = Math.min(FFT_SIZE / 2, Math.floor(end + 0.5))
        const weights = Float64Array.from(
            { length: max - min + 1 },
            (_, j) =>
                Math.max(0, Math.min(end, min + j + 0.5) - Math.max(start, min + j - 0.5)) /
                (end - start),
        )
        return { min, weights }
    })
}

const toByte = (power: number, minimumDb: number, rangeDb: number) =>
    Math.max(0, Math.min(255, ((10 * Math.log10(power) - minimumDb) / rangeDb) * 255))

/**
 * Timing-oriented spectrum: centered Hann windows, logarithmic frequency bands,
 * and a separate 5 ms peak strip. Rows have no history-dependent smoothing or
 * automatic gain, so attacks stay aligned and quiet passages stay quiet.
 *
 * Stereo channels occupy the real and imaginary inputs of one complex FFT.
 * The paired positive/negative bins recover their combined power without phase
 * cancellation or the cost of a second transform. Other channels use more pairs.
 */
export const createSpectrumSampler = (channels: readonly Float32Array[], sampleRate: number) => {
    if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
        throw new RangeError('Invalid spectrum sample rate')
    }
    const bands = createBands(sampleRate)
    const real = new Float64Array(FFT_SIZE)
    const imaginary = new Float64Array(FFT_SIZE)
    const powers = new Float64Array(spectrumSize)
    // Hann coherent gain is N/2; normalize positive-frequency amplitudes by 4/N.
    const normalization = (4 / FFT_SIZE) ** 2 / Math.max(1, channels.length)
    const onsetHalf = sampleRate / (FFT_ROWS_PER_SECOND * 2)

    return (centerFrame: number, output: Uint8Array): void => {
        powers.fill(0)
        const start = Math.round(centerFrame) - FFT_SIZE / 2
        for (let channel = 0; channel < channels.length; channel += 2) {
            const left = channels[channel]
            const right = channels[channel + 1]
            for (let i = 0; i < FFT_SIZE; i++) {
                const index = reversed[i] ?? 0
                const a = left?.[start + i] ?? 0
                const b = right?.[start + i] ?? 0
                real[index] = Number.isFinite(a) ? a * (window[i] ?? 0) : 0
                imaginary[index] = Number.isFinite(b) ? b * (window[i] ?? 0) : 0
            }

            for (let length = 2; length <= FFT_SIZE; length *= 2) {
                const half = length / 2
                const step = FFT_SIZE / length
                for (let first = 0; first < FFT_SIZE; first += length) {
                    for (let i = 0; i < half; i++) {
                        const even = first + i
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

            for (let i = 0; i < spectrumSize; i++) {
                const mirror = (FFT_SIZE - i) % FFT_SIZE
                const a = real[i] ?? 0
                const b = imaginary[i] ?? 0
                const c = real[mirror] ?? 0
                const d = imaginary[mirror] ?? 0
                powers[i] = (powers[i] ?? 0) + (a * a + b * b + c * c + d * d) * 0.5
            }
        }

        let peak = 0
        const onsetStart = Math.max(0, Math.round(centerFrame - onsetHalf))
        const onsetEnd = Math.round(centerFrame + onsetHalf)
        for (const samples of channels) {
            const end = Math.min(samples.length, onsetEnd)
            for (let frame = onsetStart; frame < end; frame++) {
                const value = Math.abs(samples[frame] ?? 0)
                if (Number.isFinite(value) && value > peak) peak = value
            }
        }
        output.fill(toByte(peak * peak, -54, 54), 0, FFT_ONSET_BINS)

        for (let i = 0; i < bands.length; i++) {
            const band = bands[i]
            if (!band) continue
            let power = 0
            for (let j = 0; j < band.weights.length; j++) {
                power += (powers[band.min + j] ?? 0) * (band.weights[j] ?? 0)
            }
            output[FFT_ONSET_BINS + i] = toByte(power * normalization, -72, 60)
        }
    }
}
