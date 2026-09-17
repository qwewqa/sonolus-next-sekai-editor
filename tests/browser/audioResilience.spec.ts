import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type ScheduledSource = {
    id: number
    bgm: boolean
    when: number
    offset: number
    rate: number
    contextTime: number
    performanceTime: number
}

declare global {
    interface Window {
        audioResilience: {
            context?: AudioContext
            player?: typeof import('../../src/editor/player')
            isPlaying?: () => boolean
            decoded: number
            starts: ScheduledSource[]
            stopped: number[]
            errors: string[]
            resumeRequestedAt?: number
            resumeResolvedAt?: number
        }
    }
}

// These tests intentionally use native audio and performance clocks. A mocked
// animation clock cannot reproduce an independently suspended audio context.
const settle = (page: Page) =>
    page.evaluate(async () => {
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        await window.editorTest.nextTick()
    })

const snapshot = (page: Page) =>
    page.evaluate(() => {
        const probe = window.audioResilience
        const context = probe.context!
        const bgm = probe.starts.filter((source) => source.bgm).at(-1)
        return {
            state: context.state,
            audioTime: context.currentTime,
            cursor: window.editorTest.view.cursorTime,
            audioPosition: bgm
                ? bgm.offset + Math.max(0, context.currentTime - bgm.when) * bgm.rate
                : 0,
            playing: probe.isPlaying!(),
            bgmStarts: probe.starts.filter((source) => source.bgm).length,
        }
    })

const delayResume = (page: Page) =>
    page.evaluate(async () => {
        const probe = window.audioResilience
        const context = probe.context!
        await context.suspend()
        const resume = context.resume.bind(context)
        context.resume = async () => {
            probe.resumeRequestedAt = performance.now()
            await new Promise((resolve) => setTimeout(resolve, 300))
            await resume()
            probe.resumeResolvedAt = performance.now()
        }
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        localStorage.setItem('sonolus-next-sekai-editor.playPreviewDuration', '0')
        const probe = (window.audioResilience = {
            decoded: 0,
            starts: [] as ScheduledSource[],
            stopped: [] as number[],
            errors: [] as string[],
            context: undefined as AudioContext | undefined,
        })
        window.AudioContext = new Proxy(AudioContext, {
            construct(target, args) {
                const context = Reflect.construct(target, args) as AudioContext
                probe.context = context
                return context
            },
        })
        const decode = AudioContext.prototype.decodeAudioData
        AudioContext.prototype.decodeAudioData = function (...args) {
            return (Reflect.apply(decode, this, args) as Promise<AudioBuffer>).then((buffer) => {
                probe.decoded++
                return buffer
            })
        }
        let nextId = 0
        const ids = new WeakMap<AudioBufferSourceNode, number>()
        const start = AudioBufferSourceNode.prototype.start
        AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
            const id = nextId++
            ids.set(this, id)
            probe.starts.push({
                id,
                bgm: this.buffer === window.editorTest?.history.state.value.bgm.buffer,
                when,
                offset,
                rate: this.playbackRate.value,
                contextTime: this.context.currentTime,
                performanceTime: performance.now(),
            })
            start.call(this, when, offset, duration)
        }
        const stop = AudioBufferSourceNode.prototype.stop
        AudioBufferSourceNode.prototype.stop = function (when) {
            const id = ids.get(this)
            if (id !== undefined) probe.stopped.push(id)
            stop.call(this, when)
        }
        window.addEventListener('error', (event) => probe.errors.push(event.message))
        window.addEventListener('unhandledrejection', (event) =>
            probe.errors.push(String(event.reason)),
        )
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.keyboard.press('Shift')
    await page.evaluate(installEditorFixture)
    await expect
        .poll(() => page.evaluate(() => window.audioResilience.decoded))
        .toBeGreaterThanOrEqual(10)
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const probe = window.audioResilience
        probe.player = (await import(
            urls.get('/src/editor/player.ts') ?? '/src/editor/player.ts'
        )) as typeof import('../../src/editor/player')
        const { isPlaying } = (await import(
            urls.get('/src/player.ts') ?? '/src/player.ts'
        )) as typeof import('../../src/player')
        probe.isPlaying = () => isPlaying.value
        const { settings, history, fixtures, show, view, nextTick } = window.editorTest
        settings.playPreviewDuration = 0
        settings.playFollow = false
        settings.playStartPosition = 'cursor'
        settings.waveform = 'off'
        const note = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                slides: Array.from({ length: 120 }, (_, index) => [
                    { ...note, beat: 0.8 + index * 0.1 },
                ]),
            },
            3,
        )
        history.replaceState({
            ...history.state.value,
            bgm: {
                offset: 0,
                buffer: new AudioBuffer({
                    length: 15 * 48000,
                    sampleRate: 48000,
                    numberOfChannels: 1,
                }),
            },
        })
        view.cursorTime = 0
        await nextTick()
        await probe.context!.resume()
        probe.starts = []
        probe.stopped = []
    })
})

