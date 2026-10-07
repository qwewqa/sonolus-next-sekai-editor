import { expect, test, type Locator, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

import { resource } from './previewResourceFixture'

declare global {
    interface Window {
        previewTest: {
            uploads: number
            frames: number
            bitmaps: number
            closes: number
            vertices: number[]
            resolutions: number
            aspect: number
            errors: string[]
            auditions?: number[]
            restore?: () => void
            contextRequests?: boolean[]
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

test.beforeEach(async ({ page }, testInfo) => {
    const transport = testInfo.titlePath.includes('preview transport')
    // Touch never opens the settings on its own in the default dock.
    const touch = testInfo.titlePath.some((title) => title.startsWith('on touch'))
    if (transport) await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.previewTest = {
            uploads: 0,
            frames: 0,
            bitmaps: 0,
            closes: 0,
            vertices: [],
            resolutions: 0,
            aspect: 0,
            errors: [],
        }
        window.addEventListener('error', (event) => window.previewTest.errors.push(event.message))
        const upload = WebGLRenderingContext.prototype.texImage2D
        WebGLRenderingContext.prototype.texImage2D = function (...args: unknown[]) {
            if (args.some((arg) => arg instanceof ImageBitmap)) window.previewTest.uploads++
            return Reflect.apply(upload, this, args)
        }
        const uniformNames = new WeakMap<WebGLUniformLocation, string>()
        const getUniformLocation = WebGLRenderingContext.prototype.getUniformLocation
        WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
            const location = getUniformLocation.call(this, program, name)
            if (location) uniformNames.set(location, name)
            return location
        }
        const uniform1f = WebGLRenderingContext.prototype.uniform1f
        WebGLRenderingContext.prototype.uniform1f = function (location, value) {
            if (location && uniformNames.get(location) === 'u_aspect') {
                window.previewTest.aspect = value
            }
            return uniform1f.call(this, location, value)
        }
        const clear = WebGLRenderingContext.prototype.clear
        WebGLRenderingContext.prototype.clear = function (...args) {
            window.previewTest.frames++
            window.previewTest.vertices = []
            return clear.apply(this, args)
        }
        const bufferSubData = WebGLRenderingContext.prototype.bufferSubData
        WebGLRenderingContext.prototype.bufferSubData = function (...args) {
            const data = args[2]
            if (data instanceof Float32Array) window.previewTest.vertices.push(...data)
            return bufferSubData.apply(this, args)
        }
        const decode = window.createImageBitmap
        window.createImageBitmap = async (...args: unknown[]) => {
            const bitmap = (await Reflect.apply(decode, window, args)) as ImageBitmap
            window.previewTest.bitmaps++
            return bitmap
        }
        const close = ImageBitmap.prototype.close
        ImageBitmap.prototype.close = function () {
            window.previewTest.closes++
            return close.call(this)
        }
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate((transport) => {
        if (transport) {
            window.editorTest.settings.previewPosition = 'top'
            window.editorTest.settings.topDockHeight = 200
        }
        window.editorTest.settings.showPreview = true
    }, transport)
    const preview = page.locator('.preview')
    if (transport || touch)
        await preview.getByRole('button', { name: 'Show Preview Settings', exact: true }).click()
    await expect(
        page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.preview-controls input[type="number"]').first()).toHaveValue('10')
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(2)
    await settle(page)
    if (transport) await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'))
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.previewTest.errors), 'uncaught browser errors').toEqual(
        [],
    )
})

test('unavailable WebGL reports a graphics error and reload can recover', async ({ page }) => {
    await page.evaluate(async () => {
        window.editorTest.settings.showPreview = false
        await window.editorTest.nextTick()
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            ...args: Parameters<typeof original>
        ) {
            return args[0] === 'webgl' ? null : Reflect.apply(original, this, args)
        } as typeof original
        window.previewTest.restore = () => {
            HTMLCanvasElement.prototype.getContext = original
        }
        window.editorTest.settings.showPreview = true
    })
    const preview = page.locator('.preview')
    await expect(preview.getByText('Preview graphics could not be started.')).toBeVisible()
    await expect(preview.getByText('The preview skin could not be loaded.')).toHaveCount(0)
    await preview.getByText('Error Details').click()
    await expect(
        preview.getByText('WebGL is unavailable or disabled in this browser'),
    ).toBeVisible()
    await page.evaluate(() => window.previewTest.restore!())
    // A graphics failure retries only the canvas; the decoded skin is reused.
    const requests: string[] = []
    page.on('request', (request) => {
        if (/\/resource\/(skin|particle)\.scp/.test(request.url())) requests.push(request.url())
    })
    await preview.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(
        page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
    ).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(4)
    expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
    expect(requests).toEqual([])
})

test('preview falls back when antialiasing prevents graphics initialization', async ({ page }) => {
    await page.evaluate(async () => {
        window.editorTest.settings.showPreview = false
        await window.editorTest.nextTick()
        const original = HTMLCanvasElement.prototype.getContext
        window.previewTest.contextRequests = []
        HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            ...args: Parameters<typeof original>
        ) {
            if (args[0] === 'webgl') {
                const antialias = !!(args[1] as WebGLContextAttributes)?.antialias
                window.previewTest.contextRequests!.push(antialias)
                if (antialias) return null
            }
            return Reflect.apply(original, this, args)
        } as typeof original
        window.editorTest.settings.showPreview = true
    })
    await expect(
        page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => window.previewTest.contextRequests)).toEqual([true, false])
    expect(await page.evaluate(() => window.editorTest.settings.previewAntialias)).toBe(true)
})

test('texture upload failures stay recoverable without uncaught errors', async ({ page }) => {
    await page.evaluate(async () => {
        window.editorTest.settings.showPreview = false
        await window.editorTest.nextTick()
        const original = WebGLRenderingContext.prototype.texImage2D
        WebGLRenderingContext.prototype.texImage2D = function (...args: unknown[]) {
            if (args.some((arg) => arg instanceof ImageBitmap))
                throw new Error('Texture upload failed')
            return Reflect.apply(original, this, args)
        }
        window.previewTest.restore = () => {
            WebGLRenderingContext.prototype.texImage2D = original
        }
        window.editorTest.settings.showPreview = true
    })
    const preview = page.locator('.preview')
    await expect(preview.getByText('Preview graphics could not be started.')).toBeVisible()
    await preview.getByText('Error Details').click()
    await expect(preview.getByText('Texture upload failed', { exact: true })).toBeVisible()
    await page.evaluate(() => window.previewTest.restore!())
    await preview.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(
        page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
    ).toBeVisible()
})

for (const failure of [
    { status: 503, body: 'Unavailable', detail: 'Resource download failed: HTTP 503' },
    { status: 200, body: '<html>Cached error page</html>', detail: 'Invalid scp file' },
]) {
    test(`skin failure reports ${failure.detail} and retries a versioned resource`, async ({
        page,
    }) => {
        // Decoded skins are cached for the page, so start a fresh page whose
        // first download fails.
        await page.route('**/resource/skin.scp*', (route) => route.fulfill(failure))
        await page.reload()
        await page.evaluate(installEditorFixture)
        await page.evaluate(() => {
            window.editorTest.settings.showPreview = true
        })
        const preview = page.locator('.preview')
        await expect(preview.getByText('The preview skin could not be loaded.')).toBeVisible()
        await preview.getByText('Error Details').click()
        await expect(preview.getByText(failure.detail)).toBeVisible()
        await page.route('**/resource/skin.scp*', (route) =>
            route.fulfill({ body: resource('skins') }),
        )
        const request = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith('/resource/skin.scp'),
        )
        await preview.getByRole('button', { name: 'Reload', exact: true }).click()
        expect(new URL((await request).url()).searchParams.get('v')).toBeTruthy()
        await expect(
            page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
        ).toBeVisible()
    })
}

