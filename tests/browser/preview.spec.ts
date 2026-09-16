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
                        : [SkinSpriteName.Lane, SkinSpriteName.JudgmentLine].map((name) => ({
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

test('preview restores lost contexts, uploads each atlas once and releases decoded resources', async ({
    page,
}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/resource/skin.scp', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.previewTest = { uploads: 0, frames: 0, bitmaps: 0, closes: 0 }
        const upload = WebGLRenderingContext.prototype.texImage2D
        WebGLRenderingContext.prototype.texImage2D = function (...args) {
            if (args.some((arg) => arg instanceof ImageBitmap)) window.previewTest.uploads++
            return Reflect.apply(upload, this, args)
        }
        const clear = WebGLRenderingContext.prototype.clear
        WebGLRenderingContext.prototype.clear = function (...args) {
            window.previewTest.frames++
            return clear.apply(this, args)
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
    expect(errors, 'uncaught browser errors').toEqual([])
})
