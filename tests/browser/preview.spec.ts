import { expect, test, type Locator, type Page } from '@playwright/test'
import { SkinSpriteName } from '@sonolus/core'
import { gzipSync } from 'node:zlib'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Tiny in-memory packages keep these tests independent of optional local skins.
const archive = (entries: Record<string, Buffer>) => {
    const local: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const [name, data] of Object.entries(entries)) {
        const filename = Buffer.from(name)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt32LE(data.length, 18)
        header.writeUInt32LE(data.length, 22)
        header.writeUInt16LE(filename.length, 26)
        local.push(header, filename, data)

        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50, 0)
        directory.writeUInt32LE(data.length, 20)
        directory.writeUInt32LE(data.length, 24)
        directory.writeUInt16LE(filename.length, 28)
        directory.writeUInt32LE(offset, 42)
        central.push(directory, filename)
        offset += header.length + filename.length + data.length
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(Object.keys(entries).length, 8)
    end.writeUInt16LE(Object.keys(entries).length, 10)
    end.writeUInt32LE(
        central.reduce((length, part) => length + part.length, 0),
        12,
    )
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...local, ...central, end])
}

const texture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
    'base64',
)
const resource = (kind: 'skins' | 'particles') =>
    archive({
        [`sonolus/${kind}/list`]: Buffer.from(
            JSON.stringify({
                items: [
                    {
                        name: 'fixture',
                        title: 'Fixture',
                        data: { url: '/data' },
                        texture: { url: '/texture' },
                    },
                ],
            }),
        ),
        data: gzipSync(
            JSON.stringify({
                width: 1,
                height: 1,
                interpolation: true,
                effects: [],
                sprites:
                    kind === 'particles'
                        ? []
                        : Object.values(SkinSpriteName).map((name) => ({
                              name,
                              x: 0,
                              y: 0,
                              w: 1,
                              h: 1,
                              transform: Object.fromEntries(
                                  ['x1', 'x2', 'x3', 'x4', 'y1', 'y2', 'y3', 'y4'].map((key) => [
                                      key,
                                      { [key]: 1 },
                                  ]),
                              ),
                          })),
            }),
        ),
        texture,
    })

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
    if (transport) await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
    await page.route('**/resource/skin.scp', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp', (route) =>
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
        WebGLRenderingContext.prototype.texImage2D = function (...args) {
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
        window.createImageBitmap = async (...args) => {
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
            window.editorTest.settings.previewHeight = 200
        }
        window.editorTest.settings.showPreview = true
    }, transport)
    const preview = page.locator('.preview')
    if (transport)
        await preview.getByRole('button', { name: 'Show preview settings', exact: true }).click()
    await expect(preview.getByText('Speed', { exact: true })).toBeVisible()
    await expect(preview.locator('input[type="number"]').first()).toHaveValue('10')
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(2)
    await settle(page)
    if (transport) await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'))
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.previewTest.errors), 'uncaught browser errors').toEqual(
        [],
    )
})