test.describe('preview transport', () => {
    test.use({ hasTouch: true })

    const cursor = (page: Page) => page.evaluate(() => window.editorTest.view.cursorTime)
    const wheel = (
        page: Page,
        init: Pick<WheelEventInit, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'>,
        selector = '.preview-transport-toggle',
    ) =>
        page.locator(selector).evaluate((element, init) => {
            let bubbled = false
            const onWheel = () => (bubbled = true)
            document.addEventListener('wheel', onWheel)
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
            element.dispatchEvent(event)
            document.removeEventListener('wheel', onWheel)
            return { prevented: event.defaultPrevented, bubbled }
        }, init)
    const installAudio = (page: Page) =>
        page.evaluate(async () => {
            const { settings, history, nextTick } = window.editorTest
            settings.playPreviewDuration = 120
            settings.waveform = 'off'
            history.replaceState({
                ...history.state.value,
                bgm: {
                    offset: 0,
                    buffer: new AudioBuffer({
                        length: 30 * 8000,
                        sampleRate: 8000,
                        numberOfChannels: 1,
                    }),
                },
            })
            await nextTick()
            window.previewTest.auditions = []
            const start = AudioBufferSourceNode.prototype.start
            AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
                if (duration !== undefined && this.buffer === history.state.value.bgm.buffer) {
                    window.previewTest.auditions!.push(offset)
                }
                start.call(this, when, offset, duration)
            }
        })
    const auditions = (page: Page) => page.evaluate(() => window.previewTest.auditions)
    const clock = (page: Page) =>
        page.evaluate(async () => {
            const url =
                performance
                    .getEntriesByType('resource')
                    .find((entry) => new URL(entry.name).pathname === '/src/time.ts')?.name ??
                '/src/time.ts'
            const { time } = (await import(url)) as typeof import('../../src/time')
            return { now: performance.now() / 1000, frame: time.value.now }
        })
    const pressPointer = async (page: Page, button: Locator) => {
        await button.evaluate((element) =>
            element.addEventListener(
                'pointerdown',
                (event) => {
                    ;(element as HTMLElement).dataset.pointerId =
                        `${(event as PointerEvent).pointerId}`
                },
                { once: true },
            ),
        )
        const bounds = (await button.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.down()
        return Number(await button.getAttribute('data-pointer-id'))
    }

    test.beforeEach(async ({ page }) => {
        await page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }).tap()
        // A 170 px top panel would lose over 30% of the image to a docked strip,
        // so the strip shows over it on demand.
        await page.evaluate(() => (window.editorTest.settings.topDockHeight = 170))
        await page.setViewportSize({ width: 540, height: 1000 })
        await page.clock.runFor(32)
        // A strip shown while it had a place of its own stays up; otherwise show it.
        const show = page.getByRole('button', { name: 'Show Playback Controls', exact: true })
        if (await show.count()) await show.tap()
        await expect(
            page.getByRole('group', { name: 'Preview Playback Controls', exact: true }),
        ).toBeVisible()
        await page.evaluate(() => {
            window.editorTest.settings.playFollow = false
            window.editorTest.settings.playPreviewDuration = 0
        })
        // Vue ignores bubbling events timestamped at/before listener creation.
        // Advance past the panel's mount before sending native keyboard events.
        await page.clock.runFor(1)
    })

    test('same-beat elevation connectors keep identical geometry when playback starts', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const { fixtures, show, view, settings } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            show(
                {
                    ...fixtures.interaction,
                    slides: [
                        [
                            { ...base, beat: 8, left: -1, size: 2, elevation: 1 },
                            { ...base, beat: 8, left: -1, size: 2, elevation: 4 },
                        ],
                    ],
                },
                3,
            )
            view.cursorTime = 3
            settings.previewShowEffects = false
        })
        await page.clock.runFor(32)
        const paused = await page.evaluate(() => window.previewTest.vertices)
        expect(paused.length).toBeGreaterThan(0)
        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Pause Preview', exact: true })).toBeVisible()
        await page.clock.runFor(32)
        expect(await cursor(page)).toBe(3)
        expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(paused)
        await page.getByRole('button', { name: 'Pause Preview', exact: true }).click()
        await page.clock.runFor(32)
        expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(paused)
    })

    test('touch taps and Space/Enter activate each step once without editor shortcuts', async ({
        page,
    }) => {
        for (const milliseconds of [-100, -10, -1, 1, 10, 100]) {
            await page.evaluate(() => (window.editorTest.view.cursorTime = 3.123456))
            await page
                .getByRole('button', {
                    name: `${milliseconds < 0 ? 'Back' : 'Forward'} ${Math.abs(milliseconds)} ms`,
                    exact: true,
                })
                .tap()
            expect(await cursor(page)).toBe(3.123456 + milliseconds / 1000)
        }
        const step = page.getByRole('button', { name: 'Forward 10 ms', exact: true })
        for (const key of ['Space', 'Enter']) {
            const before = await cursor(page)
            await step.focus()
            await page.keyboard.down(key)
            await expect(
                page.getByRole('button', { name: 'Play Preview', exact: true }),
            ).toBeVisible()
            await page.keyboard.down(key) // native repeat must not add another tap
            await page.keyboard.up(key)
            expect(await cursor(page)).toBe(before + 0.01)
            await expect(
                page.getByRole('button', { name: 'Play Preview', exact: true }),
            ).toBeVisible()
        }
    })

    test('wheel seeks both ways with normalized units without leaking into editor or settings', async ({
        page,
    }) => {
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 3.123456
            window.editorTest.view.time = 4
        })
        const before = await page.evaluate(() => ({
            time: window.editorTest.view.time,
            lane: window.editorTest.view.lane,
            selection: window.editorTest.snapshot().selected,
        }))
        const preview = (await page.locator('.preview-transport-toggle').boundingBox())!
        await page.mouse.move(preview.x + 20, preview.y + 100)
        await page.mouse.wheel(0, 100)
        await expect.poll(() => cursor(page)).toBe(3.123456 - 0.1)
        const previewWheelDirection = Math.sign((await cursor(page)) - 3.123456)
        expect(await wheel(page, { deltaY: -100 })).toEqual({ prevented: true, bubbled: false })
        expect(await cursor(page)).toBeCloseTo(3.123456, 10)
        expect(await wheel(page, { deltaY: 3, deltaMode: 1 })).toEqual({
            prevented: true,
            bubbled: false,
        })
        expect(await cursor(page)).toBeCloseTo(3.075456, 10)
        const height = await page
            .locator('.preview-transport-root')
            .evaluate((el) => el.clientHeight)
        await wheel(page, { deltaY: 1, deltaMode: 2 })
        expect(await cursor(page)).toBeCloseTo(3.075456 - height / 1000, 10)
        await wheel(page, { deltaY: -1, deltaMode: 2 })
        await page.clock.runFor(150)
        expect(
            await page.evaluate(() => ({
                time: window.editorTest.view.time,
                lane: window.editorTest.view.lane,
                selection: window.editorTest.snapshot().selected,
            })),
        ).toEqual(before)
        const position = await cursor(page)
        for (const init of [{ deltaY: 100, ctrlKey: true }, { deltaX: 100 }]) {
            expect(await wheel(page, init)).toEqual({ prevented: false, bubbled: true })
            expect(await cursor(page)).toBe(position)
        }
        const editor = (await page.locator('canvas.editor-chart').boundingBox())!
        await page.mouse.move(editor.x + editor.width / 2, editor.y + editor.height / 2)
        await page.mouse.wheel(0, 100)
        await expect
            .poll(() => page.evaluate(() => window.editorTest.view.time))
            .not.toBe(before.time)
        const editorTime = await page.evaluate(() => window.editorTest.view.time)
        expect(Math.sign(editorTime - before.time)).toBe(previewWheelDirection)
        expect(await cursor(page), 'editor scrolling retains the preview cursor').toBe(position)
        await wheel(page, { deltaY: 10000 })
        expect(await cursor(page)).toBe(0)
        await page
            .getByRole('button', { name: 'Hide Playback Controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await page.getByRole('button', { name: 'Show Preview Settings', exact: true }).click()
        expect(await wheel(page, { deltaY: 100 }, '.preview-controls-body')).toEqual({
            prevented: false,
            bubbled: true,
        })
        expect(await cursor(page)).toBe(0)
    })

    test('wheel pauses hidden-panel playback and auditions once after the gesture settles', async ({
        page,
    }) => {
        await installAudio(page)
        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        await page
            .getByRole('button', { name: 'Hide Playback Controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await page.clock.runFor(3500)
        await expect(
            page.getByRole('button', { name: 'Show Playback Controls', exact: true }),
        ).toBeVisible()
        const before = await cursor(page)
        for (let i = 0; i < 3; i++) {
            await wheel(page, { deltaY: 100 })
            await page.clock.runFor(60)
            expect(await auditions(page)).toEqual([])
        }
        expect(await cursor(page)).toBeCloseTo(before - 0.3, 10)
        await page.clock.runFor(59)
        expect(await auditions(page)).toEqual([])
        await page.clock.runFor(1)
        const stopped = await cursor(page)
        expect(await auditions(page)).toEqual([stopped])
        await page.clock.runFor(500)
        expect(await cursor(page)).toBe(stopped)
        await page.getByRole('button', { name: 'Show Playback Controls', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Play Preview', exact: true })).toBeVisible()
    })

    test('an editor note click supersedes pending wheel audio', async ({ page }) => {
        await installAudio(page)
        await wheel(page, { deltaY: 100 })
        const before = await cursor(page)
        const note = await page.evaluate(() => window.editorTest.point(-3, 3))
        await page.mouse.click(note.x, note.y)
        expect(await auditions(page)).toEqual([1.5])
        await page.clock.runFor(500)
        expect(await auditions(page)).toEqual([1.5])
        expect(await cursor(page)).toBe(before)
    })

    for (const reason of ['hide', 'blur', 'unmount'] as const) {
        test(`${reason} cancels wheel audio without a deferred audition`, async ({ page }) => {
            await installAudio(page)
            await wheel(page, { deltaY: 100 })
            const stopped = await cursor(page)
            if (reason === 'hide') {
                await page
                    .getByRole('button', { name: 'Hide Playback Controls', exact: true })
                    .click({ position: { x: 12, y: 12 } })
            } else if (reason === 'blur') {
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hasFocus', {
                        configurable: true,
                        value: () => false,
                    })
                    window.dispatchEvent(new Event('blur'))
                })
                expect(await wheel(page, { deltaY: 100 })).toEqual({
                    prevented: false,
                    bubbled: true,
                })
            } else {
                await page.evaluate(() => (window.editorTest.settings.showPreview = false))
            }
            await page.clock.runFor(500)
            if (reason === 'blur') {
                await page.evaluate(() => {
                    Reflect.deleteProperty(document, 'hasFocus')
                    window.dispatchEvent(new Event('focus'))
                })
                await page.clock.runFor(500)
            }
            expect(await auditions(page)).toEqual([])
            expect(await cursor(page)).toBe(stopped)
        })
    }

    test('all hold rates use elapsed time in both directions and stop on pointer release', async ({
        page,
    }) => {
        for (const milliseconds of [-100, -10, -1, 1, 10, 100]) {
            await page.evaluate(() => (window.editorTest.view.cursorTime = 20.123456))
            const button = page.getByRole('button', {
                name: `${milliseconds < 0 ? 'Back' : 'Forward'} ${Math.abs(milliseconds)} ms`,
                exact: true,
            })
            const pointerId = await pressPointer(page, button)
            const tapped = await cursor(page)
            expect(tapped).toBe(20.123456 + milliseconds / 1000)
            await page.clock.runFor(250)
            const started = (await clock(page)).now
            await page.clock.runFor(1000)
            const expected = tapped + (((await clock(page)).frame - started) * milliseconds) / 10
            expect(await cursor(page)).toBeCloseTo(expected, 9)
            // A delayed frame catches up by elapsed time without replaying taps.
            await page.clock.fastForward(500)
            const caughtUp = tapped + (((await clock(page)).frame - started) * milliseconds) / 10
            expect(await cursor(page)).toBeCloseTo(caughtUp, 9)
            expect(
                await button.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
            ).toBe(true)
            await page.mouse.move(1500, 20)
            await page.mouse.up()
            const released = await cursor(page)
            await page.clock.runFor(500)
            expect(await cursor(page)).toBe(released)
            expect(
                await button.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
            ).toBe(false)
        }
    })

    test('Follow eases taps but locks held and wheel seeking without trailing timeline motion', async ({
        page,
    }) => {
        const offset = await page.evaluate(() => {
            const { settings, view } = window.editorTest
            settings.playFollow = true
            settings.playFollowPosition = 75
            view.cursorTime = 5.123456
            view.time = 10
            view.scrollingY = undefined
            return (-0.25 * view.h) / settings.pps
        })
        const read = () =>
            page.evaluate(() => ({
                cursor: window.editorTest.view.cursorTime,
                timeline: window.editorTest.view.time,
                scroll: window.editorTest.view.scrollingY?.type ?? null,
            }))
        await pressPointer(page, page.getByRole('button', { name: 'Forward 10 ms', exact: true }))
        const tapped = await read()
        expect(tapped.cursor).toBe(5.123456 + 0.01)
        expect(tapped.timeline).toBe(10)
        expect(tapped.scroll).toBe('ease')
        await page.clock.runFor(100)
        const easing = await read()
        expect(easing.timeline).toBeLessThan(tapped.timeline)
        expect(easing.timeline).toBeGreaterThan(easing.cursor + offset)
        await page.clock.runFor(150)
        const locked = await read()
        expect(locked.timeline).toBeCloseTo(locked.cursor + offset, 10)
        expect(locked.scroll).toBeNull()
        for (let i = 0; i < 3; i++) {
            await page.clock.runFor(80)
            const held = await read()
            expect(held.timeline).toBeCloseTo(held.cursor + offset, 10)
            expect(held.scroll).toBeNull()
        }
        await page.mouse.up()
        const released = await read()
        await page.clock.runFor(300)
        expect(await read()).toEqual(released)

        await wheel(page, { deltaY: 100 })
        const sought = await read()
        expect(sought.cursor).toBe(released.cursor - 0.1)
        expect(sought.timeline).toBeCloseTo(sought.cursor + offset, 10)
        expect(sought.scroll).toBeNull()
        await page.clock.runFor(120)
        expect(await read()).toEqual(sought)
        await page.clock.runFor(300)
        expect(await read()).toEqual(sought)
    })

    test('a held keyboard step stops when Tab moves focus and cannot restart on keyup', async ({
        page,
    }) => {
        await page.evaluate(() => (window.editorTest.view.cursorTime = 3))
        const step = page.getByRole('button', { name: 'Back 1 ms', exact: true })
        await step.focus()
        await page.keyboard.down('Space')
        await page.clock.runFor(750)
        expect(await cursor(page)).toBeGreaterThan(2.94)
        expect(await cursor(page)).toBeLessThan(2.96)
        await page.keyboard.press('Tab')
        await expect(step).not.toBeFocused()
        const stopped = await cursor(page)
        await page.clock.runFor(1000)
        await page.keyboard.up('Space')
        await page.clock.runFor(1000)
        expect(await cursor(page)).toBe(stopped)
        await expect(page.getByRole('button', { name: 'Play Preview', exact: true })).toBeVisible()
    })

    test('a pointer step takes over a keyboard hold without losing the press', async ({ page }) => {
        await page.evaluate(() => (window.editorTest.view.cursorTime = 3))
        const keyboardStep = page.getByRole('button', { name: 'Forward 10 ms', exact: true })
        await keyboardStep.focus()
        await page.keyboard.down('Space')
        expect(await cursor(page)).toBe(3.01)

        const pointerStep = page.getByRole('button', { name: 'Forward 100 ms', exact: true })
        await pressPointer(page, pointerStep)
        expect(await cursor(page)).toBe(3.01 + 0.1)
        // Releasing the old keyboard activation must not cancel the new pointer hold.
        await page.keyboard.up('Space')
        await page.clock.runFor(350)
        expect(await cursor(page)).toBeGreaterThan(3.5)
        await page.mouse.up()
        const released = await cursor(page)
        await page.clock.runFor(500)
        expect(await cursor(page)).toBe(released)
    })

    for (const reason of ['pointercancel', 'blur', 'unmount'] as const) {
        test(`${reason} cancels a hold without resuming it later`, async ({ page }) => {
            await page.evaluate(() => (window.editorTest.view.cursorTime = 3.123456))
            const button = page.getByRole('button', { name: 'Forward 10 ms', exact: true })
            const pointerId = await pressPointer(page, button)
            await page.clock.runFor(750)
            expect(await cursor(page)).toBeGreaterThan(3.5)
            if (reason === 'pointercancel') {
                await button.dispatchEvent('pointercancel', { pointerId, pointerType: 'mouse' })
            } else if (reason === 'blur') {
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hasFocus', {
                        configurable: true,
                        value: () => false,
                    })
                    window.dispatchEvent(new Event('blur'))
                })
            } else {
                await page.evaluate(() => (window.editorTest.settings.showPreview = false))
            }
            const stopped = await cursor(page)
            await page.clock.runFor(1000)
            expect(await cursor(page)).toBe(stopped)
            if (reason === 'blur') {
                await page.evaluate(() => {
                    Reflect.deleteProperty(document, 'hasFocus')
                    window.dispatchEvent(new Event('focus'))
                })
            }
            await page.mouse.up()
            await page.clock.runFor(1000)
            expect(await cursor(page)).toBe(stopped)
        })
    }

    test('Play/Pause never autohides controls and manual toggling preserves keyboard focus', async ({
        page,
    }) => {
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 3.123456
            window.editorTest.view.time = 20
            window.editorTest.settings.playStartPosition = 'view'
        })
        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        // The UI uses a simulated animation clock; playback follows native audio
        // time. Drive frames while waiting for real playback to advance.
        await expect
            .poll(async () => {
                await page.clock.runFor(32)
                return cursor(page)
            })
            .toBeGreaterThan(3.3)
        await page.getByRole('button', { name: 'Pause Preview', exact: true }).click()
        const paused = await cursor(page)
        await page.clock.runFor(500)
        expect(await cursor(page)).toBe(paused)

        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        // These waits check elapsed-time visibility, not intermediate animation
        // frames. Skip frame-by-frame GPU work so slower CI runners stay bounded.
        await page.clock.fastForward(3500)
        await expect(
            page.getByRole('group', { name: 'Preview Playback Controls', exact: true }),
        ).toBeVisible()
        const pause = page.getByRole('button', { name: 'Pause Preview', exact: true })
        await pause.focus()
        await page.clock.fastForward(3500)
        await expect(pause).toBeFocused()
        await pause.press('Escape')
        await expect(
            page.getByRole('button', { name: 'Show Playback Controls', exact: true }),
        ).toBeFocused()
        await expect(page.locator('.preview-transport')).toBeHidden()
        await expect(page.locator('.preview-transport')).toHaveAttribute('inert', '')
        await expect(page.locator('.preview-transport')).toHaveAttribute('aria-hidden', 'true')
        // The corner clock keeps time while the strip is hidden.
        const corner = page.locator('.transport-corner-time')
        const hiddenTime = await corner.textContent()
        await page.clock.fastForward(3500)
        await expect
            .poll(async () => {
                await page.clock.runFor(32)
                return corner.textContent()
            })
            .not.toBe(hiddenTime)
        await page.getByRole('button', { name: 'Show Playback Controls', exact: true }).click()
        await page.clock.fastForward(3500)
        await expect(
            page.getByRole('group', { name: 'Preview Playback Controls', exact: true }),
        ).toBeVisible()
    })

    test('the time shows in the strip when it has room and in the corner otherwise', async ({
        page,
    }) => {
        const corner = page.locator('.transport-corner-time')
        const stripTime = page.locator('.transport-time')
        const advances = async (clock: typeof corner) => {
            const first = await clock.textContent()
            await expect
                .poll(async () => {
                    await page.clock.runFor(32)
                    return clock.textContent()
                })
                .not.toBe(first)
        }
        // Over the image, the strip may hide, so the time stays in the corner.
        await expect(stripTime).toHaveCount(0)
        await expect(corner).toBeVisible()
        await expect(corner).toHaveText(/^\d{2}:\d{2}\.\d{3}$/)
        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        await page
            .getByRole('button', { name: 'Hide Playback Controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await expect(page.locator('.preview-transport')).toBeHidden()
        await advances(corner)

        // With a strip of its own and room beside its steppers, the strip holds
        // the time and nothing covers the image, also during playback.
        await page.setViewportSize({ width: 600, height: 1000 })
        await page.evaluate(() => (window.editorTest.settings.topDockHeight = 500))
        await page.clock.runFor(32)
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(stripTime).toBeVisible()
        await expect(corner).toHaveCount(0)
        await advances(stripTime)
        const order = await page.evaluate(() =>
            [...document.querySelector('.preview-transport')!.children].map((element) =>
                element.classList.contains('transport-time')
                    ? 'time'
                    : element.classList.contains('transport-play')
                      ? 'play'
                      : 'steps',
            ),
        )
        expect(order).toEqual(['play', 'time', 'steps'])

        // Show Time controls both clocks.
        await page.evaluate(() => (window.editorTest.settings.previewShowTime = false))
        await page.clock.runFor(32)
        await expect(stripTime).toHaveCount(0)
        await expect(corner).toHaveCount(0)
    })

    test('a narrow strip switches to the compact stepper instead of wrapping', async ({ page }) => {
        const panel = page.locator('.preview-transport')
        const stepSize = page.getByRole('button', { name: /^Step Size: \d+ ms$/i })
        for (const width of [240, 330, 540]) {
            await page.setViewportSize({ width, height: 1000 })
            await page.clock.runFor(32)
            await expect.poll(() => panel.evaluate((element) => element.clientHeight)).toBe(52)
        }
        // At 540 px the six steppers fit on touch, with the time in the corner.
        await expect(page.getByRole('button', { name: 'Back 100 ms', exact: true })).toBeVisible()
        await expect(stepSize).toHaveCount(0)

        await page.setViewportSize({ width: 300, height: 1000 })
        await page.clock.runFor(32)
        await expect(page.getByRole('button', { name: 'Back 100 ms', exact: true })).toHaveCount(0)
        await expect(stepSize).toHaveAccessibleName(/10 ms/)
        const before = await cursor(page)
        await page.getByRole('button', { name: 'Forward 10 ms', exact: true }).tap()
        expect(await cursor(page)).toBeCloseTo(before + 0.01, 10)
        // The step size cycles 10 → 100 → 1 → 10 and is remembered.
        for (const [size, next] of [
            [100, 'Forward 100 ms'],
            [1, 'Forward 1 ms'],
            [10, 'Forward 10 ms'],
        ] as const) {
            await stepSize.tap()
            expect(await page.evaluate(() => window.editorTest.settings.previewStepSize)).toBe(size)
            await expect(page.getByRole('button', { name: next, exact: true })).toBeVisible()
        }
        await expect(page.locator('.preview-transport :focus')).toHaveCount(0)
    })

    test('space below the viewport shows persistent controls without a tap', async ({ page }) => {
        await page
            .getByRole('button', { name: 'Hide Playback Controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await expect(page.locator('.preview-transport')).toBeHidden()
        await page.setViewportSize({ width: 600, height: 1000 })
        await page.evaluate(() => (window.editorTest.settings.topDockHeight = 500))
        await page.clock.runFor(32)
        const panel = page.getByRole('group', { name: 'Preview Playback Controls', exact: true })
        await expect(panel).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(
            page.getByRole('button', { name: 'Show Preview Settings', exact: true }),
        ).toBeVisible()
        const geometry = await page.evaluate(() => {
            const viewport = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const bar = document.querySelector('.preview-transport')!.getBoundingClientRect()
            const preview = document.querySelector('.preview')!.getBoundingClientRect()
            return { gap: bar.top - viewport.bottom, bottom: preview.bottom - bar.bottom }
        })
        expect(geometry.gap).toBeCloseTo(4, 1)
        expect(geometry.bottom).toBeGreaterThanOrEqual(3.9)
        const play = page.getByRole('button', { name: 'Play Preview', exact: true })
        await play.focus()
        await play.press('Escape')
        await expect(play).not.toBeFocused()
        await expect(panel).toBeVisible()
        const before = await cursor(page)
        await wheel(page, { deltaY: 100 }, '.preview-transport-root')
        expect(await cursor(page)).toBe(before - 0.1)
        await play.click()
        await page.clock.fastForward(10000)
        await expect(panel).toBeVisible()

        // Too short for the image and strip, Auto moves the strip over the image,
        // which keeps its full size; the strip stays in view.
        await page.evaluate(() => (window.editorTest.settings.topDockHeight = 230))
        await page.clock.runFor(32)
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(1)
        await expect(panel).toBeVisible()
        const overlay = await page.evaluate(() => {
            const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const preview = document.querySelector('.preview')!.getBoundingClientRect()
            return { width: image.width, height: image.height, panel: preview.height }
        })
        expect(overlay.height).toBeCloseTo(overlay.panel, 1)

        // Below shrinks the image instead and keeps the full strip under it,
        // centered across the panel: never squeezed beside the image.
        await page.evaluate(() => (window.editorTest.settings.previewTransportPosition = 'below'))
        await page.clock.runFor(32)
        await expect(panel).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Back 100 ms', exact: true })).toBeVisible()
        const below = await page.evaluate(() => {
            const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const strip = document.querySelector('.preview-transport')!.getBoundingClientRect()
            const preview = document.querySelector('.preview')!.getBoundingClientRect()
            return {
                gap: strip.top - image.bottom,
                center: strip.left + strip.width / 2 - (preview.left + preview.width / 2),
            }
        })
        expect(below.gap).toBeCloseTo(4, 1)
        expect(below.center).toBeCloseTo(0, 0)
    })
})

test('paused compact timestamp follows the image through letterboxing and resize', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewPosition = 'left'
        settings.leftDockWidth = 220
        settings.previewControls = 'expanded'
    })
    await settle(page)
    await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)

    const geometry = () =>
        page.evaluate(() => {
            const container = document.querySelector('.preview')!.getBoundingClientRect()
            const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const time = document.querySelector('.transport-corner-time')!.getBoundingClientRect()
            const front = document.elementFromPoint(
                time.x + time.width / 2,
                time.y + time.height / 2,
            )
            return {
                imageTop: image.top - container.top,
                imageLeft: image.left - container.left,
                x: time.left - image.left,
                y: time.top - image.top,
                covered: !!front?.closest('.preview-controls, .preview-settings-toggle'),
            }
        })
    // A tall side panel keeps the image at its top, with the bar right below.
    await expect(page.locator('.transport-corner-time')).toBeVisible()
    const side = await geometry()
    expect(side.imageTop).toBe(0)
    expect(side.x).toBeCloseTo(4, 1)
    // The 20 px chip is centered on the 36 px settings toggle beside it.
    expect(side.y).toBeCloseTo(12, 1)
    expect(side.covered).toBe(false)

    // Below in a short top panel letterboxes the image horizontally; its
    // full-width strip then has room for the time, so no chip covers the image.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewPosition = 'top'
        settings.topDockHeight = 200
        settings.previewTransportPosition = 'below'
    })
    await settle(page)
    await expect(page.locator('.transport-corner-time')).toHaveCount(0)
    await expect(page.locator('.transport-time')).toBeVisible()
    const letterbox = await page.evaluate(() => {
        const container = document.querySelector('.preview')!.getBoundingClientRect()
        const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
        return image.left - container.left
    })
    expect(letterbox).toBeGreaterThan(10)
})