test.afterEach(async ({ page }) => {
    const errors = await page.evaluate(() => {
        window.audioResilience.player?.stopPlayer(false)
        return window.audioResilience.errors
    })
    expect(errors, 'uncaught browser errors').toEqual([])
})

test('a delayed initial audio resume keeps the preview aligned with the BGM clock', async ({
    page,
}) => {
    await delayResume(page)
    await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
    await expect
        .poll(() => page.evaluate(() => window.audioResilience.resumeResolvedAt))
        .toBeDefined()
    const resumeTime = await page.evaluate(
        () => window.audioResilience.resumeResolvedAt! - window.audioResilience.resumeRequestedAt!,
    )
    expect(resumeTime).toBeGreaterThanOrEqual(290)
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(0.35)
    await settle(page)
    const current = await snapshot(page)
    expect(current.playing).toBe(true)
    expect(current.bgmStarts).toBe(1)
    expect(Math.abs(current.cursor - current.audioPosition)).toBeLessThan(0.06)
})

test('audio-only suspension freezes the preview and resumes without a BGM restart or clock jump', async ({
    page,
}) => {
    await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(0.3)
    await page.evaluate(() => window.audioResilience.context!.suspend())
    await settle(page)
    const suspended = await snapshot(page)
    await page.waitForTimeout(400)
    const waiting = await snapshot(page)
    expect(waiting.state).toBe('suspended')
    expect(waiting.playing).toBe(true)
    expect(waiting.audioTime).toBe(suspended.audioTime)
    expect(waiting.cursor).toBe(suspended.cursor)
    await page.evaluate(() => window.audioResilience.context!.resume())
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(waiting.cursor + 0.2)
    await settle(page)
    const resumed = await snapshot(page)
    expect(resumed.bgmStarts).toBe(1)
    expect(Math.abs(resumed.cursor - resumed.audioPosition)).toBeLessThan(0.06)
})

test('changing playback speed continues at the audio position without another startup gap', async ({
    page,
}) => {
    await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(0.4)
    const changed = await page.evaluate(() => {
        const probe = window.audioResilience
        const previous = probe.starts.find((source) => source.bgm)!
        probe.player!.changePlayerSpeed(1)
        const next = probe.starts.filter((source) => source.bgm).at(-1)!
        return { previous, next, stopped: probe.stopped }
    })
    expect(changed.next.id).not.toBe(changed.previous.id)
    expect(changed.next.rate).toBe(1.5)
    expect(changed.next.when - changed.next.contextTime).toBeLessThan(0.02)
    const continuousPosition =
        changed.previous.offset +
        (changed.next.when - changed.previous.when) * changed.previous.rate
    expect(Math.abs(changed.next.offset - continuousPosition)).toBeLessThan(0.02)
    expect(changed.stopped).toContain(changed.previous.id)
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(changed.next.offset + 0.2)
    await settle(page)
    const current = await snapshot(page)
    expect(current.bgmStarts).toBe(2)
    expect(Math.abs(current.cursor - current.audioPosition)).toBeLessThan(0.06)
})

for (const milliseconds of [500, 1200]) {
    test(`${milliseconds} ms main-thread stalls preserve queued audio and recover without expired cue bursts`, async ({
        page,
    }) => {
        await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
        await expect
            .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
            .toBeGreaterThan(0.5)
        const stall = await page.evaluate((milliseconds) => {
            const context = window.audioResilience.context!
            const started = performance.now()
            const audioStart = context.currentTime
            while (performance.now() - started < milliseconds) {
                /* Deliberately block only the main thread. */
            }
            return { audioStart, audioEnd: context.currentTime, performanceEnd: performance.now() }
        }, milliseconds)
        expect(stall.audioEnd - stall.audioStart).toBeGreaterThan(milliseconds / 1000 - 0.1)
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const { starts, context } = window.audioResilience
                    return starts.some(
                        (source) => !source.bgm && source.when > context!.currentTime + 0.3,
                    )
                }),
            )
            .toBe(true)
        await settle(page)
        const sources = await page.evaluate(() => ({
            starts: window.audioResilience.starts,
            stopped: window.audioResilience.stopped,
        }))
        const bgm = sources.starts.filter((source) => source.bgm)
        expect(bgm).toHaveLength(1)
        expect(sources.stopped).not.toContain(bgm[0]!.id)
        const cues = sources.starts.filter((source) => !source.bgm)
        const expected = Array.from(
            { length: 120 },
            (_, index) => bgm[0]!.when + 0.4 + index * 0.05,
        ).filter((when) => when > stall.audioStart + 0.075 && when < stall.audioEnd - 0.075)
        expect(expected.length).toBeGreaterThan(4)
        const missing = expected.filter(
            (when) => !cues.some((source) => Math.abs(source.when - when) < 0.00001),
        )
        if (milliseconds === 500) expect(missing).toEqual([])
        else expect(missing.length).toBeGreaterThan(0)
        for (const cue of cues.filter((source) => source.performanceTime >= stall.performanceEnd)) {
            expect(cue.when).toBeGreaterThanOrEqual(cue.contextTime - 0.005)
        }
        expect(new Set(cues.map((source) => source.when.toFixed(6))).size).toBe(cues.length)
        const current = await snapshot(page)
        expect(Math.abs(current.cursor - current.audioPosition)).toBeLessThan(0.06)
    })
}

