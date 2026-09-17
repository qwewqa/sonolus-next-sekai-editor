import { expect, test, type Page } from '@playwright/test'

type RenderOptions = {
    volume: number
    start: number
    duration?: number
    envelope?: { duration: number; attack?: number }
    fadeIn?: number
    changes?: { at?: number; volume: number }[]
    forceFallback?: boolean
    sampleTimes: number[]
    continuity?: { from: number; to: number }
}

const renderGain = (page: Page, options: RenderOptions) =>
    page.evaluate(async (options) => {
        const { createPlayerAudio } = await import('/src/playerAudio.ts')
        const sampleRate = 48000
        const context = new OfflineAudioContext(1, sampleRate / 10, sampleRate)
        // A constant signal makes the rendered PCM equal the applied gain, so
        // missing ramps and discontinuities are audible changes we can measure.
        const buffer = context.createBuffer(1, context.length, sampleRate)
        buffer.getChannelData(0).fill(1)
        const audio = createPlayerAudio(
            context as unknown as AudioContext,
            { buffer },
            options.volume,
            () => {},
        )
        if (options.forceFallback) {
            Object.defineProperty(audio.node.gain, 'cancelAndHoldAtTime', {
                configurable: true,
                value: undefined,
            })
        }
        if (options.fadeIn !== undefined) audio.fadeIn(options.start, options.fadeIn)
        if (options.duration === undefined) audio.start(options.start)
        else audio.start(options.start, 0, options.duration)
        if (options.envelope) {
            audio.envelope(options.start, options.envelope.duration, options.envelope.attack)
        }
        for (const change of options.changes ?? []) audio.setVolume(change.volume, change.at)

        const rendered = await context.startRendering()
        const samples = rendered.getChannelData(0)
        const first = Math.max(1, Math.round((options.continuity?.from ?? 0) * sampleRate))
        const last = Math.min(
            samples.length - 1,
            Math.round((options.continuity?.to ?? rendered.duration) * sampleRate),
        )
        let largestStep = 0
        for (let i = first; i <= last; i++) {
            largestStep = Math.max(largestStep, Math.abs(samples[i]! - samples[i - 1]!))
        }
        return {
            values: options.sampleTimes.map((time) => samples[Math.round(time * sampleRate)]!),
            largestStep,
        }
    }, options)

test.beforeEach(async ({ page }) => {
    // Exercise the production helper without unrelated editor/audio playback.
    await page.route('**/__player-audio-test', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }),
    )
    await page.goto('/__player-audio-test')
})

test('ordinary hit audio retains its original onset without an automatic attack', async ({
    page,
}) => {
    const { values } = await renderGain(page, {
        volume: 80,
        start: 0.01,
        duration: 0.03,
        sampleTimes: [0.009, 0.01, 0.011, 0.02, 0.039, 0.04],
    })
    for (const [i, expected] of [0, 0.8, 0.8, 0.8, 0.8, 0].entries()) {
        expect(values[i]).toBeCloseTo(expected, 4)
    }
})

test('an explicit fade-in reaches full volume smoothly in five milliseconds', async ({ page }) => {
    const { values, largestStep } = await renderGain(page, {
        volume: 80,
        start: 0.01,
        duration: 0.03,
        fadeIn: 0.005,
        sampleTimes: [0.009, 0.01, 0.0125, 0.015, 0.025, 0.04],
        continuity: { from: 0.009, to: 0.025 },
    })
    for (const [i, expected] of [0, 0, 0.4, 0.8, 0.8, 0].entries()) {
        expect(values[i]).toBeCloseTo(expected, 4)
    }
    expect(largestStep).toBeLessThan(0.8 / (0.005 * 48000) + 0.00001)
})

test('muting and unmuting during preroll preserves the scheduled fade-in', async ({ page }) => {
    const { values, largestStep } = await renderGain(page, {
        volume: 80,
        start: 0.05,
        fadeIn: 0.005,
        // Both changes happen at currentTime=0, before the scheduled source
        // starts. Its attack must survive and reach the latest requested gain.
        changes: [{ volume: 0 }, { volume: 60 }],
        sampleTimes: [0.049, 0.05, 0.0525, 0.055, 0.07],
        continuity: { from: 0.049, to: 0.07 },
    })
    for (const [i, expected] of [0, 0, 0.3, 0.6, 0.6].entries()) {
        expect(values[i]).toBeCloseTo(expected, 4)
    }
    expect(largestStep).toBeLessThan(0.6 / (0.005 * 48000) + 0.00001)
})

for (const [name, duration, attack] of [
    ['normal', 0.04, 0.003],
    ['shorter than the attack', 0.002, 0.001],
] as const) {
    test(`${name} auditions fade from silence through their peak back to silence`, async ({
        page,
    }) => {
        const start = 0.02
        const { values, largestStep } = await renderGain(page, {
            volume: 80,
            start,
            duration,
            envelope: { duration },
            sampleTimes: [
                start - 0.001,
                start,
                start + attack / 2,
                start + attack,
                start + attack + (duration - attack) / 2,
                start + duration,
                start + duration + 0.001,
            ],
        })
        for (const [i, expected] of [0, 0, 0.4, 0.8, 0.4, 0, 0].entries()) {
            expect(values[i]).toBeCloseTo(expected, 4)
        }
        // Both boundaries must remain smooth, including a shortened attack
        // whose decay still finishes before the source's duration expires.
        expect(largestStep).toBeLessThan(0.8 / (attack * 48000) + 0.00001)
    })
}

for (const forceFallback of [false, true]) {
    test(`future volume replacements preserve ramps and mute smoothly (${forceFallback ? 'without cancelAndHoldAtTime' : 'standard AudioParam'})`, async ({
        page,
    }) => {
        const sampleTimes = [0.009, 0.011, 0.012, 0.013, 0.014, 0.0165, 0.019, 0.0245, 0.027]
        const { values, largestStep } = await renderGain(page, {
            volume: 20,
            start: 0,
            forceFallback,
            // Replace a rising ramp, then its replacement while falling. These
            // are scheduled before rendering, so the earlier ramp must survive
            // up to each replacement's time as well as remain continuous there.
            changes: [
                { at: 0.01, volume: 100 },
                { at: 0.012, volume: 40 },
                { at: 0.014, volume: 80 },
                { at: 0.022, volume: 0 },
            ],
            sampleTimes,
            continuity: { from: 0.009, to: 0.03 },
        })
        for (const [i, expected] of [0.2, 0.36, 0.52, 0.496, 0.472, 0.636, 0.8, 0.4, 0].entries()) {
            expect(values[i], `gain at ${sampleTimes[i]} seconds`).toBeCloseTo(expected, 4)
        }
        expect(largestStep).toBeLessThan(0.8 / (0.005 * 48000) + 0.00001)
    })
}