const overlapArea = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

const readPreviewChrome = (page: Page) =>
    page.evaluate(() => {
        const box = (selector: string) => {
            const element = document.querySelector(selector)
            if (!element) return
            const { left, top, right, bottom } = element.getBoundingClientRect()
            return { left, top, right, bottom }
        }
        const reachable = (element: Element | null) => {
            if (!element) return false
            const rect = element.getBoundingClientRect()
            const front = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
            )
            return element === front || element.contains(front)
        }
        const body = document.querySelector('.preview-controls-body')!
        return {
            preview: box('.preview')!,
            image: box('.preview-viewport')!,
            bar: box('.preview-transport'),
            settings: box('.preview-controls')!,
            clock: box('.transport-corner-time'),
            viewport: { width: innerWidth, height: innerHeight },
            headerReachable: reachable(document.querySelector('.preview-controls button')),
            scrolls: body.scrollHeight > body.clientHeight,
            transportReachable: [...document.querySelectorAll('.preview-transport button')].map(
                reachable,
            ),
        }
    })

test('expanded preview settings leave docked playback buttons and the clock reachable', async ({
    page,
}) => {
    await page.getByRole('radio', { name: '21:9', exact: true }).check()
    await page.setViewportSize({ width: 700, height: 200 })
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.previewPosition = 'left'
        settings.leftDockWidth = 250
        settings.previewControls = 'expanded'
    })
    await settle(page)
    await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
    await expect(page.locator('.preview-controls')).toBeVisible()
    const geometry = await readPreviewChrome(page)
    // The short panel opens its settings beside the dock, within the screen.
    expect(geometry.settings.left).toBeGreaterThanOrEqual(geometry.preview.right)
    expect(geometry.settings.right).toBeLessThanOrEqual(geometry.viewport.width)
    expect(geometry.settings.bottom).toBeLessThanOrEqual(geometry.viewport.height)
    expect(overlapArea(geometry.settings, geometry.bar!)).toBe(0)
    expect(overlapArea(geometry.settings, geometry.clock!)).toBe(0)
    expect(geometry.headerReachable).toBe(true)
    expect(geometry.scrolls).toBe(true)
    expect(geometry.transportReachable.length).toBeGreaterThanOrEqual(4)
    expect(geometry.transportReachable.every(Boolean)).toBe(true)

    // The settings body scrolls instead of making its lower controls unreachable.
    const antialias = page.getByRole('checkbox', { name: 'Antialias', exact: true })
    await antialias.uncheck()
    await expect(antialias).not.toBeChecked()
    await expect(page.locator('.preview-transport')).toBeVisible()
})

