import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resource } from '../browser/previewResourceFixture'
import { chart, instrumentRendering } from './fixtures'

test.use({ hasTouch: true })

const errors = new WeakMap<Page, string[]>()

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

test.beforeEach(async ({ page, browserName }, testInfo) => {
    const messages: string[] = []
    errors.set(page, messages)
    page.on('pageerror', (error) => messages.push(error.message))
    if (browserName === 'webkit' && process.platform === 'win32') {
        testInfo.annotations.push({
            type: 'coverage',
            description:
                'Windows WebKit lacks Web Audio; editor UI only, with audio initialization stubbed.',
        })
        await page.addInitScript(() => {
            class SilentAudioContext extends EventTarget {
                state = 'suspended'
                currentTime = 0
                sampleRate = 48000
                destination = {}
                async decodeAudioData() {
                    return {
                        duration: 0.1,
                        length: 4800,
                        sampleRate: 48000,
                        numberOfChannels: 1,
                        getChannelData: () => new Float32Array(4800),
                    }
                }
                async close() {}
            }
            Object.defineProperty(window, 'AudioContext', { value: SilentAudioContext })
        })
    }
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(() => {
        Object.defineProperty(window, 'showOpenFilePicker', {
            configurable: true,
            value: undefined,
        })
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: undefined,
        })
        for (const key of ['showPreview', 'showSidebar', 'autoSave'])
            localStorage.setItem(`sonolus-next-sekai-editor.${key}`, 'false')
        localStorage.setItem('sonolus-next-sekai-editor.pps', '120')
    })
    await page.addInitScript(instrumentRendering)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    )
    const opening = page.waitForEvent('filechooser')
    await page.keyboard.press('o')
    await (
        await opening
    ).setFiles({ name: 'compatibility.usc', mimeType: 'application/json', buffer: chart })
    await expect(page.locator('.notification')).toHaveText('Opened level')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('f')
    const bounds = await page.locator('canvas.editor-chart').boundingBox()
    if (!bounds) throw new Error('Missing editor canvas')
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 30)
})

test('production imports, scales through the touch menu, applies with Enter and saves', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTitle('Help', { exact: true }).tap()
    await page
        .getByTitle('Open Context Menu', { exact: true })
        .filter({ hasText: 'Open Context Menu' })
        .tap()
    await page.getByRole('menuitem', { name: 'Scale Width', exact: true }).tap()
    const factor = page.getByRole('spinbutton', { name: 'Scale factor' })
    await factor.fill('2')
    await factor.press('Enter')
    await expect(page.locator('.scaling-panel')).toHaveCount(0)
    const saving = page.waitForEvent('download')
    await page.keyboard.press('p')
    const path = testInfo.outputPath('compatibility.leveldata.gz')
    await (await saving).saveAs(path)
    const level = JSON.parse(gunzipSync(await readFile(path)).toString()) as {
        entities: { archetype: string; data: { name: string; value?: number }[] }[]
    }
    const note = level.entities.find((entity) => /Note$/.test(entity.archetype))
    expect(note).toBeDefined()
    expect(note!.data.find((field) => field.name === '#BEAT')?.value).toBe(0.25)
    expect(note!.data.find((field) => field.name === 'size')?.value).toBe(3)
})

test('elevation controls and menus fit portrait and landscape viewports', async ({
    page,
}, testInfo) => {
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Beat', exact: true })).toHaveValue('1.25')
    for (const viewport of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
    ]) {
        await page.setViewportSize(viewport)
        const close = page.getByRole('button', { name: 'Close Elevation Editor' })
        await expect(close).toBeVisible()
        const closeBounds = await close.boundingBox()
        expect(closeBounds!.y).toBeGreaterThanOrEqual(0)
        expect(closeBounds!.y + closeBounds!.height).toBeLessThanOrEqual(viewport.height)
        const toolbar = page.locator('section').filter({ has: page.locator('.elevation-canvas') })
        const utility = toolbar.getByTitle('Help', { exact: true })
        if (await utility.count()) await utility.tap()
        else await toolbar.getByTitle('Open Context Menu', { exact: true }).first().tap()
        await toolbar
            .getByTitle('Open Context Menu', { exact: true })
            .filter({ hasText: 'Open Context Menu' })
            .tap()
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        const bounds = await menu.boundingBox()
        expect(bounds!.y).toBeGreaterThanOrEqual(0)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
        await page.keyboard.press('Escape')
    }
    await page.screenshot({ path: testInfo.outputPath('compatibility-landscape.png') })
})

test('note rendering works when roundRect is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(CanvasRenderingContext2D.prototype, 'roundRect', {
            configurable: true,
            value: undefined,
        })
    })
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const opening = page.waitForEvent('filechooser')
    await page.keyboard.press('o')
    await (
        await opening
    ).setFiles({ name: 'fallback.usc', mimeType: 'application/json', buffer: chart })
    await expect(page.locator('.notification')).toHaveText('Opened level')
    const pixels = await page
        .locator('canvas.editor-chart')
        .evaluate((canvas: HTMLCanvasElement) => {
            const ctx = canvas.getContext('2d')!
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            let colored = 0
            for (let i = 0; i < data.length; i += 4)
                if (data[i + 3]! > 0 && (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]))
                    colored++
            return colored
        })
    expect(pixels).toBeGreaterThan(10)
})

test('preview decodes textures and renders after opening and resizing', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.productionSmoke.uploads)).toBe(2)
    const frames = await page.evaluate(() => window.productionSmoke.preview)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
        .poll(() => page.evaluate(() => window.productionSmoke.preview))
        .toBeGreaterThan(frames)
    await expect(page.locator('.preview-viewport')).toBeVisible()
})

test('internal copy and paste survive denied browser clipboard permissions', async ({
    page,
}, testInfo) => {
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
                writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
            },
        })
    })
    await page.keyboard.press('c')
    await page.keyboard.press('v')
    const bounds = await page.locator('canvas.editor-chart').boundingBox()
    if (!bounds) throw new Error('Missing editor canvas')
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 90)
    const saving = page.waitForEvent('download')
    await page.keyboard.press('p')
    const path = testInfo.outputPath('clipboard.leveldata.gz')
    await (await saving).saveAs(path)
    const level = JSON.parse(gunzipSync(await readFile(path)).toString()) as {
        entities: { archetype: string }[]
    }
    expect(level.entities.filter((entity) => /Note$/.test(entity.archetype))).toHaveLength(2)
})
