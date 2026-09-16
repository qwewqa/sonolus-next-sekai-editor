import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSpectrumSampler, FFT_BINS, FFT_ONSET_BINS, FFT_SIZE } from '../../src/waveform/fft'

const sampleRate = 44100
const tone = (frequency: number, amplitude = 0.2, length = FFT_SIZE * 4) =>
    Float32Array.from(
        { length },
        (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate),
    )

const sample = (channels: readonly Float32Array[], frame = FFT_SIZE * 2, rate = sampleRate) => {
    const output = new Uint8Array(FFT_BINS)
    createSpectrumSampler(channels, rate)(frame, output)
    return output
}

const spectrum = (output: Uint8Array) => output.subarray(FFT_ONSET_BINS)
const energy = (output: Uint8Array) => spectrum(output).reduce((sum, value) => sum + value, 0)
const strongestBand = (output: Uint8Array) => {
    const bands = spectrum(output)
    return bands.indexOf(Math.max(...bands))
}

test('silence, missing channels, and windows outside the audio stay silent', () => {
    const silence = new Uint8Array(FFT_BINS)
    assert.deepEqual(sample([new Float32Array(FFT_SIZE * 4)]), silence)
    assert.deepEqual(sample([]), silence)
    assert.deepEqual(sample([new Float32Array()]), silence)
    assert.deepEqual(sample([tone(1000)], -FFT_SIZE), silence)
    assert.deepEqual(sample([tone(1000)], FFT_SIZE * 5), silence)
})

test('logarithmic bands distinguish bass, midrange, and treble at their expected frequencies', () => {
    const frequencies = [8, 32, 128].map((bin) => (bin * sampleRate) / FFT_SIZE)
    const peaks = frequencies.map((frequency) => {
        const output = sample([tone(frequency)])
        const peak = strongestBand(output)
        const expected =
            (Math.log(frequency / 50) / Math.log(16000 / 50)) * (FFT_BINS - FFT_ONSET_BINS - 1)
        assert.ok(energy(output) > 0, `tone ${frequency} Hz must remain visible`)
        assert.ok(Math.abs(peak - expected) <= 4, `tone ${frequency} Hz peaks in band ${peak}`)
        return peak
    })
    assert.ok(peaks[0]! < peaks[1]! && peaks[1]! < peaks[2]!)
    assert.ok(Math.abs(peaks[1]! - peaks[0]! - (peaks[2]! - peaks[1]!)) <= 3)
})

test('frequency placement follows the decoded sample rate', () => {
    const rate = 48000
    const frequency = 1500
    const input = Float32Array.from(
        { length: FFT_SIZE * 4 },
        (_, i) => 0.2 * Math.sin((2 * Math.PI * frequency * i) / rate),
    )
    const at48k = strongestBand(sample([input], FFT_SIZE * 2, rate))
    const at44k = strongestBand(sample([tone(frequency)]))
    assert.ok(Math.abs(at48k - at44k) <= 1)
})

test('low sample rates limit the frequency display to Nyquist', () => {
    const rate = 8000
    const frequency = 2000
    const input = Float32Array.from(
        { length: FFT_SIZE * 4 },
        (_, i) => 0.2 * Math.sin((2 * Math.PI * frequency * i) / rate),
    )
    const peak = strongestBand(sample([input], FFT_SIZE * 2, rate))
    const expected =
        (Math.log(frequency / 50) / Math.log(rate / 2 / 50)) * (FFT_BINS - FFT_ONSET_BINS - 1)
    assert.ok(Math.abs(peak - expected) <= 2)
})

test('an isolated impulse is centered on its time without a trailing smoothing history', () => {
    const input = new Float32Array(FFT_SIZE * 4)
    const center = FFT_SIZE * 2
    input[center] = 1
    const peak = sample([input], center)
    assert.ok(energy(peak) > 0)
    assert.ok(energy(peak) > energy(sample([input], center - FFT_SIZE / 4)))
    assert.ok(energy(peak) > energy(sample([input], center + FFT_SIZE / 4)))
    assert.deepEqual(sample([input], center - FFT_SIZE), new Uint8Array(FFT_BINS))
    assert.deepEqual(sample([input], center + FFT_SIZE), new Uint8Array(FFT_BINS))

    const sampler = createSpectrumSampler([input], sampleRate)
    const output = new Uint8Array(FFT_BINS)
    sampler(center, output)
    assert.deepEqual(output, peak)
    sampler(center + FFT_SIZE, output)
    assert.deepEqual(output, new Uint8Array(FFT_BINS))
})

test('the amplitude strip preserves a narrow attack while frequency bands span the FFT window', () => {
    const input = new Float32Array(FFT_SIZE * 4)
    const center = FFT_SIZE * 2
    input[center] = 1
    const attack = sample([input], center)
    assert.ok(attack.subarray(0, FFT_ONSET_BINS).some((value) => value > 0))
    const nearby = sample([input], center + Math.round(sampleRate * 0.005))
    assert.deepEqual(nearby.subarray(0, FFT_ONSET_BINS), new Uint8Array(FFT_ONSET_BINS))
    assert.ok(energy(nearby) > 0)
})

test('a transient between the old disjoint 64-sample windows remains visible', () => {
    const input = new Float32Array(FFT_SIZE * 2)
    input[220] = 1
    // At 100 rows/second, old windows ending at frames 0 and 441 missed frame 220.
    assert.ok(energy(sample([input], 441)) > 0)
})

test('zero padding preserves transients at both ends of the audio', () => {
    const input = new Float32Array(FFT_SIZE * 2)
    input[0] = 1
    input[input.length - 1] = 1
    assert.ok(energy(sample([input], 0)) > 0)
    assert.ok(energy(sample([input], input.length - 1)) > 0)
})

