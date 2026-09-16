import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type AudioStart = { id: number; offset: number; duration?: number; rate: number; bgm: boolean }

declare global {
    interface Window {
        previewTransport: {
            player: typeof import('../../src/editor/player')
            audition: typeof import('../../src/editor/audioPreview')
            isPlaying: () => boolean
            starts: AudioStart[]
            stops: number[]
            errors: string[]
        }
    }
}

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const continuousStarts = (page: Page) =>
    page.evaluate(() =>
        window.previewTransport.starts.filter((start) => start.bgm && start.duration === undefined),
    )

test.beforeEach(async ({ page }, testInfo) => {
    const usesClock = testInfo.titlePath.includes('preview follow')
    if (usesClock) await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.keyboard.press('Shift')
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const player = (await import(
            urls.get('/src/editor/player.ts') ?? '/src/editor/player.ts'
        )) as typeof import('../../src/editor/player')
        const audition = (await import(
            urls.get('/src/editor/audioPreview.ts') ?? '/src/editor/audioPreview.ts'
        )) as typeof import('../../src/editor/audioPreview')
        const { isPlaying } = (await import(
            urls.get('/src/player.ts') ?? '/src/player.ts'
        )) as typeof import('../../src/player')
        window.previewTransport = {
            player,
            audition,
            isPlaying: () => isPlaying.value,
            starts: [],
            stops: [],
            errors: [],
        }
        window.addEventListener('error', (event) =>
            window.previewTransport.errors.push(event.message),
        )
        window.addEventListener('unhandledrejection', (event) =>
            window.previewTransport.errors.push(String(event.reason)),
        )
        let nextId = 0
        const ids = new WeakMap<AudioBufferSourceNode, number>()
        const start = AudioBufferSourceNode.prototype.start
        AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
            const id = nextId++
            ids.set(this, id)
            window.previewTransport.starts.push({
                id,
                offset,
                duration,
                rate: this.playbackRate.value,
                bgm: this.buffer === window.editorTest.history.state.value.bgm.buffer,
            })
            start.call(this, when, offset, duration)
        }
        const stop = AudioBufferSourceNode.prototype.stop
        AudioBufferSourceNode.prototype.stop = function (when) {
            const id = ids.get(this)
            if (id !== undefined) window.previewTransport.stops.push(id)
            stop.call(this, when)
        }
        const { history, settings } = window.editorTest
        settings.playStartPosition = 'view'
        settings.playFollow = false
        settings.playPreviewDuration = 120
        settings.waveform = 'off'
        const selected = [...window.editorTest.store.getAllEntities()].find(
            (entity) => entity.type === 'note' && entity.beat === 5,
        )!
        history.replaceState({
            ...history.state.value,
            selectedEntities: [selected],
            bgm: {
                offset: 0.25,
                buffer: new AudioBuffer({
                    length: 30 * 8000,
                    sampleRate: 8000,
                    numberOfChannels: 1,
                }),
            },
        })
    })
    await settle(page)
    await page.evaluate(() => {
        window.previewTransport.starts = []
        window.previewTransport.stops = []
    })
    if (usesClock) await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'))
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.previewTransport.errors)).toEqual([])
})

