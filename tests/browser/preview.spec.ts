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
            errors: [],
        }
        window.addEventListener('error', (event) => window.previewTest.errors.push(event.message))
        const upload = WebGLRenderingContext.prototype.texImage2D
        WebGLRenderingContext.prototype.texImage2D = function (...args) {
            if (args.some((arg) => arg instanceof ImageBitmap)) window.previewTest.uploads++
            return Reflect.apply(upload, this, args)
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
    await page.mouse.click(start.x, start.y)
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