for (const side of ['left', 'right'] as const) {
    test(`a short ${side} preview opens settings beside the dock without hiding its controls`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 568, height: 320 })
        await page.evaluate((side) => {
            const { settings } = window.editorTest
            settings.previewPosition = side
            settings.leftDockWidth = 220
            settings.rightDockWidth = 220
            settings.previewControls = 'collapsed'
        }, side)
        await settle(page)
        // The toggle mirrors the clock in the image's top-right corner.
        const toggle = page.getByRole('button', { name: 'Show Preview Settings', exact: true })
        const before = await readPreviewChrome(page)
        const toggleBox = (await toggle.boundingBox())!
        expect(toggleBox.width).toBe(36)
        expect(toggleBox.x + toggleBox.width).toBeCloseTo(before.image.right - 4, 1)
        expect(toggleBox.y).toBeCloseTo(before.image.top + 4, 1)
        // The clock chip shares the toggle's center line in the opposite corner.
        expect((before.clock!.top + before.clock!.bottom) / 2).toBeCloseTo(
            toggleBox.y + toggleBox.height / 2,
            1,
        )
        await toggle.click()
        await expect(toggle).toBeHidden()
        await expect
            .poll(async () => {
                const { settings, preview } = await readPreviewChrome(page)
                return side === 'left'
                    ? settings.left - preview.right
                    : preview.left - settings.right
            })
            .toBeCloseTo(4, 1)
        const geometry = await readPreviewChrome(page)
        expect(geometry.settings.left).toBeGreaterThanOrEqual(4)
        expect(geometry.settings.right).toBeLessThanOrEqual(geometry.viewport.width - 4)
        expect(geometry.settings.bottom).toBeLessThanOrEqual(geometry.viewport.height - 4)
        expect(overlapArea(geometry.settings, geometry.preview)).toBe(0)
        expect(geometry.headerReachable).toBe(true)
        expect(geometry.transportReachable.length).toBeGreaterThanOrEqual(4)
        expect(geometry.transportReachable.every(Boolean)).toBe(true)
        const antialias = page.getByRole('checkbox', { name: 'Antialias', exact: true })
        await antialias.uncheck()
        await expect(antialias).not.toBeChecked()
        // A pointer change returns focus, so editor shortcuts keep working.
        await expect(page.locator('.preview-controls :focus')).toHaveCount(0)

        await page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }).click()
        await expect(toggle).toBeVisible()
        await expect(page.locator('.preview-controls')).toBeHidden()
    })
}

test('preview restores lost contexts and reuses decoded atlases for every new context', async ({
    page,
}) => {
    const preview = page.locator('.preview')
    const initialFrames = await page.evaluate(() => window.previewTest.frames)
    expect(initialFrames).toBeGreaterThan(0)
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.previewTest.frames)).toBe(initialFrames)

    const prevented = await page.evaluate(async () => {
        const canvas = document.querySelector<HTMLCanvasElement>('.preview canvas')!
        const gl = canvas.getContext('webgl')!
        const lost = new Promise<boolean>((resolve) => {
            canvas.addEventListener(
                'webglcontextlost',
                (event) => queueMicrotask(() => resolve(event.defaultPrevented)),
                { once: true },
            )
        })
        const extension = gl.getExtension('WEBGL_lose_context')!
        window.previewTest.restore = () => extension.restoreContext()
        extension.loseContext()
        return await lost
    })
    expect(prevented, 'context-loss handler permits WebGL restoration').toBe(true)
    await page.evaluate(() => (window.editorTest.view.cursorTime += 0.25))
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.frames)).toBe(initialFrames)

    await page.evaluate(() => window.previewTest.restore!())
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(4)
    await expect
        .poll(() => page.evaluate(() => window.previewTest.frames))
        .toBeGreaterThan(initialFrames)
    expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)

    await page.getByRole('checkbox', { name: 'Antialias', exact: true }).uncheck()
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(6)

    // Closing keeps the decoded atlases for the next preview; reopening only
    // uploads them into its new context.
    const requests: string[] = []
    page.on('request', (request) => {
        if (/\/resource\/(skin|particle)\.scp/.test(request.url())) requests.push(request.url())
    })
    await page.evaluate(() => (window.editorTest.settings.showPreview = false))
    await expect(preview).toHaveCount(0)
    await page.evaluate(() => (window.editorTest.settings.showPreview = true))
    await expect(preview).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(8)
    await settle(page)
    expect(
        await page.evaluate(() => ({
            bitmaps: window.previewTest.bitmaps,
            closes: window.previewTest.closes,
        })),
    ).toEqual({ bitmaps: 2, closes: 0 })
    expect(requests).toEqual([])
})

test('dragging and property input update actual preview geometry before committing', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
        window.editorTest.view.cursorTime = 4
    })
    await settle(page)
    const original = await page.evaluate(() => window.previewTest.vertices)
    expect(original.length).toBeGreaterThan(0)
    const start = await page.evaluate(() => window.editorTest.point(-1, 9))
    const end = await page.evaluate(() => window.editorTest.point(2, 9))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    const dragged = await page.evaluate(() => window.previewTest.vertices)
    expect(dragged).not.toEqual(original)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(4)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    await page.mouse.up()
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(dragged)
    await page.evaluate(() => window.editorTest.history.undoState())
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(original)

    // Select the restored note and edit the real sidebar without blurring it.
    const selectionFrames = await page.evaluate(() => window.previewTest.frames)
    await page.mouse.click(start.x, start.y)
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.frames)).toBe(selectionFrames + 1)
    expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(original)
    const lane = page.getByLabel('Lane', { exact: true })
    await lane.fill('2')
    await settle(page)
    const typed = await page.evaluate(() => window.previewTest.vertices)
    expect(typed).not.toEqual(original)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(4)
    await lane.press('Escape')
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(original)
    await lane.fill('2')
    await lane.press('Tab')
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(typed)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
})

test('unfocused preview defers geometry, compilation and renderer creation until focus', async ({
    page,
}) => {
    const before = await page.evaluate(() => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
        window.dispatchEvent(new Event('blur'))
        return { frames: window.previewTest.frames, uploads: window.previewTest.uploads }
    })
    await page.locator('.preview-controls').getByText('Antialias', { exact: true }).click()
    for (let i = 0; i < 3; i++) {
        await page.evaluate(async () => {
            const { setPreviewEdit } = await import('/src/preview/edit.ts')
            const current = window.editorTest.history.state.value
            setPreviewEdit(current, () => {
                window.previewTest.resolutions++
                return current
            })
            window.editorTest.view.cursorTime += 0.25
        })
        await page.waitForTimeout(50)
    }
    expect(
        await page.evaluate(() => ({
            frames: window.previewTest.frames,
            uploads: window.previewTest.uploads,
            resolutions: window.previewTest.resolutions,
        })),
    ).toEqual({ ...before, resolutions: 0 })
    await page.evaluate(() => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
        window.dispatchEvent(new Event('focus'))
    })
    await settle(page)
    expect(await page.evaluate(() => window.previewTest.resolutions)).toBe(1)
    expect(await page.evaluate(() => window.previewTest.uploads)).toBe(before.uploads + 2)
    expect(await page.evaluate(() => window.previewTest.frames)).toBe(before.frames + 1)
})

test.describe('preview background camera', () => {
    const showCameraChart = async (page: Page) => {
        await page.evaluate(() => {
            const { show, fixtures, view } = window.editorTest
            const first = {
                beat: 0,
                cameraLeft: -6,
                cameraSize: 12,
                cameraZoom: 1,
                cameraZoomTargetLane: 0,
                cameraZoomTargetY: 0,
                cameraZoomVerticalAlign: 'default' as const,
                cameraRotation: 0,
                cameraStageTilt: 1,
                eventEase: 'linear' as const,
            }
            show({
                ...fixtures.notes,
                cameraEvents: [
                    first,
                    {
                        ...first,
                        beat: 8,
                        cameraLeft: -2.5,
                        cameraSize: 8,
                        cameraZoom: 1.3,
                        cameraZoomTargetLane: -0.75,
                        cameraZoomTargetY: 0.35,
                        cameraRotation: (0.4 * 180) / Math.PI,
                        cameraStageTilt: 0.5,
                    },
                ],
            })
            view.cursorTime = 0
        })
        await settle(page)
    }

    const background = (page: Page) =>
        page.locator('.preview-background').evaluate((element) => {
            const viewport = element.parentElement!
            const width = Number.parseFloat(viewport.style.width)
            const height = Number.parseFloat(viewport.style.height)
            const style = getComputedStyle(element)
            const matrix = new DOMMatrix(style.transform)
            const corners = [
                [0, height],
                [0, 0],
                [width, 0],
                [width, height],
            ].map(([x, y]) => {
                const point = matrix.transformPoint({ x, y })
                return [((point.x - width / 2) * 2) / height, 1 - (point.y * 2) / height]
            })
            return {
                corners,
                rotation: Math.atan2(matrix.b, matrix.a),
                transform: style.transform,
                size: style.backgroundSize,
                clip: getComputedStyle(viewport).overflow,
                canvasTransform: getComputedStyle(viewport.querySelector('canvas')!).transform,
            }
        })

    test('matches engine background corners and stays synchronized while seeking and changing quality', async ({
        page,
    }) => {
        await showCameraChart(page)
        const first = await background(page)
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 2
        })
        await settle(page)
        expect((await background(page)).rotation).toBeCloseTo(0.2, 5)
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 4
        })
        await settle(page)
        const last = await background(page)
        // Engine 9e93ba0, same camera as the reference in background.test.ts.
        const expected = [
            [-4.601563948172114, -1.4209550223968535],
            [-2.7713883637279726, 2.9078173025386116],
            [4.924206880601742, -0.3458281809176391],
            [3.094031296157601, -4.674600505853104],
        ]
        for (let i = 0; i < 4; i++) {
            expect(last.corners[i]![0]).toBeCloseTo(expected[i]![0]!, 4)
            expect(last.corners[i]![1]).toBeCloseTo(expected[i]![1]!, 4)
        }
        expect(last).toMatchObject({ size: '100% 100%', clip: 'hidden', canvasTransform: 'none' })
        await page.evaluate(() => {
            window.editorTest.settings.previewRenderScale = 0.5
        })
        await settle(page)
        expect(await background(page)).toEqual(last)
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 0
        })
        await settle(page)
        expect(await background(page)).toEqual(first)
        const frames = await page.evaluate(() => window.previewTest.frames)
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(frames)
        expect(await background(page)).toEqual(first)
    })

    test('paused camera drafts, cancellation and undo update the background with the notes', async ({
        page,
    }) => {
        await showCameraChart(page)
        await page.evaluate(() => {
            const { history, store, settings } = window.editorTest
            settings.showSidebar = true
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) => entity.type === 'cameraEventJoint' && entity.beat === 0,
                ),
            })
        })
        await settle(page)
        const before = await background(page)
        const rotation = page.getByLabel('Rotation', { exact: true })
        await rotation.fill('45')
        await settle(page)
        const draft = await background(page)
        expect(draft.rotation).toBeCloseTo(Math.PI / 4, 5)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        await rotation.press('Escape')
        await settle(page)
        expect(await background(page)).toEqual(before)
        await rotation.fill('45')
        await rotation.press('Tab')
        await settle(page)
        expect(await background(page)).toEqual(draft)
        await page.evaluate(() => window.editorTest.history.undoState())
        await settle(page)
        expect(await background(page)).toEqual(before)
    })

    test('aspect changes preserve rotation and an inactive preview catches up on focus', async ({
        page,
    }) => {
        await showCameraChart(page)
        await page.evaluate(() => {
            window.editorTest.view.cursorTime = 4
        })
        await settle(page)
        for (const label of ['21:9', '4:3', '16:9']) {
            await page.getByRole('radio', { name: label, exact: true }).check()
            await settle(page)
            expect((await background(page)).rotation).toBeCloseTo(0.4, 5)
        }
        const before = await background(page)
        await page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
            window.dispatchEvent(new Event('blur'))
            window.editorTest.view.cursorTime = 2
        })
        await settle(page)
        expect(await background(page)).toEqual(before)
        await page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
            window.dispatchEvent(new Event('focus'))
        })
        await settle(page)
        expect((await background(page)).rotation).toBeCloseTo(0.2, 5)
        // Switching to a static chart also removes all overscan and camera motion.
        await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction))
        await settle(page)
        expect((await background(page)).transform).toBe('matrix(1, 0, 0, 1, 0, 0)')
    })
})