test('all fine-step deltas preserve sub-millisecond position and chart selection', async ({
    page,
}) => {
    const results = await page.evaluate(async () => {
        const { history, nextTick, view } = window.editorTest
        const { player } = window.previewTransport
        const original = history.state.value
        const samples = []
        for (const milliseconds of [-100, -10, -1, 1, 10, 100]) {
            view.cursorTime = 3.123456
            await nextTick()
            window.previewTransport.starts = []
            view.scrollingY = { type: 'inertia', value: 240 }
            const viewport = view.time
            player.stepPreviewTime(milliseconds)
            await nextTick()
            samples.push({
                milliseconds,
                cursor: view.cursorTime,
                viewport,
                currentViewport: view.time,
                scrolling: view.scrollingY,
                sameState: history.state.value === original,
                starts: window.previewTransport.starts.filter((start) => start.bgm),
            })
        }
        view.cursorTime = 0.000456
        player.stepPreviewTime(-1)
        const clamped = view.cursorTime
        player.stepPreviewTime(-100)
        const clampedAgain = view.cursorTime
        player.stepPreviewTime(1)
        return { samples, clamped, clampedAgain, afterZero: view.cursorTime }
    })
    for (const sample of results.samples) {
        const expected = 3.123456 + sample.milliseconds / 1000
        expect(sample.cursor).toBe(expected)
        expect(sample.currentViewport).toBe(sample.viewport)
        expect(sample.scrolling).toBeUndefined()
        expect(sample.sameState).toBe(true)
        expect(sample.starts).toHaveLength(1)
        expect(sample.starts[0]!.offset).toBe(expected + 0.25)
        expect(sample.starts[0]!.duration).toBe(0.12)
    }
    expect(results.clamped).toBe(0)
    expect(results.clampedAgain).toBe(0)
    expect(results.afterZero).toBe(0.001)
})

test('clamped steps replace old auditions without replaying queued cursor or note updates', async ({
    page,
}) => {
    const results = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        const { view, nextTick } = window.editorTest
        view.cursorTime = 0
        await nextTick()

        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(8)
        await nextTick()
        const previous = window.previewTransport.starts.at(-1)!
        window.previewTransport.starts = []
        player.stepPreviewTime(-1)
        await nextTick()
        const existing = {
            stopped: window.previewTransport.stops.includes(previous.id),
            starts: [...window.previewTransport.starts],
        }

        window.previewTransport.starts = []
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(12)
        player.stepPreviewTime(-10)
        await nextTick()
        const queuedNote = [...window.previewTransport.starts]

        view.cursorTime = 3
        await nextTick()
        window.previewTransport.starts = []
        view.cursorTime = 0
        player.stepPreviewTime(-100)
        await nextTick()
        return {
            existing,
            queuedNote,
            queuedCursor: window.previewTransport.starts,
            cursor: view.cursorTime,
        }
    })
    expect(results.existing.stopped).toBe(true)
    expect(results.cursor).toBe(0)
    for (const starts of [results.existing.starts, results.queuedNote, results.queuedCursor]) {
        expect(starts).toHaveLength(1)
        expect(starts[0]!.bgm).toBe(true)
        expect(starts[0]!.offset).toBe(0.25)
        expect(starts[0]!.duration).toBe(0.12)
    }
})

test('stepping pauses at the displayed cursor and overrides a queued note audition', async ({
    page,
}) => {
    await page.evaluate(async () => {
        window.editorTest.view.cursorTime = 3.333333
        await window.editorTest.nextTick()
        window.previewTransport.player.togglePreviewPlayback()
    })
    await expect
        .poll(() => page.evaluate(() => window.editorTest.view.cursorTime))
        .toBeGreaterThan(3.35)
    const playing = (await continuousStarts(page))[0]!
    const stopped = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        const { view, history, nextTick } = window.editorTest
        const state = history.state.value
        const before = view.cursorTime
        window.previewTransport.starts = []
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(12)
        player.stepPreviewTime(10)
        await nextTick()
        return {
            before,
            cursor: view.cursorTime,
            sameState: history.state.value === state,
            playing: window.previewTransport.isPlaying(),
            starts: window.previewTransport.starts.filter((start) => start.bgm),
            stops: window.previewTransport.stops,
        }
    })
    expect(stopped.cursor).toBe(stopped.before + 0.01)
    expect(stopped.sameState).toBe(true)
    expect(stopped.playing).toBe(false)
    expect(stopped.stops).toContain(playing.id)
    expect(stopped.starts).toHaveLength(1)
    expect(stopped.starts[0]!.offset).toBe(stopped.cursor + 0.25)
    expect(stopped.starts[0]!.duration).toBe(0.12)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(stopped.cursor)
    expect(
        await page.evaluate(() => window.previewTransport.starts.filter((start) => start.bgm)),
    ).toEqual(stopped.starts)
})

