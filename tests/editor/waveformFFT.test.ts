import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSpectrumSampler, FFT_BINS, FFT_SIZE } from '../../src/waveform/fft'

const tone = (bin: number, amplitude = 0.02, length = 2048) =>
    Float32Array.from(
        { length },
        (_, i) => amplitude * Math.sin((2 * Math.PI * bin * i) / FFT_SIZE),
    )

const sample = (channels: readonly Float32Array[], frame = 128) => {
    const output = new Uint8Array(FFT_BINS)
    createSpectrumSampler(channels)(frame, output)
    return output
}

// Independent direct DFT oracle: no bit reversal, butterfly or precomputed tables.
const directSpectrum = (samples: Float32Array, endFrame: number, previous: Float64Array) => {
    const result = new Uint8Array(FFT_BINS)
    for (let bin = 0; bin < FFT_BINS; bin++) {
        let real = 0
        let imaginary = 0
        for (let i = 0; i < FFT_SIZE; i++) {
            const phase = (2 * Math.PI * i) / FFT_SIZE
            const value =
                (samples[endFrame - FFT_SIZE + i] ?? 0) *
                (0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase))
            real += value * Math.cos(bin * phase)
            imaginary -= value * Math.sin(bin * phase)
        }
        const magnitude = Math.sqrt(real * real + imaginary * imaginary) / FFT_SIZE
        const smoothed = 0.8 * previous[bin]! + 0.2 * magnitude
        previous[bin] = smoothed
        result[bin] = Math.max(
            0,
            Math.min(255, Math.floor(((20 * Math.log10(smoothed) + 100) * 255) / 70)),
        )
    }
    return result
}

test('spectrum is silent for silence and before the first sample', () => {
    assert.deepEqual(sample([new Float32Array(2048)]), new Uint8Array(FFT_BINS))
    assert.deepEqual(sample([tone(7)], 0), new Uint8Array(FFT_BINS))
})

test('spectrum retains frequency information and matches a direct DFT across time', () => {
    const input = Float32Array.from(
        { length: 2048 },
        (_, i) => 0.018 * Math.sin(i * 0.571) + 0.004 * Math.cos(i * 1.283),
    )
    const sampler = createSpectrumSampler([input])
    const output = new Uint8Array(FFT_BINS)
    const previous = new Float64Array(FFT_BINS)
    for (const frame of [0, 5, 128, 512, 896, 1408, 2048, 2176]) {
        sampler(frame, output)
        const expected = directSpectrum(input, frame, previous)
        for (let bin = 0; bin < FFT_BINS; bin++) {
            assert.ok(Math.abs(output[bin]! - expected[bin]!) <= 1, `frame ${frame}, bin ${bin}`)
        }
    }
    const toneSpectrum = sample([tone(7)])
    assert.equal(toneSpectrum.indexOf(Math.max(...toneSpectrum)), 7)
    assert.ok(toneSpectrum[7]! > 0)
    assert.equal(toneSpectrum[20], 0)
})

test('stereo channels mix before FFT and opposite phases cancel', () => {
    const left = tone(5)
    const opposite = left.map((value) => -value)
    assert.deepEqual(sample([left, left]), sample([left]))
    assert.deepEqual(sample([left, opposite]), new Uint8Array(FFT_BINS))
    assert.deepEqual(
        sample([left, new Float32Array(left.length)]),
        sample([left.map((value) => value / 2)]),
    )
})

test('quad and surround speaker mixes retain their native channel weights', () => {
    const input = tone(9)
    const silence = new Float32Array(input.length)
    assert.deepEqual(sample([input, input, input, input]), sample([input]))
    assert.deepEqual(sample([silence, silence, input, silence, silence, silence]), sample([input]))
    assert.deepEqual(
        sample([silence, silence, silence, input, silence, silence]),
        new Uint8Array(FFT_BINS),
    )
    assert.deepEqual(sample([silence, silence, silence, silence, input, input]), sample([input]))
    const leftOnly = sample([input, silence, silence, silence, silence, silence])
    const expected = sample([input.map((value) => value * Math.SQRT1_2)])
    for (let i = 0; i < FFT_BINS; i++) assert.ok(Math.abs(leftOnly[i]! - expected[i]!) <= 1)
    assert.deepEqual(sample([input, silence, silence]), sample([input]))
})

test('repeated frames reuse bytes without advancing smoothing', () => {
    const input = tone(6, 0.005)
    const sampler = createSpectrumSampler([input])
    const output = new Uint8Array(FFT_BINS)
    sampler(128, output)
    const first = output.slice()
    output.fill(255)
    sampler(128, output)
    assert.deepEqual(output, first)
    sampler(256, output)
    assert.ok(output[6]! > first[6]!)

    const fresh = createSpectrumSampler([input])
    const expected = new Uint8Array(FFT_BINS)
    fresh(128, expected)
    fresh(256, expected)
    assert.deepEqual(output, expected)
})