test.describe('preview aspect ratios', () => {
    test.use({ deviceScaleFactor: 1.25 })

    // Side panels keep the image at their top; top panels center it. Either way
    // the bar docks below the image only while the image keeps its full size.
    const expectViewport = async (page: Page, ratio: number, anchor: 'start' | 'center') => {
        const dimensions = await page.evaluate(() => {
            const container = document.querySelector<HTMLElement>('.preview')!
            const viewport = document.querySelector<HTMLElement>('.preview-viewport')!
            const canvas = viewport.querySelector('canvas')!
            const bar = document.querySelector<HTMLElement>('.preview-transport')!
            const box = (element: HTMLElement) => {
                const { x, y, width, height } = element.getBoundingClientRect()
                return { x, y, width, height }
            }
            return {
                container: box(container),
                viewport: box(viewport),
                canvas: box(canvas),
                barHeight: bar.getBoundingClientRect().height,
                docked: !document.querySelector('.preview-transport-toggle'),
                styleWidth: Number.parseFloat(viewport.style.width),
                styleHeight: Number.parseFloat(viewport.style.height),
                backingWidth: canvas.width,
                backingHeight: canvas.height,
                aspect: window.previewTest.aspect,
                pixelRatio: devicePixelRatio,
            }
        })
        const { container } = dimensions
        const reserve = dimensions.barHeight + 8
        const full = Math.min(container.width, container.height * ratio)
        const dockedWidth = Math.min(container.width, (container.height - reserve) * ratio)
        // Below the image while it keeps its full size, allowing half a pixel for
        // rounded dock sizes; otherwise the strip shows over it on demand.
        const below = (dockedWidth - full) / ratio >= -0.5
        expect(dimensions.docked).toBe(below)
        const expectedWidth = below ? dockedWidth : full
        // CSSOM serializes declarations with less precision than the JS layout.
        expect(Math.abs(dimensions.styleWidth - expectedWidth)).toBeLessThan(0.001)
        expect(dimensions.styleWidth / dimensions.styleHeight).toBeCloseTo(ratio, 4)
        // CSS layout quantizes fractional coordinates to a small subpixel grid.
        expect(Math.abs(dimensions.canvas.width - expectedWidth)).toBeLessThan(0.03)
        expect(Math.abs(dimensions.canvas.height - expectedWidth / ratio)).toBeLessThan(0.03)
        expect(dimensions.canvas).toEqual(dimensions.viewport)
        expect(
            Math.abs(
                dimensions.viewport.x +
                    dimensions.viewport.width / 2 -
                    (container.x + container.width / 2),
            ),
        ).toBeLessThan(0.03)
        // Over the image, Auto keeps it where Below had it: at the top.
        const expectedTop = !below
            ? 0
            : anchor === 'start'
              ? 0
              : (container.height - expectedWidth / ratio - reserve) / 2
        expect(Math.abs(dimensions.viewport.y - container.y - expectedTop)).toBeLessThan(0.03)
        expect(dimensions.aspect).toBeCloseTo(ratio, 10)
        expect(dimensions.pixelRatio).toBe(1.25)
        return dimensions
    }

    test('presets fit the selected viewport through resize and placement without idle drawing', async ({
        page,
    }) => {
        const group = page.getByRole('radiogroup', { name: 'Aspect ratio' })
        await page.evaluate(() => (window.editorTest.settings.previewControls = 'expanded'))
        await expect(group.getByRole('radio', { name: '16:9', exact: true })).toBeChecked()
        const uploads = await page.evaluate(() => window.previewTest.uploads)
        for (const size of [
            { width: 1600, height: 1000 },
            { width: 1069, height: 733 },
        ]) {
            await page.setViewportSize(size)
            for (const [label, ratio] of [
                ['16:9', 16 / 9],
                ['21:9', 21 / 9],
                ['4:3', 4 / 3],
            ] as const) {
                await group.getByRole('radio', { name: label, exact: true }).check()
                await settle(page)
                await expect(group.locator('input:checked')).toHaveCount(1)
                await expectViewport(page, ratio, 'start')
            }
        }
        // The top panel fits by height, unlike the width-limited left panel.
        for (const topDockHeight of [0, 160]) {
            await page.evaluate((topDockHeight) => {
                window.editorTest.settings.previewPosition = 'top'
                window.editorTest.settings.previewControls = 'expanded'
                window.editorTest.settings.topDockHeight = topDockHeight
            }, topDockHeight)
            await settle(page)
            // A bar shown while docked stays over a shorter image until dismissed;
            // hide it so the image returns to its centered, full-height fit.
            const hide = page.getByRole('button', { name: 'Hide Playback Controls', exact: true })
            if (await hide.count()) {
                await hide.click({ position: { x: 12, y: 12 } })
                // That press outside a form open under the dock also closed it.
                await page.evaluate(() => (window.editorTest.settings.previewControls = 'expanded'))
            }
            for (const [label, ratio] of [
                ['16:9', 16 / 9],
                ['21:9', 21 / 9],
                ['4:3', 4 / 3],
            ] as const) {
                await group.getByRole('radio', { name: label, exact: true }).check()
                await settle(page)
                await expectViewport(page, ratio, 'center')
            }
        }
        const frames = await page.evaluate(() => window.previewTest.frames)
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(frames)
        expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
        // Moving the panel recreates its context but never re-decodes the atlases.
        expect(await page.evaluate(() => window.previewTest.uploads)).toBe(uploads + 2)
    })

    test('arrow navigation retains radio focus without invoking editor shortcuts', async ({
        page,
    }) => {
        const group = page.getByRole('radiogroup', { name: 'Aspect ratio' })
        const initialTime = await page.evaluate(() => window.editorTest.view.cursorTime)
        await group.getByRole('radio', { name: '16:9', exact: true }).focus()
        for (const label of ['21:9', '4:3', '16:9']) {
            await page.keyboard.press('ArrowRight')
            const selected = group.getByRole('radio', { name: label, exact: true })
            await expect(selected).toBeChecked()
            await expect(selected).toBeFocused()
        }
        await page.keyboard.press('ArrowLeft')
        await expect(group.getByRole('radio', { name: '4:3', exact: true })).toBeChecked()
        await expect(group.getByRole('radio', { name: '4:3', exact: true })).toBeFocused()
        expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(initialTime)
    })

    test('quality changes backing resolution without changing the logical aspect or field geometry', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1069, height: 733 })
        // An automatically opened form closes when the narrower panel sends it beside.
        await page.evaluate(() => (window.editorTest.settings.previewControls = 'expanded'))
        await page.getByRole('radio', { name: '21:9', exact: true }).check()
        await settle(page)
        const original = await expectViewport(page, 21 / 9, 'start')
        const vertices = await page.evaluate(() => window.previewTest.vertices)
        const quality = page.locator('.preview-controls input[type="number"]').nth(1)
        await quality.fill('0.25')
        await quality.press('Tab')
        await settle(page)
        const reduced = await expectViewport(page, 21 / 9, 'start')
        expect(reduced.backingWidth).toBe(Math.round(original.styleWidth * 1.25 * 0.25))
        expect(reduced.backingHeight).toBe(Math.round(original.styleHeight * 1.25 * 0.25))
        expect(reduced.backingWidth).toBeLessThan(original.backingWidth)
        expect(reduced.backingWidth / reduced.backingHeight).not.toBe(reduced.aspect)
        expect(await page.evaluate(() => window.previewTest.vertices)).toEqual(vertices)
    })

    test('slider and checkbox keys change only preview controls without scrolling or starting playback', async ({
        page,
    }) => {
        const readEditor = () =>
            page.evaluate(async () => {
                const playerURL = performance
                    .getEntriesByType('resource')
                    .find((entry) => new URL(entry.name).pathname === '/src/player.ts')!.name
                const { isPlaying } = (await import(playerURL)) as typeof import('../../src/player')
                const { lane, time, cursorTime } = window.editorTest.view
                return { lane, time, cursorTime, isPlaying: isPlaying.value }
            })
        const before = await readEditor()
        expect(before.isPlaying).toBe(false)
        const controls = page.locator('.preview-controls')
        const speed = controls.locator('input[type="range"]').first()
        await speed.focus()
        await speed.press('ArrowRight')
        await expect(speed).toHaveValue('10.05')
        const quality = controls.locator('input[type="range"]').nth(1)
        await quality.focus()
        await quality.press('ArrowUp')
        await expect(quality).toHaveValue('1.25')
        for (const name of ['Show Effects', 'Antialias']) {
            const checkbox = controls.getByLabel(name, { exact: true })
            await checkbox.focus()
            await checkbox.press('Space')
            await expect(checkbox).not.toBeChecked()
            await expect(checkbox).toBeFocused()
            // Send the next key to actual focus rather than re-focusing through
            // Locator.press: blurring a checkbox used to start editor playback.
            await page.keyboard.press('Space')
            await expect(checkbox).toBeChecked()
            await expect(checkbox).toBeFocused()
            await expect(controls).toBeVisible()
        }
        await settle(page)
        expect(await readEditor()).toEqual(before)
    })

    test('inactive aspect changes render only the latest preset when focus returns', async ({
        page,
    }) => {
        const before = await page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
            window.dispatchEvent(new Event('blur'))
            return { frames: window.previewTest.frames, uploads: window.previewTest.uploads }
        })
        await page.getByRole('radio', { name: '21:9', exact: true }).check()
        await settle(page)
        await page.getByRole('radio', { name: '4:3', exact: true }).check()
        await page.setViewportSize({ width: 1069, height: 733 })
        await settle(page)
        expect(
            await page.evaluate(() => ({
                frames: window.previewTest.frames,
                uploads: window.previewTest.uploads,
            })),
        ).toEqual(before)
        await page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
            window.dispatchEvent(new Event('focus'))
        })
        await settle(page)
        await expectViewport(page, 4 / 3, 'start')
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(before.frames + 1)
        expect(await page.evaluate(() => window.previewTest.uploads)).toBe(before.uploads)
    })

    test('long settings labels use available screen height and still scroll in a short window', async ({
        page,
    }) => {
        // Wider text stands in for longer translations and platform font metrics.
        await page.addStyleTag({
            content: '.preview-controls { font-family: monospace; font-size: 16px; }',
        })
        await page.evaluate(() => {
            window.editorTest.settings.previewPosition = 'top'
            window.editorTest.settings.topDockHeight = 140
            window.editorTest.settings.previewControls = 'expanded'
        })
        await page.setViewportSize({ width: 1069, height: 900 })
        await settle(page)
        const controls = page.locator('.preview-controls')
        const body = controls.locator('.preview-controls-body')
        const antialias = controls.getByLabel('Antialias', { exact: true })
        const aspect = controls.getByRole('radiogroup', { name: 'Aspect Ratio', exact: true })
        // Aspect Ratio stays one row, and the form extends below the short panel
        // instead of scrolling while the screen has room.
        const first = (await aspect
            .getByRole('radio', { name: '16:9', exact: true })
            .boundingBox())!
        const last = (await aspect.getByRole('radio', { name: '4:3', exact: true }).boundingBox())!
        expect(last.y).toBe(first.y)
        expect(
            await controls.evaluate(
                (panel) =>
                    panel.getBoundingClientRect().bottom >
                    document.querySelector('.preview')!.getBoundingClientRect().bottom,
            ),
        ).toBe(true)
        await expect(antialias).toBeInViewport()
        await expect
            .poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
            .toBe(0)
        await antialias.uncheck()
        await expect(antialias).not.toBeChecked()

        await page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }).click()
        await page.getByRole('button', { name: 'Show Preview Settings', exact: true }).click()
        await settle(page)
        await expect(antialias).toBeInViewport()
        await expect
            .poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
            .toBe(0)

        // Even when the window itself is short, the header remains reachable
        // and only the settings body scrolls.
        await page.setViewportSize({ width: 1069, height: 128 })
        await settle(page)
        await expect
            .poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight))
            .toBe(true)
        expect(
            await controls.evaluate((panel) => panel.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(124)
        await expect(
            page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }),
        ).toBeInViewport()
        await antialias.scrollIntoViewIfNeeded()
        await expect(antialias).toBeInViewport()
        await antialias.check()
        await expect(antialias).toBeChecked()
        const speed = controls.getByRole('spinbutton', { name: 'Note Speed', exact: true })
        await speed.scrollIntoViewIfNeeded()
        await expect(speed).toBeInViewport()
    })

    test('settings fit wide panels, open beside narrow ones, and stay within small screens', async ({
        page,
    }) => {
        const controls = page.locator('.preview-controls')
        const fits = () =>
            controls.evaluate((panel) => {
                const bounds = panel.getBoundingClientRect()
                return (
                    bounds.left >= 0 &&
                    bounds.right <= innerWidth &&
                    bounds.bottom <= innerHeight &&
                    panel.scrollWidth <= panel.clientWidth &&
                    [...panel.querySelectorAll('input, select, span')].every((element) => {
                        const rect = element.getBoundingClientRect()
                        return (
                            rect.width === 0 ||
                            (rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5)
                        )
                    })
                )
            })
        const placement = () =>
            page.evaluate(() => {
                const preview = document.querySelector('.preview')!.getBoundingClientRect()
                const panel = document.querySelector('.preview-controls')!.getBoundingClientRect()
                return panel.left >= preview.left && panel.right <= preview.right
                    ? 'inside'
                    : panel.left >= preview.right
                      ? 'beside'
                      : 'overlapping'
            })

        // A 320 px left panel holds the whole form below its playback bar.
        await page.evaluate(() => (window.editorTest.settings.leftDockWidth = 320))
        await settle(page)
        await expect.poll(placement).toBe('inside')
        expect(await fits()).toBe(true)

        // The default 260 px panel at this size is too narrow for the form.
        await page.setViewportSize({ width: 1069, height: 733 })
        await page.evaluate(() => (window.editorTest.settings.leftDockWidth = 0))
        await settle(page)
        await expect.poll(placement).toBe('beside')
        expect(await fits()).toBe(true)

        // A phone keeps the form within its width, stacking labels when narrow.
        await page.evaluate(() => {
            window.editorTest.settings.previewPosition = 'top'
            window.editorTest.settings.previewControls = 'expanded'
        })
        for (const width of [390, 250]) {
            await page.setViewportSize({ width, height: 700 })
            await settle(page)
            await expect.poll(fits).toBe(true)
            const antialias = controls.getByLabel('Antialias', { exact: true })
            await antialias.scrollIntoViewIfNeeded()
            await antialias.uncheck()
            await expect(antialias).not.toBeChecked()
            await antialias.check()
        }
        const label = (await controls.getByText('Antialias', { exact: true }).boundingBox())!
        const field = (await controls.getByText('Enabled').last().boundingBox())!
        expect(field.y).toBeGreaterThanOrEqual(label.y + label.height)
    })
})