test('preview starts at its cursor while Space still honors the global start preference', async ({
    page,
}) => {
    const initial = await page.evaluate(async () => {
        const { view, settings, nextTick } = window.editorTest
        view.time = 6
        view.cursorTime = 2.345678
        await nextTick()
        window.previewTransport.starts = []
        window.previewTransport.player.togglePreviewPlayback()
        return {
            expectedPreview: view.cursorTime + 0.25,
            expectedView: Math.max(0, view.time - view.h / (2 * settings.pps)) + 0.25,
            preference: settings.playStartPosition,
        }
    })
    expect(initial.preference).toBe('view')
    expect((await continuousStarts(page)).map((start) => start.offset)).toEqual([
        initial.expectedPreview,
    ])
    await page.evaluate(() => window.previewTransport.player.togglePreviewPlayback())
    expect(await page.evaluate(() => window.previewTransport.isPlaying())).toBe(false)
    await page.keyboard.press('Space')
    expect((await continuousStarts(page)).at(-1)!.offset).toBe(initial.expectedView)
    await page.keyboard.press('Space')
    await page.evaluate(async () => {
        window.editorTest.settings.playStartPosition = 'cursor'
        window.editorTest.view.cursorTime = 5.765432
        await window.editorTest.nextTick()
    })
    await page.keyboard.press('Space')
    expect((await continuousStarts(page)).at(-1)!.offset).toBe(5.765432 + 0.25)
    await page.keyboard.press('Space')
})

test('preview playback shares speed changes and stop-return bookkeeping', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { view, nextTick } = window.editorTest
        const { player } = window.previewTransport
        view.cursorTime = 4.234567
        await nextTick()
        window.previewTransport.starts = []
        player.changePlayerSpeed(-1)
        player.togglePreviewPlayback()
        player.changePlayerSpeed(-1)
        player.stopPlayer(true)
        const returned = view.cursorTime
        player.togglePreviewPlayback()
        player.togglePreviewPlayback()
        return {
            returned,
            starts: window.previewTransport.starts.filter(
                (start) => start.bgm && start.duration === undefined,
            ),
            stops: window.previewTransport.stops,
            playing: window.previewTransport.isPlaying(),
        }
    })
    expect(result.returned).toBe(4.234567)
    expect(result.starts.map((start) => start.rate)).toEqual([0.75, 0.5, 0.5])
    expect(result.starts.map((start) => start.offset)).toEqual(Array(3).fill(4.234567 + 0.25))
    expect(result.starts.every((start) => result.stops.includes(start.id))).toBe(true)
    expect(result.playing).toBe(false)
})

test('preview pause drops queued auditions while later note clicks still audition', async ({
    page,
}) => {
    const paused = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        const { view, nextTick } = window.editorTest
        player.togglePreviewPlayback()
        window.previewTransport.starts = []
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(8)
        view.cursorTime = 3.2
        player.togglePreviewPlayback()
        await nextTick()
        return {
            playing: window.previewTransport.isPlaying(),
            starts: window.previewTransport.starts,
        }
    })
    expect(paused).toEqual({ playing: false, starts: [] })
    const point = await page.evaluate(() => window.editorTest.point(-3, 3))
    await page.mouse.click(point.x, point.y)
    await settle(page)
    const starts = await page.evaluate(() =>
        window.previewTransport.starts.filter((start) => start.bgm),
    )
    expect(starts).toHaveLength(1)
    expect(starts[0]!.offset).toBe(1.75)
    expect(starts[0]!.duration).toBe(0.12)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(3.2)
})

test('starting preview playback suppresses a queued audition without duplicating audio', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(9)
        player.togglePreviewPlayback()
        await window.editorTest.nextTick()
        return {
            playing: window.previewTransport.isPlaying(),
            starts: window.previewTransport.starts.filter((start) => start.bgm),
        }
    })
    expect(result.playing).toBe(true)
    expect(result.starts).toHaveLength(1)
    expect(result.starts[0]!.offset).toBe(3.25)
    expect(result.starts[0]!.duration).toBeUndefined()
})

