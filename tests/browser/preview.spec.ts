import { expect, test, type Page } from '@playwright/test'
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

test.beforeEach(async ({ page }) => {
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
    await page.evaluate(() => (window.editorTest.settings.showPreview = true))
    const preview = page.locator('.preview')
    await expect(preview.getByText('Speed', { exact: true })).toBeVisible()
    await expect(preview.locator('input[type="number"]').first()).toHaveValue('10')
    await expect.poll(() => page.evaluate(() => window.previewTest.uploads)).toBe(2)
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.previewTest.errors), 'uncaught browser errors').toEqual(
        [],
    )
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
        expect(await controls.evaluate((panel) => panel.scrollHeight > panel.clientHeight)).toBe(
            true,
        )
        await antialias.scrollIntoViewIfNeeded()
        await expect(antialias).toBeInViewport()
        const speed = controls.locator('input[type="number"]').first()
        await speed.scrollIntoViewIfNeeded()
        await expect(speed).toBeInViewport()
    })
})