test('preview number fields keep typing through re-renders and normalize on change', async ({
    page,
}) => {
    const preview = page.locator('.preview-controls')
    for (const [label, typed] of [
        ['Note Speed', '9.2'],
        ['Render Scale', '1.5'],
    ] as const) {
        const field = preview.getByRole('spinbutton', { name: label, exact: true })
        await field.fill(typed)
        // Another setting changing re-renders the form.
        const toggle = () =>
            page.evaluate(async () => {
                const { settings, nextTick } = window.editorTest
                settings.previewShowHitboxes = !settings.previewShowHitboxes
                await nextTick()
            })
        await toggle()
        await expect(field).toHaveValue(typed)
        await field.press('Enter')
        await expect(field).toHaveValue(typed)
        await toggle()
    }
    const speed = preview.getByRole('spinbutton', { name: 'Note Speed', exact: true })
    await speed.fill('99')
    await speed.press('Enter')
    await expect(speed).toHaveValue('12')
    await speed.fill('')
    await speed.press('Enter')
    await expect(speed).toHaveValue('12')
})

test('a preview setting value that would truncate goes below its label', async ({ page }) => {
    const rows = page.locator('.preview-controls .preview-setting')
    const stacked = () =>
        rows.evaluateAll((elements) =>
            elements
                .filter((element) => element.classList.contains('preview-setting-stacked'))
                .map((element) => element.querySelector('.preview-setting-label')?.textContent),
        )
    // Values that fit stay beside their labels.
    await settle(page)
    expect(await stacked()).toEqual([])

    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.evaluate(() => (window.editorTest.settings.locale = 'ko'))
    const row = rows.filter({ hasText: '판정 범위 표시' })
    await expect(row).toHaveClass(/preview-setting-stacked/)
    const value = row.locator('.preview-toggle')
    await expect(value).toHaveText('비활성화됨')
    expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    // Measured at its longer state, a click doesn't move the row.
    const box = await row.boundingBox()
    await row.getByRole('checkbox').click()
    await expect(value).toHaveText('활성화됨')
    await settle(page)
    await expect(row).toHaveClass(/preview-setting-stacked/)
    expect(await row.boundingBox()).toEqual(box)
})

test('preview options share persisted settings with the main options menu', async ({ page }) => {
    const preview = page.locator('.preview-controls')
    for (const label of ['Note Speed', 'Render Scale']) {
        await expect(preview.getByText(label, { exact: true })).toBeVisible()
        await expect(preview.getByRole('slider', { name: label, exact: true })).toHaveAttribute(
            'title',
            label,
        )
        await expect(preview.getByRole('spinbutton', { name: label, exact: true })).toHaveAttribute(
            'title',
            label,
        )
    }
    await expect(
        preview.getByRole('radiogroup', { name: 'Aspect Ratio', exact: true }),
    ).toBeVisible()
    await expect(preview.getByRole('combobox', { name: 'Position', exact: true })).toHaveValue(
        'auto',
    )
    // Both entry points list the shared options in the same order.
    const order = [
        'Note Speed',
        'Highlight Selection',
        'Show Hitboxes',
        'Show Effects',
        'Show Time',
        'Aspect Ratio',
        'Render Scale',
        'Antialias',
        'Playback Controls',
    ]
    expect(
        (await preview.locator('.preview-setting-label').allTextContents()).map((text) =>
            text.trim(),
        ),
    ).toEqual([...order, 'Position'])
    const speed = preview.getByRole('spinbutton', { name: 'Note Speed', exact: true })
    const scale = preview.getByRole('spinbutton', { name: 'Render Scale', exact: true })
    await speed.fill('9.25')
    await speed.press('Enter')
    await scale.fill('1.5')
    await scale.press('Enter')
    await preview.getByRole('radio', { name: '4:3', exact: true }).check()
    await preview.getByLabel('Show Effects', { exact: true }).uncheck()
    await preview.getByLabel('Antialias', { exact: true }).uncheck()
    await preview
        .getByRole('combobox', { name: 'Playback Controls', exact: true })
        .selectOption('overlay')
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Note Speed', { exact: true })).toHaveValue('9.25')
    await expect(dialog.getByLabel('Render Scale', { exact: true })).toHaveValue('1.5')
    await expect(dialog.getByRole('combobox', { name: 'Aspect Ratio', exact: true })).toHaveValue(
        String(4 / 3),
    )
    const section = dialog
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Preview', exact: true }) })
    expect(
        await section
            .locator('label')
            .evaluateAll((labels) =>
                labels.map((label) => label.firstElementChild?.textContent?.trim()),
            ),
    ).toEqual([...order, 'Preview Settings Panel'])
    const transport = dialog.getByRole('combobox', { name: 'Playback Controls', exact: true })
    await expect(transport).toHaveValue('overlay')
    await transport.selectOption('below')
    // Placement lives with the other panels and shares the preview's own field.
    await expect(dialog.getByRole('combobox', { name: 'Preview', exact: true })).toHaveValue('auto')
    await dialog.getByRole('combobox', { name: 'Preview', exact: true }).selectOption('right')
    await expect(
        dialog
            .locator('label')
            .filter({ has: page.getByText('Show Effects', { exact: true }) })
            .getByRole('button'),
    ).toHaveValue('Disabled')
    await expect(
        dialog
            .locator('label')
            .filter({ has: page.getByText('Antialias', { exact: true }) })
            .getByRole('button'),
    ).toHaveValue('Disabled')
    await dialog.getByLabel('Note Speed', { exact: true }).fill('8.5')
    await dialog.getByLabel('Note Speed', { exact: true }).press('Tab')
    await dialog.getByLabel('Render Scale', { exact: true }).fill('0.75')
    await dialog.getByLabel('Render Scale', { exact: true }).press('Tab')
    await dialog
        .getByRole('combobox', { name: 'Aspect Ratio', exact: true })
        .selectOption({ label: '21:9' })
    await dialog
        .locator('label')
        .filter({ has: page.getByText('Show Effects', { exact: true }) })
        .getByRole('button')
        .click()
    await dialog
        .locator('label')
        .filter({ has: page.getByText('Antialias', { exact: true }) })
        .getByRole('button')
        .click()
    await dialog
        .getByRole('combobox', { name: 'Preview Settings Panel', exact: true })
        .selectOption('expanded')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-workspace-dock="right"] .preview')).toBeVisible()
    await expect(preview.getByRole('combobox', { name: 'Position', exact: true })).toHaveValue(
        'right',
    )
    await expect(speed).toHaveValue('8.5')
    await expect(scale).toHaveValue('0.75')
    await expect(preview.getByRole('radio', { name: '21:9', exact: true })).toBeChecked()
    await expect(preview.getByLabel('Show Effects', { exact: true })).toBeChecked()
    await expect(preview.getByLabel('Antialias', { exact: true })).toBeChecked()
    await expect(
        preview.getByRole('combobox', { name: 'Playback Controls', exact: true }),
    ).toHaveValue('below')
    await page.reload()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.showPreview = true
    })
    await expect(speed).toHaveValue('8.5')
    await expect(scale).toHaveValue('0.75')
    await expect(preview.getByRole('radio', { name: '21:9', exact: true })).toBeChecked()
    await expect(preview.getByLabel('Show Effects', { exact: true })).toBeChecked()
    await expect(preview.getByLabel('Antialias', { exact: true })).toBeChecked()
    await expect(
        preview.getByRole('combobox', { name: 'Playback Controls', exact: true }),
    ).toHaveValue('below')
})

test('invalid persisted preview options normalize to valid settings', async ({ page }) => {
    await page.evaluate(() => {
        const values = {
            previewNoteSpeed: 99,
            previewRenderScale: -1,
            previewAspectRatio: 0,
            previewShowEffects: 'bad',
            previewAntialias: null,
            previewTransportPosition: 'beside',
        }
        for (const [key, value] of Object.entries(values))
            localStorage.setItem(`sonolus-next-sekai-editor.${key}`, JSON.stringify(value))
    })
    await page.reload()
    await page.evaluate(installEditorFixture)
    expect(
        await page.evaluate(() => {
            const s = window.editorTest.settings
            return [
                s.previewNoteSpeed,
                s.previewRenderScale,
                s.previewAspectRatio,
                s.previewShowEffects,
                s.previewAntialias,
                s.previewTransportPosition,
            ]
        }),
    ).toEqual([12, 0.25, 16 / 9, true, false, 'auto'])
})