test('continuous preview scrubbing stops the tap audition and stays silent until release', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        const { view, history, nextTick } = window.editorTest
        const state = history.state.value
        player.stepPreviewTime(10)
        await nextTick()
        const tap = window.previewTransport.starts.find((start) => start.bgm)!
        const initial = view.cursorTime
        player.beginPreviewScrub()
        window.previewTransport.starts = []
        for (let frame = 1; frame <= 24; frame++) {
            player.scrubPreviewTo(initial + frame / 100)
            await nextTick()
        }
        const during = window.previewTransport.starts.length
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(18)
        player.scrubPreviewTo(initial + 0.250456)
        const released = view.cursorTime
        // End in the same task as the final position change: its queued watcher
        // must not replay either the obsolete note or a second release snippet.
        player.endPreviewScrub()
        player.endPreviewScrub()
        player.scrubPreviewTo(20)
        await nextTick()
        return {
            during,
            released,
            cursor: view.cursorTime,
            sameState: history.state.value === state,
            playing: window.previewTransport.isPlaying(),
            tapStopped: window.previewTransport.stops.includes(tap.id),
            starts: window.previewTransport.starts.filter((start) => start.bgm),
        }
    })
    expect(result.during).toBe(0)
    expect(result.tapStopped).toBe(true)
    expect(result.cursor).toBe(result.released)
    expect(result.cursor).toBe(3.01 + 0.250456)
    expect(result.sameState).toBe(true)
    expect(result.playing).toBe(false)
    expect(result.starts).toHaveLength(1)
    expect(result.starts[0]!.offset).toBe(result.cursor + 0.25)
    expect(result.starts[0]!.duration).toBe(0.12)
})

test('cancelling a preview scrub stops playback and leaves no queued audio or cursor updates', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { player, audition } = window.previewTransport
        player.togglePreviewPlayback()
        const continuous = window.previewTransport.starts.find(
            (start) => start.bgm && start.duration === undefined,
        )!
        player.beginPreviewScrub()
        window.previewTransport.starts = []
        audition.beginAudioPreviewInteraction()
        audition.requestAudioPreview(18)
        player.scrubPreviewTo(-1)
        player.endPreviewScrub(false)
        player.scrubPreviewTo(20)
        await window.editorTest.nextTick()
        return {
            cursor: window.editorTest.view.cursorTime,
            starts: window.previewTransport.starts,
            stopped: window.previewTransport.stops.includes(continuous.id),
            playing: window.previewTransport.isPlaying(),
        }
    })
    expect(result).toEqual({ cursor: 0, starts: [], stopped: true, playing: false })
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(0)
    expect(await page.evaluate(() => window.previewTransport.starts)).toEqual([])
})

test('toolbar playback and exact stepping can take over an active preview scrub', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { player } = window.previewTransport
        const { view, settings, nextTick } = window.editorTest
        player.beginPreviewScrub()
        player.scrubPreviewTo(3.654321)
        settings.playStartPosition = 'cursor'
        player.startOrStopPlayer()
        player.scrubPreviewTo(20)
        const afterStart = view.cursorTime
        const playing = window.previewTransport.isPlaying()
        player.beginPreviewScrub()
        player.scrubPreviewTo(4.654321)
        player.stepPreviewTime(-1)
        player.scrubPreviewTo(25)
        await nextTick()
        return {
            afterStart,
            playing,
            afterStep: view.cursorTime,
            playingAfterStep: window.previewTransport.isPlaying(),
        }
    })
    expect(result.afterStart).toBe(3.654321)
    expect(result.playing).toBe(true)
    expect(result.afterStep).toBe(4.654321 - 0.001)
    expect(result.playingAfterStep).toBe(false)
})