test('pausing immediately after a stalled frame captures the audio position', async ({ page }) => {
    await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(0.3)
    const paused = await page.evaluate(() => {
        const probe = window.audioResilience
        const before = window.editorTest.view.cursorTime
        const started = performance.now()
        while (performance.now() - started < 500) {
            /* Pause before the next visual frame can catch up. */
        }
        const bgm = probe.starts.find((source) => source.bgm)!
        const audioPosition = bgm.offset + (probe.context!.currentTime - bgm.when) * bgm.rate
        probe.player!.togglePreviewPlayback()
        return { before, audioPosition, cursor: window.editorTest.view.cursorTime }
    })
    expect(paused.cursor).toBeGreaterThan(paused.before + 0.4)
    expect(Math.abs(paused.cursor - paused.audioPosition)).toBeLessThan(0.02)
    await page.waitForTimeout(300)
    const current = await snapshot(page)
    expect(current.playing).toBe(false)
    expect(current.cursor).toBe(paused.cursor)
})

test('backgrounding cancels an audition whose audio resume is still pending', async ({ page }) => {
    await delayResume(page)
    const source = await page.evaluate(async () => {
        const probe = window.audioResilience
        window.editorTest.settings.playPreviewDuration = 120
        probe.player!.stepPreviewTime(10)
        await window.editorTest.nextTick()
        return probe.starts[0]!
    })
    expect(source.bgm).toBe(true)
    await page.evaluate(() => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
        window.dispatchEvent(new Event('blur'))
    })
    await expect
        .poll(() => page.evaluate(() => window.audioResilience.resumeResolvedAt))
        .toBeDefined()
    await page.waitForTimeout(250)
    const result = await page.evaluate(() => ({
        starts: window.audioResilience.starts,
        stopped: window.audioResilience.stopped,
        cursor: window.editorTest.view.cursorTime,
    }))
    expect(result.starts).toHaveLength(1)
    expect(result.stopped).toContain(source.id)
    expect(result.cursor).toBe(0.01)
})

for (const action of ['pause', 'blur'] as const) {
    test(`${action} during pending resume cannot start late audio or advance the cursor`, async ({
        page,
    }) => {
        await delayResume(page)
        await page.evaluate(() => window.audioResilience.player!.togglePreviewPlayback())
        const stopped = await page.evaluate((action) => {
            const probe = window.audioResilience
            if (action === 'pause') probe.player!.stopPlayer(false)
            else {
                Object.defineProperty(document, 'hasFocus', {
                    configurable: true,
                    value: () => false,
                })
                window.dispatchEvent(new Event('blur'))
            }
            return { cursor: window.editorTest.view.cursorTime, sources: probe.starts.length }
        }, action)
        await expect
            .poll(() => page.evaluate(() => window.audioResilience.resumeResolvedAt))
            .toBeDefined()
        await page.waitForTimeout(400)
        const final = await snapshot(page)
        expect(final.playing).toBe(false)
        expect(final.cursor).toBe(stopped.cursor)
        const sources = await page.evaluate(() => ({
            starts: window.audioResilience.starts,
            stopped: window.audioResilience.stopped,
        }))
        expect(sources.starts).toHaveLength(stopped.sources)
        for (const source of sources.starts) expect(sources.stopped).toContain(source.id)
        if (action === 'blur') {
            await page.evaluate(() => {
                Reflect.deleteProperty(document, 'hasFocus')
                window.dispatchEvent(new Event('focus'))
            })
            await settle(page)
            expect((await snapshot(page)).playing).toBe(false)
        }
    })
}