test.describe('preview panel lifecycle', () => {
    const skinRequests = (page: Page) => {
        const requests: string[] = []
        page.on('request', (request) => {
            if (/\/resource\/(skin|particle)\.scp/.test(request.url())) requests.push(request.url())
        })
        return requests
    }

    test('a displaced preview stops rendering and resumes without decoding again', async ({
        page,
    }) => {
        // Too short to stack Preview with Groups, so the left dock shows one.
        await page.setViewportSize({ width: 1600, height: 340 })
        await settle(page)
        const requests = skinRequests(page)
        const before = await page.evaluate(() => ({
            uploads: window.previewTest.uploads,
            frames: window.previewTest.frames,
        }))
        const dock = page.locator('[data-workspace-dock="left"]')
        await dock.getByRole('tab', { name: 'Groups', exact: true }).click()
        await expect(page.locator('.preview')).toHaveCount(0)
        await expect(page.locator('.preview-controls')).toHaveCount(0)
        // Groups needed the room, so the preview closed rather than waiting covered.
        expect(await page.evaluate(() => window.editorTest.settings.showPreview)).toBe(false)
        const covered = await page.evaluate(() => window.previewTest.frames)
        await page.evaluate(() => (window.editorTest.view.cursorTime += 0.5))
        await settle(page)
        await page.waitForTimeout(100)
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(covered)

        await dock.getByRole('tab', { name: 'Preview', exact: true }).click()
        await expect(page.locator('.preview')).toBeVisible()
        await expect
            .poll(() => page.evaluate(() => window.previewTest.uploads))
            .toBe(before.uploads + 2)
        await expect
            .poll(() => page.evaluate(() => window.previewTest.frames))
            .toBeGreaterThan(covered)
        expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
        expect(requests).toEqual([])
    })

    test('closing during the first load still decodes the skin only once', async ({ page }) => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => (release = resolve))
        await page.route('**/resource/skin.scp*', async (route) => {
            await gate
            await route.fulfill({ body: resource('skins') })
        })
        await page.reload()
        await page.evaluate(installEditorFixture)
        const requests = skinRequests(page)
        await page.evaluate(() => (window.editorTest.settings.showPreview = true))
        await expect(page.locator('.preview').getByText('Loading skin…')).toBeVisible()
        await page.evaluate(() => (window.editorTest.settings.showPreview = false))
        await expect(page.locator('.preview')).toHaveCount(0)
        await page.evaluate(() => (window.editorTest.settings.showPreview = true))
        release()
        await expect(
            page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
        ).toBeVisible()
        await expect.poll(() => page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
        expect(requests.filter((url) => url.includes('/skin.scp'))).toHaveLength(1)
    })

    test('moving the preview from its settings keeps them open and focused without decoding', async ({
        page,
    }) => {
        const requests = skinRequests(page)
        const uploads = await page.evaluate(() => window.previewTest.uploads)
        const placement = page
            .locator('.preview-controls')
            .getByRole('combobox', { name: 'Position', exact: true })
        await placement.focus()
        await placement.selectOption('top')
        await expect(page.locator('[data-workspace-dock="top"] .preview')).toBeVisible()
        await expect(placement).toHaveValue('top')
        await expect(placement).toBeFocused()
        await expect(placement).toBeInViewport()
        await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(uploads + 2)
        expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
        expect(requests).toEqual([])
        expect(await page.evaluate(() => window.editorTest.settings.previewControls)).toBe('auto')

        // Escape collapses the form and returns focus to its toggle.
        await page.keyboard.press('Escape')
        await expect(
            page.getByRole('button', { name: 'Show Preview Settings', exact: true }),
        ).toBeFocused()
        await expect(page.locator('.preview-controls')).toBeHidden()
    })

    test('pointer use of settings and playback controls returns editor shortcuts', async ({
        page,
    }) => {
        const controls = page.locator('.preview-controls')
        const focusInDock = () =>
            page.evaluate(() => !!document.activeElement?.closest('[data-workspace-dock]'))
        await controls.getByRole('radio', { name: '21:9', exact: true }).click()
        expect(await focusInDock()).toBe(false)
        await controls.getByLabel('Show Effects', { exact: true }).click()
        expect(await focusInDock()).toBe(false)
        const slider = controls.getByRole('slider', { name: 'Render Scale', exact: true })
        const box = (await slider.boundingBox())!
        await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2)
        await expect(slider).not.toHaveValue('1')
        expect(await focusInDock()).toBe(false)
        await page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }).click()
        expect(await focusInDock()).toBe(false)
        await page.getByRole('button', { name: 'Show Preview Settings', exact: true }).click()
        expect(await focusInDock()).toBe(false)
        await page.getByRole('button', { name: 'Play Preview', exact: true }).click()
        expect(await focusInDock()).toBe(false)
        await page.getByRole('button', { name: 'Pause Preview', exact: true }).click()
        expect(await focusInDock()).toBe(false)
    })

    // A fine pointer's strip always fits below even the shortest top dock; a
    // touch strip is taller and shows over the image there.
    test.describe('on touch', () => {
        test.use({ hasTouch: true })

        test('settings stay reachable while a bar shown earlier covers a shorter image', async ({
            page,
        }) => {
            await page.setViewportSize({ width: 400, height: 1180 })
            await page.evaluate(() => {
                const { settings } = window.editorTest
                settings.previewPosition = 'top'
                settings.topDockHeight = 420
                settings.previewControls = 'collapsed'
            })
            await settle(page)
            await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
            await page.evaluate(() => (window.editorTest.settings.topDockHeight = 160))
            await settle(page)
            // The bar stays up over the image, and the settings toggle stays clear of it.
            await expect(
                page.getByRole('button', { name: 'Hide Playback Controls', exact: true }),
            ).toHaveCount(1)
            const toggle = page.getByRole('button', { name: 'Show Preview Settings', exact: true })
            await expect(toggle).toBeVisible()
            await toggle.click()
            await expect(page.locator('.preview-controls')).toBeVisible()
            const geometry = await readPreviewChrome(page)
            expect(geometry.headerReachable).toBe(true)
            expect(geometry.transportReachable.length).toBeGreaterThanOrEqual(4)
            expect(geometry.transportReachable.every(Boolean)).toBe(true)
            expect(overlapArea(geometry.settings, geometry.bar!)).toBe(0)
            const antialias = page.getByRole('checkbox', { name: 'Antialias', exact: true })
            await antialias.uncheck()
            await expect(antialias).not.toBeChecked()
        })
    })

    test('a top preview beside Groups opens settings under the dock in full view', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 720 })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'top'
            settings.groupsPosition = 'top'
            settings.showGroups = true
            settings.previewControls = 'expanded'
        })
        await settle(page)
        await expect(page.locator('[data-workspace-dock="top"] .preview')).toBeVisible()
        await expect(
            page.locator('[data-workspace-dock="top"]').getByText('All Groups', { exact: true }),
        ).toBeVisible()
        const geometry = await readPreviewChrome(page)
        expect(geometry.settings.top).toBeGreaterThanOrEqual(geometry.preview.bottom)
        expect(geometry.settings.left).toBeGreaterThanOrEqual(0)
        expect(geometry.settings.right).toBeLessThanOrEqual(geometry.viewport.width)
        expect(geometry.settings.bottom).toBeLessThanOrEqual(geometry.viewport.height)
        expect(overlapArea(geometry.settings, geometry.preview)).toBe(0)
        expect(geometry.headerReachable).toBe(true)
        expect(geometry.transportReachable.every(Boolean)).toBe(true)
        const antialias = page.getByRole('checkbox', { name: 'Antialias', exact: true })
        await antialias.scrollIntoViewIfNeeded()
        await antialias.uncheck()
        await expect(antialias).not.toBeChecked()
    })

    test('rotating between docks remounts the preview cleanly without decoding again', async ({
        page,
    }) => {
        await page.evaluate(() => (window.editorTest.settings.showGroups = true))
        const requests = skinRequests(page)
        for (const [width, height, side] of [
            [430, 932, 'top'],
            [844, 390, 'left'],
            [1600, 1000, 'left'],
            [820, 1180, 'top'],
        ] as const) {
            await page.setViewportSize({ width, height })
            await expect(page.locator(`[data-workspace-dock="${side}"] .preview`)).toBeVisible()
            await settle(page)
        }
        // Uncaught observer loop errors would fail this test in afterEach.
        expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
        expect(requests).toEqual([])
    })

    test('hiding the time removes both clocks and the room kept for them', async ({ page }) => {
        await page.setViewportSize({ width: 820, height: 1180 })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'top'
            settings.topDockHeight = 520
            settings.previewControls = 'expanded'
        })
        await settle(page)
        const barTime = page.locator('.transport-time')
        await expect(barTime).toBeVisible()
        const strip = page.locator('.preview-transport')
        const shownWidth = (await strip.boundingBox())!.width
        const frames = await page.evaluate(() => window.previewTest.frames)

        const showTime = page.getByRole('checkbox', { name: 'Show Time', exact: true })
        await expect(showTime).toBeChecked()
        await showTime.uncheck()
        await expect(barTime).toHaveCount(0)
        await expect(page.locator('.transport-corner-time')).toHaveCount(0)
        expect(await page.evaluate(() => window.editorTest.settings.previewShowTime)).toBe(false)
        // The strip no longer keeps room for the time.
        await expect.poll(async () => (await strip.boundingBox())!.width).toBeLessThan(shownWidth)
        const geometry = await readPreviewChrome(page)
        expect(geometry.transportReachable.length).toBeGreaterThanOrEqual(4)
        expect(geometry.transportReachable.every(Boolean)).toBe(true)
        expect(geometry.headerReachable).toBe(true)
        // Hiding the clock needs no new preview frame.
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(frames)

        // A phone-width panel shows no clock either; with the time back, the strip
        // still has room for it beside six fine-pointer steppers.
        await page.setViewportSize({ width: 390, height: 844 })
        await settle(page)
        await expect(page.locator('.transport-corner-time')).toHaveCount(0)
        await showTime.check()
        await expect(barTime).toHaveText(/^\d{2}:\d{2}\.\d{3}$/)
        await expect(page.locator('.transport-corner-time')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Back 100 ms', exact: true })).toBeVisible()
    })

    for (const { width, height } of [
        { width: 1366, height: 768 },
        { width: 1024, height: 768 },
        { width: 1280, height: 500 },
    ]) {
        test(`settings never cover elevation editor controls at ${width}x${height}`, async ({
            page,
        }) => {
            await page.setViewportSize({ width, height })
            await page.evaluate(() => {
                const { settings } = window.editorTest
                settings.showGroups = true
                settings.previewControls = 'expanded'
            })
            for (const split of ['disallow', 'allow'] as const) {
                await page.evaluate((split) => {
                    window.editorTest.settings.elevationEditorSideBySide = split
                }, split)
                if (!(await page.locator('.elevation-editor').count()))
                    await page.keyboard.press('t')
                await expect(page.locator('.elevation-editor')).toBeVisible()
                await settle(page)
                await expect(page.locator('.preview-controls')).toBeVisible()
                for (const control of [
                    page.getByRole('spinbutton', { name: 'Beat', exact: true }),
                    page.getByRole('combobox', { name: 'Elevation Snapping', exact: true }),
                    page.getByRole('button', { name: 'Close Elevation Editor', exact: true }),
                ]) {
                    expect(
                        await control.evaluate((element) => {
                            const r = element.getBoundingClientRect()
                            return element.contains(
                                document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
                            )
                        }),
                    ).toBe(true)
                }
                const geometry = await readPreviewChrome(page)
                const header = (await page.locator('.elevation-header').boundingBox())!
                expect(
                    overlapArea(geometry.settings, {
                        left: header.x,
                        top: header.y,
                        right: header.x + header.width,
                        bottom: header.y + header.height,
                    }),
                ).toBe(0)
                expect(geometry.headerReachable).toBe(true)
            }
        })
    }

    test('the settings form follows its toggle in the tab order', async ({ page }) => {
        const toggle = page.locator('.preview-settings-toggle')
        await toggle.focus()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await page.keyboard.press('Tab')
        await expect(
            page.getByRole('button', { name: 'Minimize Preview Settings', exact: true }),
        ).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await expect(toggle).toBeFocused()
        // Leaving the end of the form continues after the toggle, not at the page end.
        await page.locator('.preview-controls select').last().focus()
        await page.keyboard.press('Tab')
        expect(
            await page.evaluate(() => {
                const active = document.activeElement
                return !!active && active !== document.body && !active.closest('.preview-controls')
            }),
        ).toBe(true)
        // Keyboard activation keeps focus on the toggle, which closes the form too.
        await toggle.press('Enter')
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await expect(toggle).toBeFocused()
        await toggle.press('Enter')
        await expect(page.locator('.preview-controls')).toBeVisible()
        await expect(toggle).toBeFocused()
    })

    test('a form outside the panel avoids the toolbar and closes on an outside press', async ({
        page,
    }) => {
        // Inside a roomy panel the form stays open while the editor is used.
        const editor = (await page.locator('canvas.editor-chart').boundingBox())!
        await page.mouse.click(editor.x + editor.width - 40, editor.y + 40)
        await expect(page.locator('.preview-controls')).toBeVisible()

        await page.setViewportSize({ width: 390, height: 844 })
        await page.evaluate(() => {
            window.editorTest.settings.previewPosition = 'top'
            window.editorTest.settings.previewControls = 'expanded'
        })
        await settle(page)
        const controls = page.locator('.preview-controls')
        await expect(controls).toBeVisible()
        const geometry = await readPreviewChrome(page)
        expect(geometry.settings.top).toBeGreaterThanOrEqual(geometry.preview.bottom)
        const toolbar = await page.evaluate(() => {
            const rects = [...document.querySelectorAll('[data-editor-toolbar] > *')].map(
                (element) => element.getBoundingClientRect(),
            )
            return {
                left: Math.min(...rects.map((rect) => rect.left)),
                top: Math.min(...rects.map((rect) => rect.top)),
                right: Math.max(...rects.map((rect) => rect.right)),
                bottom: Math.max(...rects.map((rect) => rect.bottom)),
            }
        })
        expect(overlapArea(geometry.settings, toolbar)).toBe(0)

        // Presses inside the form keep it open; one outside dismisses it.
        await controls.getByRole('radio', { name: '4:3', exact: true }).click()
        await expect(controls).toBeVisible()
        await page.mouse.click(4, geometry.settings.bottom + 8)
        await expect(controls).toBeHidden()
        await expect(
            page.getByRole('button', { name: 'Show Preview Settings', exact: true }),
        ).toBeVisible()
    })

    test('Below keeps the full strip and time under a short top preview', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 600 })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'top'
            settings.topDockHeight = 150
            settings.previewTransportPosition = 'below'
        })
        await settle(page)
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(page.locator('.preview-transport')).toBeVisible()
        await expect(page.locator('.transport-time')).toBeVisible()
        await expect(page.locator('.transport-corner-time')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Back 100 ms', exact: true })).toBeVisible()
        const geometry = await page.evaluate(() => {
            const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const strip = document.querySelector('.preview-transport')!.getBoundingClientRect()
            const preview = document.querySelector('.preview')!.getBoundingClientRect()
            return {
                gap: strip.top - image.bottom,
                center: strip.left + strip.width / 2 - (preview.left + preview.width / 2),
                imageCenter: image.left + image.width / 2 - (preview.left + preview.width / 2),
            }
        })
        expect(geometry.gap).toBeCloseTo(4, 1)
        expect(geometry.center).toBeCloseTo(0, 0)
        expect(geometry.imageCenter).toBeCloseTo(0, 0)
    })

    test('Auto moves the strip over the image the moment both no longer fit', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'top'
            settings.previewControls = 'collapsed'
            settings.topDockHeight = 300
        })
        await settle(page)
        const read = () =>
            page.evaluate(() => {
                const preview = document.querySelector('.preview')!.getBoundingClientRect()
                const image = document.querySelector('.preview-viewport')!.getBoundingClientRect()
                const strip = document.querySelector('.preview-transport')!.getBoundingClientRect()
                return {
                    overlay: !!document.querySelector('.preview-transport-toggle'),
                    image: {
                        top: image.top - preview.top,
                        width: image.width,
                        height: image.height,
                    },
                    stripTop: strip.top - preview.top,
                    stripBottom: strip.bottom - preview.top,
                }
            })
        const strip = page.getByRole('group', { name: 'Preview Playback Controls', exact: true })
        const roomy = await read()
        expect(roomy.overlay).toBe(false)
        // A 390 px image is 219.375 px tall; with the 52 px strip below it needs
        // 271.375 px, less a half-pixel allowance for rounded dock sizes.
        const fitted = { width: 390, height: 219.375 }
        for (const [height, overlay] of [
            [272, false],
            [270, true],
            [240, true],
            [272, false],
        ] as const) {
            await page.evaluate(
                (height) => (window.editorTest.settings.topDockHeight = height),
                height,
            )
            await settle(page)
            const layout = await read()
            expect(layout.overlay).toBe(overlay)
            // The image never shrinks or moves; only the strip changes place.
            expect(layout.image).toEqual({ top: layout.image.top, ...fitted })
            expect(layout.image.top).toBeLessThan(0.5)
            await expect(strip).toBeVisible()
            expect(layout.stripBottom).toBeLessThanOrEqual(height)
            if (!overlay)
                expect(layout.stripTop - layout.image.top).toBeCloseTo(fitted.height + 4, 1)
        }

        // Overlay keeps a visible strip in view, inside the image even in a tall panel.
        await page.evaluate(() => {
            window.editorTest.settings.topDockHeight = 400
            window.editorTest.settings.previewTransportPosition = 'overlay'
        })
        await settle(page)
        const overlay = await read()
        expect(overlay.overlay).toBe(true)
        await expect(strip).toBeVisible()
        expect(overlay.image.width).toBe(390)
        expect(overlay.stripBottom).toBeCloseTo(overlay.image.top + overlay.image.height - 4, 1)
        // Below brings back the strip below the image at its full size.
        await page.evaluate(() => (window.editorTest.settings.previewTransportPosition = 'below'))
        await settle(page)
        expect((await read()).overlay).toBe(false)
    })

    test('an automatically opened form closes instead of jumping out over the editor', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1920, height: 1080 })
        await settle(page)
        const controls = page.locator('.preview-controls')
        await expect(controls).toBeVisible()
        expect(await page.evaluate(() => window.editorTest.settings.previewControls)).toBe('auto')
        // Opening Groups below shrinks the panel so the form no longer fits inside.
        await page.keyboard.press('e')
        await expect(
            page.locator('[data-workspace-dock="left"]').getByText('All Groups', { exact: true }),
        ).toBeVisible()
        await expect(controls).toBeHidden()
        expect(await page.evaluate(() => window.editorTest.settings.previewControls)).toBe('auto')

        // Opened deliberately, it goes beside the dock at its full width.
        await page.getByRole('button', { name: 'Show Preview Settings', exact: true }).click()
        await expect(controls).toBeVisible()
        const geometry = await readPreviewChrome(page)
        expect(geometry.settings.left).toBeGreaterThanOrEqual(geometry.preview.right)
        expect(geometry.settings.right - geometry.settings.left).toBe(352)
        const label = (await controls
            .getByText('Highlight Selection', { exact: true })
            .boundingBox())!
        expect(label.height).toBeLessThan(24)
    })

    test('a short top dock scrolls its form under the dock rather than over the image', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 500 })
        await page.evaluate(() => {
            const { settings } = window.editorTest
            settings.previewPosition = 'top'
            settings.previewControls = 'expanded'
        })
        await settle(page)
        const geometry = await readPreviewChrome(page)
        expect(geometry.settings.top).toBeGreaterThanOrEqual(geometry.preview.bottom)
        expect(geometry.settings.bottom).toBeLessThanOrEqual(500)
        expect(geometry.headerReachable).toBe(true)
        const antialias = page.getByRole('checkbox', { name: 'Antialias', exact: true })
        await antialias.scrollIntoViewIfNeeded()
        await antialias.uncheck()
        await expect(antialias).not.toBeChecked()
    })

    test('a reopened preview appears in place without a jumping toggle or empty first frame', async ({
        page,
    }) => {
        await page.evaluate(() => (window.editorTest.settings.showPreview = false))
        await expect(page.locator('.preview')).toHaveCount(0)
        const frames = await page.evaluate(async () => {
            const samples: { image: number; gear?: string }[] = []
            window.editorTest.settings.showPreview = true
            for (let i = 0; i < 12; i++) {
                await new Promise((resolve) => requestAnimationFrame(resolve))
                const image = document.querySelector('.preview-viewport')
                const gear = document.querySelector<HTMLElement>('.preview-settings-toggle')
                const visible =
                    gear && getComputedStyle(gear).visibility !== 'hidden' && gear.offsetParent
                const box = gear?.getBoundingClientRect()
                samples.push({
                    image: image ? image.getBoundingClientRect().width : -1,
                    gear: visible && box ? `${box.left},${box.top}` : undefined,
                })
            }
            return samples
        })
        // Once mounted, the image is laid out from its first frame.
        expect(frames.filter(({ image }) => image === 0)).toEqual([])
        // The toggle is only ever shown at its final place.
        expect(new Set(frames.flatMap(({ gear }) => (gear ? [gear] : []))).size).toBe(1)
    })

    for (const { width, height, topDockHeight } of [
        { width: 400, height: 600, topDockHeight: 150 },
        { width: 480, height: 1000, topDockHeight: 180 },
        { width: 320, height: 700, topDockHeight: 140 },
        // Width-limited, with letterbox above and below the image.
        { width: 300, height: 1000, topDockHeight: 170 },
    ]) {
        test.describe(`on touch at ${width}x${height}`, () => {
            test.use({ hasTouch: true })
            test(`showing the strip on demand never moves the image at ${width}x${height}`, async ({
                page,
            }) => {
                await page.setViewportSize({ width, height })
                await page.evaluate((topDockHeight) => {
                    const { settings } = window.editorTest
                    settings.previewPosition = 'top'
                    settings.topDockHeight = topDockHeight
                    settings.previewControls = 'collapsed'
                }, topDockHeight)
                await settle(page)
                const toggle = page.locator('.preview-transport-toggle')
                await expect(toggle).toHaveCount(1)
                const image = () =>
                    page.evaluate(() => {
                        const { x, y, width, height } = document
                            .querySelector('.preview-viewport')!
                            .getBoundingClientRect()
                        return { x, y, width, height }
                    })
                const strip = page.locator('.preview-transport')
                if (await strip.isVisible()) {
                    await toggle.click({ position: { x: 12, y: 40 } })
                    await expect(strip).toBeHidden()
                }
                await settle(page)
                const hidden = await image()
                await toggle.click({ position: { x: 12, y: 40 } })
                await expect(strip).toBeVisible()
                await settle(page)
                expect(await image()).toEqual(hidden)
                await toggle.click({ position: { x: 12, y: 40 } })
                await expect(strip).toBeHidden()
                await settle(page)
                expect(await image()).toEqual(hidden)
            })
        })
    }

    test('editor visibility filters and focus never change the full-level preview', async ({
        page,
    }) => {
        await page.evaluate(() => (window.editorTest.view.cursorTime = 4))
        await settle(page)
        const before = await page.evaluate(() => ({
            frames: window.previewTest.frames,
            vertices: window.previewTest.vertices,
        }))
        expect(before.vertices.length).toBeGreaterThan(0)
        await page.evaluate(() => {
            const { view } = window.editorTest
            const hidden = (ids: number[]) => new Map(ids.map((id) => [id, 'hidden'])) as never
            view.groupVisibility = hidden([1, 2])
            view.stageVisibility = hidden([1, 2])
            view.groupId = 2 as never
            view.stageId = 2 as never
        })
        await settle(page)
        await page.waitForTimeout(100)
        expect(
            await page.evaluate(() => ({
                frames: window.previewTest.frames,
                vertices: window.previewTest.vertices,
            })),
        ).toEqual(before)
    })

    test('reopening the preview leaves no listeners, observers or contexts behind', async ({
        page,
    }) => {
        await page.evaluate(() => {
            const listeners = new Map<string, number>()
            const name = (target: EventTarget) =>
                target === window ? 'window' : target === document ? 'document' : 'visual'
            for (const target of [window, document, window.visualViewport!] as EventTarget[]) {
                const add = target.addEventListener.bind(target)
                const remove = target.removeEventListener.bind(target)
                const seen = new Set<unknown>()
                target.addEventListener = (
                    type: string,
                    listener: EventListenerOrEventListenerObject | null,
                    options?: boolean | AddEventListenerOptions,
                ) => {
                    const key = `${name(target)}:${type}`
                    if (listener && !seen.has(listener)) {
                        seen.add(listener)
                        listeners.set(key, (listeners.get(key) ?? 0) + 1)
                    }
                    add(type, listener, options)
                }
                target.removeEventListener = (
                    type: string,
                    listener: EventListenerOrEventListenerObject | null,
                    options?: boolean | EventListenerOptions,
                ) => {
                    const key = `${name(target)}:${type}`
                    if (seen.delete(listener)) listeners.set(key, (listeners.get(key) ?? 0) - 1)
                    remove(type, listener, options)
                }
            }
            const observed = new Map<ResizeObserver, Set<Element>>()
            const observe = ResizeObserver.prototype.observe
            ResizeObserver.prototype.observe = function (target, options) {
                observed.set(this, (observed.get(this) ?? new Set()).add(target))
                observe.call(this, target, options)
            }
            const disconnect = ResizeObserver.prototype.disconnect
            ResizeObserver.prototype.disconnect = function () {
                observed.delete(this)
                disconnect.call(this)
            }
            ;(window as unknown as { leakState: () => unknown }).leakState = () => ({
                listeners: Object.fromEntries([...listeners].filter(([, count]) => count)),
                observers: observed.size,
                canvases: document.querySelectorAll('.preview canvas').length,
                settings: document.querySelectorAll('.preview-controls').length,
            })
        })
        const cycle = async () => {
            await page.evaluate(() => (window.editorTest.settings.showPreview = false))
            await expect(page.locator('.preview')).toHaveCount(0)
            await page.evaluate(() => (window.editorTest.settings.showPreview = true))
            await expect(
                page.locator('.preview-controls').getByText('Note Speed', { exact: true }),
            ).toBeVisible()
            await settle(page)
        }
        const state = () =>
            page.evaluate(() => (window as unknown as { leakState: () => unknown }).leakState())
        await cycle()
        const first = await state()
        for (let i = 0; i < 8; i++) await cycle()
        expect(await state()).toEqual(first)
        // The preview still renders after many contexts were created and released.
        const frames = await page.evaluate(() => window.previewTest.frames)
        await page.evaluate(() => (window.editorTest.view.cursorTime += 0.25))
        await expect
            .poll(() => page.evaluate(() => window.previewTest.frames))
            .toBeGreaterThan(frames)
        expect(await page.evaluate(() => window.previewTest.bitmaps)).toBe(2)
    })
})
