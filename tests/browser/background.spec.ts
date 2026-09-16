import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        initialFrameRequests: number
        backgroundTest: {
            frames: number
            audioStarts: number
            isActive: () => boolean
            isPlaying: () => boolean
            clock: () => { now: number; delta: number }
            startAudio: () => void
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

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { isAppActive } = (await import(
            urls.get('/src/activity.ts')!
        )) as typeof import('../../src/activity')
        const { time } = (await import(
            urls.get('/src/time.ts')!
        )) as typeof import('../../src/time')
        const { isPlaying } = (await import(
            urls.get('/src/player.ts')!
        )) as typeof import('../../src/player')
        const { startOrStopPlayer } = (await import(
            urls.get('/src/editor/player.ts')!
        )) as typeof import('../../src/editor/player')
        window.backgroundTest = {
            frames: 0,
            audioStarts: 0,
            isActive: () => isAppActive.value,
            isPlaying: () => isPlaying.value,
            clock: () => time.value,
            startAudio: startOrStopPlayer,
        }
        const request = window.requestAnimationFrame
        window.requestAnimationFrame = (callback) => {
            window.backgroundTest.frames++
            return request(callback)
        }
        const start = AudioBufferSourceNode.prototype.start
        AudioBufferSourceNode.prototype.start = function (...args) {
            window.backgroundTest.audioStarts++
            return start.apply(this, args)
        }
    })
    await settle(page)
})

test('unfocused and hidden windows suspend visual work and resume with current state', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const pulse = document.createElement('div')
        pulse.id = 'background-animation'
        pulse.className = 'animate-pulse'
        document.body.append(pulse)
        window.dispatchEvent(new Event('blur'))
        await window.editorTest.nextTick()
        window.backgroundTest.frames = 0
        window.editorFrames = { chart: 0, overlay: 0 }
        return { active: window.backgroundTest.isActive(), clock: window.backgroundTest.clock() }
    })
    expect(result.active).toBe(false)
    await expect(page.locator('#background-animation')).toHaveCSS('animation-play-state', 'paused')
    await page.evaluate(async () => {
        // Even external changes while blurred must not keep GPU presentation busy.
        window.editorTest.view.time = 4
        window.editorTest.view.cursorTime = 2
        await window.editorTest.nextTick()
    })
    await page.waitForTimeout(300)
    expect(
        await page.evaluate(() => ({
            clock: window.backgroundTest.clock(),
            frames: window.backgroundTest.frames,
            draws: window.editorFrames,
        })),
    ).toEqual({ clock: result.clock, frames: 0, draws: { chart: 0, overlay: 0 } })

    // A focus event must not restart an actually hidden document.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
    })
    expect(await page.evaluate(() => window.backgroundTest.isActive())).toBe(false)
    const resumed = await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
        return { active: window.backgroundTest.isActive(), clock: window.backgroundTest.clock() }
    })
    expect(resumed.active).toBe(true)
    expect(resumed.clock.now).toBeGreaterThan(result.clock.now + 0.25)
    expect(resumed.clock.delta).toBe(0)
    await expect(page.locator('#background-animation')).toHaveCSS('animation-play-state', 'running')
    await settle(page)
    const draws = await page.evaluate(() => window.editorFrames)
    expect(draws.chart).toBeGreaterThan(0)
    expect(draws.overlay).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(2)
})

for (const reason of ['blur', 'hidden'] as const) {
    test(`editor playback pauses when ${reason} and remains idle until explicitly restarted`, async ({
        page,
    }) => {
        await page.evaluate(async () => {
            await window.editorTest.addWaveform()
            window.backgroundTest.startAudio()
        })
        expect(await page.evaluate(() => window.backgroundTest.isPlaying())).toBe(true)
        expect(await page.evaluate(() => window.backgroundTest.audioStarts)).toBeGreaterThan(0)
        const stopped = await page.evaluate(async (reason) => {
            if (reason === 'blur') {
                window.dispatchEvent(new Event('blur'))
            } else {
                Object.defineProperty(document, 'visibilityState', {
                    configurable: true,
                    value: 'hidden',
                })
                document.dispatchEvent(new Event('visibilitychange'))
            }
            await window.editorTest.nextTick()
            window.backgroundTest.frames = 0
            window.editorFrames = { chart: 0, overlay: 0 }
            return {
                clock: window.backgroundTest.clock(),
                starts: window.backgroundTest.audioStarts,
            }
        }, reason)
        expect(await page.evaluate(() => window.backgroundTest.isPlaying())).toBe(false)
        await page.waitForTimeout(300)
        expect(
            await page.evaluate(() => ({
                clock: window.backgroundTest.clock(),
                starts: window.backgroundTest.audioStarts,
                frames: window.backgroundTest.frames,
                draws: window.editorFrames,
            })),
        ).toEqual({ ...stopped, frames: 0, draws: { chart: 0, overlay: 0 } })
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'visible',
            })
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('focus'))
        })
        await settle(page)
        expect(await page.evaluate(() => window.backgroundTest.isPlaying())).toBe(false)
    })
}

test('loading an initially unfocused tab schedules no frames until focus', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
        window.initialFrameRequests = 0
        const request = window.requestAnimationFrame
        window.requestAnimationFrame = (callback) => {
            window.initialFrameRequests++
            return request(callback)
        }
    })
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.waitForTimeout(200)
    expect(
        await page.evaluate(() => ({
            frames: window.initialFrameRequests,
            draws: window.editorFrames,
        })),
    ).toEqual({
        frames: 0,
        draws: { chart: 0, overlay: 0 },
    })

    const resumed = await page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/time.ts')!.name
        const { time } = (await import(url)) as typeof import('../../src/time')
        const before = time.value
        delete (document as Partial<Document>).hasFocus
        window.dispatchEvent(new Event('focus'))
        return { before, after: time.value }
    })
    expect(resumed.before.now).toBeGreaterThan(0)
    expect(resumed.after.now).toBeGreaterThan(resumed.before.now)
    expect(resumed.after.delta).toBe(0)
    await expect.poll(() => page.evaluate(() => window.editorFrames.chart)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.editorFrames.overlay)).toBeGreaterThan(0)
})