test.describe('preview follow', () => {
    for (const [position, pps] of [
        [20, 120],
        [50, 240],
        [80, 100],
    ] as const) {
        test(`steps smoothly align to follow position ${position} at ${pps} pixels per second`, async ({
            page,
        }) => {
            const initial = await page.evaluate(
                ({ position, pps }) => {
                    const { view, settings, history } = window.editorTest
                    settings.playFollow = true
                    settings.playFollowPosition = position
                    settings.pps = pps
                    view.time = 4
                    view.cursorTime = 8.123456
                    const state = history.state.value
                    window.previewTransport.player.stepPreviewTime(10)
                    return {
                        cursor: view.cursorTime,
                        viewport: view.time,
                        sameState: history.state.value === state,
                        target: Math.max(
                            0,
                            view.cursorTime + ((0.5 - position / 100) * view.h) / pps,
                        ),
                    }
                },
                { position, pps },
            )
            expect(initial.cursor).toBe(8.123456 + 0.01)
            expect(initial.viewport).toBe(4)
            expect(initial.sameState).toBe(true)
            await page.clock.runFor(96)
            const intermediate = await page.evaluate(() => window.editorTest.view.time)
            expect(intermediate).toBeGreaterThan(Math.min(4, initial.target))
            expect(intermediate).toBeLessThan(Math.max(4, initial.target))
            await page.clock.runFor(200)
            const settled = await page.evaluate(() => {
                const { view, settings } = window.editorTest
                return {
                    cursor: view.cursorTime,
                    viewport: view.time,
                    scrolling: view.scrollingY,
                    position: 0.5 + ((view.cursorTime - view.time) * settings.pps) / view.h,
                }
            })
            expect(settled.cursor).toBe(initial.cursor)
            expect(settled.viewport).toBeCloseTo(initial.target, 9)
            expect(settled.position).toBeCloseTo(position / 100, 9)
            expect(settled.scrolling).toBeUndefined()
        })
    }

    test('scrub updates retarget from the current viewport and finish aligning after release', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 50
            view.time = 4
            view.cursorTime = 4
            window.previewTransport.player.beginPreviewScrub()
            window.previewTransport.player.scrubPreviewTo(8)
        })
        await page.clock.runFor(80)
        const retargeted = await page.evaluate(() => {
            const { view } = window.editorTest
            const before = view.time
            window.previewTransport.player.scrubPreviewTo(10)
            return { before, after: view.time, cursor: view.cursorTime }
        })
        expect(retargeted.before).toBeGreaterThan(4)
        expect(retargeted.before).toBeLessThan(8)
        expect(retargeted.after).toBe(retargeted.before)
        expect(retargeted.cursor).toBe(10)
        await page.clock.runFor(64)
        const released = await page.evaluate(() => {
            const { view } = window.editorTest
            const before = view.time
            window.previewTransport.player.scrubPreviewTo(3)
            window.previewTransport.player.endPreviewScrub(false)
            return { before, after: view.time, cursor: view.cursorTime }
        })
        expect(released.before).toBeGreaterThan(retargeted.before)
        expect(released.before).toBeLessThan(10)
        expect(released.after).toBe(released.before)
        expect(released.cursor).toBe(3)
        await page.clock.runFor(80)
        const returning = await page.evaluate(() => window.editorTest.view.time)
        expect(returning).toBeGreaterThan(3)
        expect(returning).toBeLessThan(released.before)
        await page.clock.runFor(200)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(3)
        expect(await page.evaluate(() => window.editorTest.view.scrollingY)).toBeUndefined()
    })

    test('clamped scrubbing still follows without repeatedly restarting the same animation', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 100
            view.time = 8
            view.cursorTime = 0
            window.previewTransport.player.beginPreviewScrub()
            window.previewTransport.player.scrubPreviewTo(-1)
        })
        for (let frame = 0; frame < 20; frame++) {
            await page.clock.runFor(16)
            await page.evaluate(() => window.previewTransport.player.scrubPreviewTo(-1))
        }
        expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(0)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(0)
        expect(await page.evaluate(() => window.editorTest.view.scrollingY)).toBeUndefined()
        await page.evaluate(() => window.previewTransport.player.endPreviewScrub(false))
    })

    test('follow off preserves the viewport until a seek leaves the visible range', async ({
        page,
    }) => {
        const initial = await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = false
            view.time = 4
            view.cursorTime = 4
            window.previewTransport.player.stepPreviewTime(100)
            return { cursor: view.cursorTime, viewport: view.time, scrolling: view.scrollingY }
        })
        expect(initial).toEqual({ cursor: 4.1, viewport: 4, scrolling: undefined })
        await page.clock.runFor(300)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(4)
        const offscreen = await page.evaluate(() => {
            window.previewTransport.player.beginPreviewScrub('locked')
            window.previewTransport.player.scrubPreviewTo(20)
            window.previewTransport.player.endPreviewScrub(false)
            return {
                cursor: window.editorTest.view.cursorTime,
                viewport: window.editorTest.view.time,
            }
        })
        expect(offscreen).toEqual({ cursor: 20, viewport: 4 })
        await page.clock.runFor(300)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(20)
    })

    test('manual vertical wheel input takes over follow easing on either wheel axis', async ({
        page,
    }) => {
        for (const shiftKey of [false, true]) {
            await page.evaluate(() => {
                const { view, settings } = window.editorTest
                settings.playFollow = true
                settings.playFollowPosition = 50
                settings.mouseSmoothScrolling = false
                view.time = 4
                view.cursorTime = 8
                window.previewTransport.player.stepPreviewTime(10)
            })
            await page.clock.runFor(64)
            const before = await page.evaluate(() => window.editorTest.view.time)
            await page.locator('canvas.editor-chart').dispatchEvent('wheel', {
                deltaX: shiftKey ? 120 : 0,
                deltaY: shiftKey ? 0 : 120,
                shiftKey,
                deltaMode: 0,
            })
            const panned = await page.evaluate(() => window.editorTest.view.time)
            expect(panned).toBeCloseTo(before - 1, 9)
            expect(await page.evaluate(() => window.editorTest.view.scrollingY)).toBeUndefined()
            await page.clock.runFor(400)
            expect(await page.evaluate(() => window.editorTest.view.time)).toBe(panned)
        }
    })

    test('horizontal wheel and zoom leave follow easing intact, while smooth pans retain accumulation', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 50
            settings.mouseSmoothScrolling = true
            view.time = 4
            view.cursorTime = 8
            window.previewTransport.player.stepPreviewTime(10)
        })
        await page.locator('canvas.editor-chart').dispatchEvent('wheel', { deltaX: 120, deltaY: 0 })
        await page.locator('canvas.editor-chart').dispatchEvent('wheel', {
            deltaY: 120,
            ctrlKey: true,
        })
        await page.clock.runFor(300)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(8.01)

        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.pps = 120
            settings.mouseSmoothScrolling = true
            view.time = 4
            view.cursorTime = 8
            window.previewTransport.player.stepPreviewTime(10)
        })
        for (let event = 0; event < 3; event++) {
            await page
                .locator('canvas.editor-chart')
                .dispatchEvent('wheel', { deltaX: 120, deltaY: 0 })
            await page.locator('canvas.editor-chart').dispatchEvent('wheel', { deltaY: 120 })
        }
        await page.clock.runFor(300)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(1)
    })

    test('both playback entry points take over follow easing without competing after pausing', async ({
        page,
    }) => {
        for (const toolbar of [false, true]) {
            await page.evaluate(() => {
                const { view, settings } = window.editorTest
                settings.playFollow = true
                settings.playFollowPosition = 50
                settings.playStartPosition = 'cursor'
                view.time = 4
                view.cursorTime = 8
                window.previewTransport.player.stepPreviewTime(10)
            })
            await page.clock.runFor(64)
            await page.evaluate((toolbar) => {
                const { player } = window.previewTransport
                if (toolbar) player.startOrStopPlayer()
                else player.togglePreviewPlayback()
            }, toolbar)
            expect(await page.evaluate(() => window.editorTest.view.scrollingY)).toBeUndefined()
            await page.clock.runFor(16)
            const paused = await page.evaluate(() => {
                window.previewTransport.player.stopPlayer(false)
                return {
                    cursor: window.editorTest.view.cursorTime,
                    viewport: window.editorTest.view.time,
                }
            })
            expect(paused.viewport).toBe(paused.cursor)
            await page.clock.runFor(400)
            expect(await page.evaluate(() => window.editorTest.view.time)).toBe(paused.viewport)
        }
        expect(
            await page.evaluate(() => {
                const { view, settings } = window.editorTest
                settings.playFollow = false
                const scrolling = { type: 'inertia' as const, value: 120 }
                view.scrollingY = scrolling
                window.previewTransport.player.startOrStopPlayer()
                const keptManualScroll = view.scrollingY === scrolling
                window.previewTransport.player.stopPlayer(false)
                view.scrollingY = undefined
                return keptManualScroll
            }),
        ).toBe(true)
    })

    test('locked continuous seeking stays aligned on every update and leaves no trailing animation', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 30
            settings.pps = 240
            view.time = 4
            view.cursorTime = 8
            window.previewTransport.player.stepPreviewTime(10)
        })
        await page.clock.runFor(64)
        const locked = await page.evaluate(() => {
            const { view, settings } = window.editorTest
            window.previewTransport.player.beginPreviewScrub('locked')
            return {
                viewport: view.time,
                target:
                    view.cursorTime +
                    ((0.5 - settings.playFollowPosition / 100) * view.h) / settings.pps,
                scrolling: view.scrollingY,
            }
        })
        expect(locked.viewport).toBe(locked.target)
        expect(locked.scrolling).toBeUndefined()
        for (const cursor of [8.08, 8.34, 9.2, 7.6]) {
            const current = await page.evaluate((cursor) => {
                const { view, settings } = window.editorTest
                if (cursor === 7.6) {
                    settings.playFollowPosition = 70
                    settings.pps = 480
                }
                window.previewTransport.player.scrubPreviewTo(cursor)
                return {
                    cursor: view.cursorTime,
                    viewport: view.time,
                    target:
                        cursor +
                        ((0.5 - settings.playFollowPosition / 100) * view.h) / settings.pps,
                    scrolling: view.scrollingY,
                }
            }, cursor)
            expect(current.cursor).toBe(cursor)
            expect(current.viewport).toBe(current.target)
            expect(current.scrolling).toBeUndefined()
            await page.clock.runFor(32)
            expect(await page.evaluate(() => window.editorTest.view.time)).toBe(current.viewport)
        }
        const released = await page.evaluate(() => {
            window.previewTransport.player.endPreviewScrub(false)
            return window.editorTest.view.time
        })
        await page.clock.runFor(500)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(released)
        await page.evaluate(() => window.previewTransport.player.stepPreviewTime(10))
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(released)
        await page.clock.runFor(300)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBeCloseTo(
            released + 0.01,
            9,
        )
    })

    test('following uses the suspended shared clock while the window is inactive', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { view, settings } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 50
            view.time = 4
            view.cursorTime = 8
            window.previewTransport.player.stepPreviewTime(10)
        })
        await page.clock.runFor(64)
        const before = await page.evaluate(async () => {
            window.dispatchEvent(new Event('blur'))
            await window.editorTest.nextTick()
            return window.editorTest.view.time
        })
        await page.clock.runFor(1000)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(before)
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await page.clock.runFor(32)
        expect(await page.evaluate(() => window.editorTest.view.time)).toBe(8.01)
        expect(await page.evaluate(() => window.editorTest.view.scrollingY)).toBeUndefined()
    })
})