test.describe('preview transport', () => {
    test.use({ hasTouch: true })

    const cursor = (page: Page) => page.evaluate(() => window.editorTest.view.cursorTime)
    const wheel = (page: Page, init: WheelEventInit, selector = '.preview-transport-toggle') =>
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
        await page.getByRole('button', { name: 'Minimize preview settings', exact: true }).tap()
        await page.getByRole('button', { name: 'Show playback controls', exact: true }).tap()
        await expect(
            page.getByRole('group', { name: 'Preview playback controls', exact: true }),
        ).toBeVisible()
        await page.evaluate(() => {
            window.editorTest.settings.playFollow = false
            window.editorTest.settings.playPreviewDuration = 0
        })
        // Vue ignores bubbling events timestamped at/before listener creation.
        // Advance past the panel's mount before sending native keyboard events.
        await page.clock.runFor(1)
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
                page.getByRole('button', { name: 'Play preview', exact: true }),
            ).toBeVisible()
            await page.keyboard.down(key) // native repeat must not add another tap
            await page.keyboard.up(key)
            expect(await cursor(page)).toBe(before + 0.01)
            await expect(
                page.getByRole('button', { name: 'Play preview', exact: true }),
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
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await page.getByRole('button', { name: 'Show preview settings', exact: true }).click()
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
        await page.getByRole('button', { name: 'Play preview', exact: true }).click()
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await page.clock.runFor(3500)
        await expect(
            page.getByRole('button', { name: 'Show playback controls', exact: true }),
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
        await page.getByRole('button', { name: 'Show playback controls', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible()
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
                    .getByRole('button', { name: 'Hide playback controls', exact: true })
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
        await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible()
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
        await page.getByRole('button', { name: 'Play preview', exact: true }).click()
        await page.clock.runFor(500)
        expect(await cursor(page)).toBeGreaterThan(3.3)
        expect(await cursor(page)).toBeLessThan(3.5)
        await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
        const paused = await cursor(page)
        await page.clock.runFor(500)
        expect(await cursor(page)).toBe(paused)

        await page.getByRole('button', { name: 'Play preview', exact: true }).click()
        await page.clock.runFor(3500)
        await expect(
            page.getByRole('group', { name: 'Preview playback controls', exact: true }),
        ).toBeVisible()
        const pause = page.getByRole('button', { name: 'Pause preview', exact: true })
        await pause.focus()
        await page.clock.runFor(3500)
        await expect(pause).toBeFocused()
        await pause.press('Escape')
        await expect(
            page.getByRole('button', { name: 'Show playback controls', exact: true }),
        ).toBeFocused()
        await expect(page.locator('.preview-transport')).toBeHidden()
        await expect(page.locator('.preview-transport')).toHaveAttribute('inert', '')
        await expect(page.locator('.preview-transport')).toHaveAttribute('aria-hidden', 'true')
        const hiddenTime = await page.locator('.transport-time').textContent()
        await page.clock.runFor(3500)
        expect(await page.locator('.transport-time').textContent()).toBe(hiddenTime)
        await page.getByRole('button', { name: 'Show playback controls', exact: true }).click()
        await page.clock.runFor(3500)
        await expect(
            page.getByRole('group', { name: 'Preview playback controls', exact: true }),
        ).toBeVisible()
    })

    test('wrapping a hidden bar does not dock with its previous height', async ({ page }) => {
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await page.setViewportSize({ width: 390, height: 1000 })
        await page.evaluate(() => (window.editorTest.settings.previewHeight = 240))
        await page.clock.runFor(32)
        const panel = page.locator('.preview-transport')
        await expect(panel).toBeHidden()

        // The narrow image leaves 82.5 px spare. A stale 44 px bar would appear
        // to fit, but the wrapped 82 px bar needs 90 px including its margins.
        await page.setViewportSize({ width: 280, height: 1000 })
        await page.clock.runFor(32)
        await expect.poll(() => panel.evaluate((element) => element.clientHeight)).toBe(82)
        await expect(panel).toBeHidden()
        await expect(
            page.getByRole('button', { name: 'Show playback controls', exact: true }),
        ).toBeVisible()

        await page.evaluate(() => (window.editorTest.settings.previewHeight = 300))
        await page.clock.runFor(32)
        await expect(panel).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await page.setViewportSize({ width: 390, height: 1000 })
        await page.clock.runFor(32)
        await expect.poll(() => panel.evaluate((element) => element.clientHeight)).toBe(44)
        await expect(panel).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
    })

    test('space below the viewport shows persistent controls without a tap', async ({ page }) => {
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await expect(page.locator('.preview-transport')).toBeHidden()
        await page.setViewportSize({ width: 600, height: 1000 })
        await page.evaluate(() => (window.editorTest.settings.previewHeight = 500))
        await page.clock.runFor(32)
        const panel = page.getByRole('group', { name: 'Preview playback controls', exact: true })
        await expect(panel).toBeVisible()
        await expect(page.locator('.preview-transport-toggle')).toHaveCount(0)
        await expect(
            page.getByRole('button', { name: 'Show preview settings', exact: true }),
        ).toBeVisible()
        const geometry = await page.evaluate(() => {
            const viewport = document.querySelector('.preview-viewport')!.getBoundingClientRect()
            const bar = document.querySelector('.preview-transport')!.getBoundingClientRect()
            const preview = document.querySelector('.preview')!.getBoundingClientRect()
            return { gap: bar.top - viewport.bottom, bottom: preview.bottom - bar.bottom }
        })
        expect(geometry.gap).toBeCloseTo(4, 1)
        expect(geometry.bottom).toBeGreaterThanOrEqual(3.9)
        const play = page.getByRole('button', { name: 'Play preview', exact: true })
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

        // Losing docking space must not hide controls that were already visible.
        await page.evaluate(() => (window.editorTest.settings.previewHeight = 200))
        await page.clock.runFor(32)
        await expect(panel).toBeVisible()
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await expect(panel).toBeHidden()
    })
})

test('preview restores lost contexts, uploads each atlas once and releases decoded resources', async ({
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

    await preview.getByText('Antialias', { exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(6)
    expect(await page.evaluate(() => window.previewTest.closes)).toBe(0)
    await page.evaluate(() => (window.editorTest.settings.showPreview = false))
    await expect(preview).toHaveCount(0)
    expect(await page.evaluate(() => window.previewTest.closes)).toBe(2)
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
    expect(await page.evaluate(() => window.previewTest.frames)).toBe(selectionFrames)
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
    await page.locator('.preview').getByText('Antialias', { exact: true }).click()
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

test.describe('preview aspect ratios', () => {
    test.use({ deviceScaleFactor: 1.25 })

    const expectViewport = async (page: Page, ratio: number) => {
        const dimensions = await page.evaluate(() => {
            const container = document.querySelector<HTMLElement>('.preview')!
            const viewport = document.querySelector<HTMLElement>('.preview-viewport')!
            const canvas = viewport.querySelector('canvas')!
            const box = (element: HTMLElement) => {
                const { x, y, width, height } = element.getBoundingClientRect()
                return { x, y, width, height }
            }
            return {
                container: box(container),
                viewport: box(viewport),
                canvas: box(canvas),
                styleWidth: Number.parseFloat(viewport.style.width),
                styleHeight: Number.parseFloat(viewport.style.height),
                backingWidth: canvas.width,
                backingHeight: canvas.height,
                aspect: window.previewTest.aspect,
                pixelRatio: devicePixelRatio,
            }
        })
        const expectedWidth = Math.min(
            dimensions.container.width,
            dimensions.container.height * ratio,
        )
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
                    (dimensions.container.x + dimensions.container.width / 2),
            ),
        ).toBeLessThan(0.03)
        expect(
            Math.abs(
                dimensions.viewport.y +
                    dimensions.viewport.height / 2 -
                    (dimensions.container.y + dimensions.container.height / 2),
            ),
        ).toBeLessThan(0.03)
        expect(dimensions.aspect).toBeCloseTo(ratio, 10)
        expect(dimensions.pixelRatio).toBe(1.25)
        return dimensions
    }

    test('presets fit and center the selected viewport through resize without idle drawing', async ({
        page,
    }) => {
        const group = page.getByRole('radiogroup', { name: 'Aspect ratio' })
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
                await expectViewport(page, ratio)
            }
        }
        // The top panel fits by height, unlike the width-limited left panel.
        await page.evaluate(() => (window.editorTest.settings.previewPosition = 'top'))
        await settle(page)
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        for (const [label, ratio] of [
            ['16:9', 16 / 9],
            ['21:9', 21 / 9],
            ['4:3', 4 / 3],
        ] as const) {
            await group.getByRole('radio', { name: label, exact: true }).check()
            await settle(page)
            await expectViewport(page, ratio)
        }
        const frames = await page.evaluate(() => window.previewTest.frames)
        await page.waitForTimeout(150)
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(frames)
        expect(await page.evaluate(() => window.previewTest.uploads)).toBe(uploads)
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
        await page.getByRole('radio', { name: '21:9', exact: true }).check()
        await settle(page)
        const original = await expectViewport(page, 21 / 9)
        const vertices = await page.evaluate(() => window.previewTest.vertices)
        const quality = page.locator('.preview input[type="number"]').nth(1)
        await quality.fill('0.25')
        await quality.press('Tab')
        await settle(page)
        const reduced = await expectViewport(page, 21 / 9)
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
        for (const name of ['Effects', 'Antialias']) {
            const checkbox = controls.getByLabel(name, { exact: true })
            await checkbox.focus()
            await checkbox.press('Space')
            await expect(checkbox).not.toBeChecked()
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
        await expectViewport(page, 4 / 3)
        expect(await page.evaluate(() => window.previewTest.frames)).toBe(before.frames + 1)
        expect(await page.evaluate(() => window.previewTest.uploads)).toBe(before.uploads)
    })

    test('controls stay within narrow panels and scroll into view in short top panels', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1069, height: 733 })
        await page.getByRole('radio', { name: '21:9', exact: true }).check()
        await settle(page)
        const controls = page.locator('.preview-controls')
        const antialias = controls.getByLabel('Antialias', { exact: true })
        await expect(antialias).toBeInViewport()
        expect(
            await controls.evaluate((panel) => {
                const container = panel.parentElement!.getBoundingClientRect()
                const bounds = panel.getBoundingClientRect()
                return (
                    bounds.left >= container.left &&
                    bounds.right <= container.right &&
                    bounds.top >= container.top &&
                    bounds.bottom <= container.bottom &&
                    panel.scrollWidth <= panel.clientWidth &&
                    [...panel.querySelectorAll('input, span')].every((element) => {
                        const rect = element.getBoundingClientRect()
                        return rect.left >= bounds.left && rect.right <= bounds.right
                    })
                )
            }),
        ).toBe(true)

        await page.evaluate(() => {
            window.editorTest.settings.previewPosition = 'top'
            window.editorTest.settings.previewHeight = 80
        })
        await page.setViewportSize({ width: 1069, height: 400 })
        await settle(page)
        await page
            .getByRole('button', { name: 'Hide playback controls', exact: true })
            .click({ position: { x: 12, y: 12 } })
        await expect(antialias).toBeInViewport()
        await antialias.uncheck()
        await expect(antialias).not.toBeChecked()

        // Even when the window itself is short, the header remains reachable
        // and only the settings body scrolls.
        await page.setViewportSize({ width: 1069, height: 128 })
        await settle(page)
        expect(
            await controls
                .locator('.preview-controls-body')
                .evaluate((panel) => panel.scrollHeight > panel.clientHeight),
        ).toBe(true)
        await antialias.scrollIntoViewIfNeeded()
        await expect(antialias).toBeInViewport()
        await antialias.check()
        await expect(antialias).toBeChecked()
        const speed = controls.locator('input[type="number"]').first()
        await speed.scrollIntoViewIfNeeded()
        await expect(speed).toBeInViewport()
    })
})