test('opposite stereo phases retain the same spectral power as identical channels', () => {
    const input = tone((32 * sampleRate) / FFT_SIZE)
    const opposite = input.map((value) => -value)
    assert.deepEqual(sample([input, input]), sample([input]))
    assert.deepEqual(sample([input, opposite]), sample([input, input]))

    const leftOnly = sample([input, new Float32Array(input.length)])
    assert.ok(energy(leftOnly) > 0)
    assert.equal(strongestBand(leftOnly), strongestBand(sample([input])))
    assert.ok(energy(leftOnly) < energy(sample([input, input])))
})

// Independent scalar DFT: each real channel is transformed separately without
// complex packing, bit reversal, butterflies, or precomputed trigonometry.
const directMeanPower = (channels: readonly Float32Array[], center: number, bin: number) => {
    let total = 0
    for (const samples of channels) {
        let real = 0
        let imaginary = 0
        for (let i = 0; i < FFT_SIZE; i++) {
            const value =
                (samples[Math.round(center) - FFT_SIZE / 2 + i] ?? 0) *
                (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE))
            const angle = (2 * Math.PI * bin * i) / FFT_SIZE
            real += value * Math.cos(angle)
            imaginary -= value * Math.sin(angle)
        }
        total += real * real + imaginary * imaginary
    }
    return (total / channels.length) * (4 / FFT_SIZE) ** 2
}

const directBandByte = (channels: readonly Float32Array[], center: number, band: number) => {
    const interval = Math.log(16000 / 50) / (FFT_BINS - FFT_ONSET_BINS - 1)
    const frequency = 50 * Math.exp(interval * band)
    const low = frequency * Math.exp(-interval / 2)
    const high = frequency * Math.exp(interval / 2)
    const resolution = sampleRate / FFT_SIZE
    let power = 0
    if (high - low < resolution) {
        const position = frequency / resolution
        const first = Math.floor(position)
        const fraction = position - first
        power =
            directMeanPower(channels, center, first) * (1 - fraction) +
            directMeanPower(channels, center, first + 1) * fraction
    } else {
        // Integrate the raw-bin power density over the display band's frequency
        // interval; edge cells contribute only their intersecting width.
        for (let bin = 0; bin <= FFT_SIZE / 2; bin++) {
            const overlap =
                Math.min(high, (bin + 0.5) * resolution) - Math.max(low, (bin - 0.5) * resolution)
            if (overlap > 0) {
                power += (directMeanPower(channels, center, bin) * overlap) / (high - low)
            }
        }
    }
    return Math.floor(Math.max(0, Math.min(255, ((10 * Math.log10(power) + 72) / 60) * 255)))
}

test('packed channel transforms match an independent DFT for different stereo and odd channel inputs', () => {
    const signals = [
        (i: number) =>
            0.018 * Math.sin(0.0187 * i + 0.3) +
            0.025 * Math.cos(0.1489 * i - 0.2) +
            0.011 * Math.sin(0.799 * i + 0.7),
        (i: number) =>
            0.028 * Math.cos(0.0203 * i - 0.9) -
            0.009 * Math.sin(0.1581 * i + 0.3) +
            0.02 * Math.cos(0.781 * i - 0.6),
        (i: number) =>
            0.02 * Math.sin(0.0162 * i + 0.6) +
            0.012 * Math.cos(0.1402 * i + 0.8) +
            0.017 * Math.sin(0.761 * i + 0.1),
    ].map((signal) => Float32Array.from({ length: FFT_SIZE * 4 }, (_, i) => signal(i)))

    for (const count of [2, 3]) {
        const channels = signals.slice(0, count)
        for (const center of [FFT_SIZE * 1.25 + 0.25, FFT_SIZE * 2.75]) {
            const output = sample(channels, center)
            for (const band of [20, 65, 100]) {
                const expected = directBandByte(channels, center, band)
                assert.ok(expected > 0 && expected < 255, 'oracle must exercise unclipped power')
                assert.ok(
                    Math.abs(output[FFT_ONSET_BINS + band]! - expected) <= 1,
                    `${count} channels, center ${center}, band ${band}: expected ${expected}, received ${output[FFT_ONSET_BINS + band]}`,
                )
            }
        }
    }
})

test('frames are independent of traversal order and overwrite reused output bytes', () => {
    const input = tone((17 * sampleRate) / FFT_SIZE)
    input.fill(0, FFT_SIZE * 2)
    const sampler = createSpectrumSampler([input], sampleRate)
    const output = new Uint8Array(FFT_BINS)
    for (const frame of [FFT_SIZE, FFT_SIZE * 3, 0, FFT_SIZE * 2, FFT_SIZE, FFT_SIZE]) {
        output.fill(255)
        sampler(frame, output)
        assert.deepEqual(output, sample([input], frame), `frame ${frame}`)
    }
})

test('fractional sample positions retain the spectrum between decoded audio frames', () => {
    const input = tone((23 * sampleRate) / FFT_SIZE)
    const integerFrame = sample([input], FFT_SIZE * 2)
    const fractionalFrame = sample([input], FFT_SIZE * 2 + 0.25)
    assert.ok(energy(fractionalFrame) > 0)
    assert.equal(strongestBand(fractionalFrame), strongestBand(integerFrame))
})

test('nonfinite audio samples cannot poison neighboring valid samples', () => {
    const input = tone((19 * sampleRate) / FFT_SIZE)
    const sanitized = input.slice()
    for (const [offset, value] of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ].entries()) {
        input[FFT_SIZE * 2 + offset] = value
        sanitized[FFT_SIZE * 2 + offset] = 0
    }
    assert.deepEqual(sample([input]), sample([sanitized]))
    assert.ok(energy(sample([input])) > 0)
})
