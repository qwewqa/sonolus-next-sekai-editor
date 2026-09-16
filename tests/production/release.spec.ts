import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { chart, instrumentRendering, stereoWav } from './fixtures'

const siteUrl = new URL(
    process.env.PRODUCTION_SITE_URL ?? 'https://next-sekai-editor-test.qwewqa.xyz/',
).href

const frames = (page: Page) =>
    page.evaluate(() => ({
        preview: window.productionSmoke.preview,
        chart: window.productionSmoke.chart,
        overlay: window.productionSmoke.overlay,
    }))

test('release assets, preview, chart editing and FFT audio work in the production bundle', async ({
    page,
}, testInfo) => {
    const errors: string[] = []
    const requests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
    })
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
    })
    page.on('requestfailed', (request) =>
        errors.push(`${request.failure()?.errorText}: ${request.url()}`),
    )
    page.on('request', (request) => requests.push(request.url()))
    await page.addInitScript(instrumentRendering)
    await page.goto('/')

    await test.step('load actual release packages and deployed metadata', async () => {
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await expect(page.locator('.preview-controls')).toBeVisible()
        await expect(page.locator('.preview input[type="number"]').first()).toHaveValue('10')
        await expect.poll(() => page.evaluate(() => window.productionSmoke.uploads)).toBe(2)
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', siteUrl)
        await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
            'content',
            new URL('thumbnail.png', siteUrl).href,
        )
        const images = await page.evaluate(async () => {
            const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href
            return await Promise.all(
                [icon, new URL('thumbnail.png', location.href).href].map(async (url) => {
                    const response = await fetch(url)
                    return { status: response.status, type: response.headers.get('content-type') }
                }),
            )
        })
        for (const image of images) {
            expect(image.status).toBe(200)
            expect(image.type).toMatch(/^image\//)
        }
    })

    await test.step('fit all aspect ratios through a viewport resize', async () => {
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
                await page.getByRole('radio', { name: label, exact: true }).check()
                await expect
                    .poll(() =>
                        page.locator('.preview-viewport').evaluate((element) => {
                            const viewport = element as HTMLElement
                            return (
                                Number.parseFloat(viewport.style.width) /
                                Number.parseFloat(viewport.style.height)
                            )
                        }),
                    )
                    .toBeCloseTo(ratio, 4)
            }
        }
        await page.setViewportSize({ width: 1600, height: 1000 })
    })

    await test.step('use preview transport at a mobile viewport size', async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        const show = page.getByRole('button', { name: 'Show playback controls', exact: true })
        if (await show.isVisible()) await show.click()
        const position = page.locator('[aria-label="Preview time"]:visible')
        await expect(position).toHaveCount(1)
        await expect(position).toHaveText('00:00.000')
        await page.getByRole('button', { name: 'Forward 1 ms', exact: true }).click()
        await expect(position).toHaveText('00:00.001')
        await page.getByRole('button', { name: 'Back 100 ms', exact: true }).click()
        await expect(position).toHaveText('00:00.000')
        await page.getByRole('button', { name: 'Hide playback controls', exact: true }).click({
            position: { x: 12, y: 12 },
        })
        await expect(page.getByRole('button', { name: 'Show preview settings' })).toBeVisible()
        await page.setViewportSize({ width: 1600, height: 1000 })
    })

    await test.step('import a chart and real stereo audio through file choosers', async () => {
        const opening = page.waitForEvent('filechooser')
        await page.keyboard.press('o')
        await (
            await opening
        ).setFiles({
            name: 'production.usc',
            mimeType: 'application/json',
            buffer: chart,
        })
        await expect(page.locator('.notification')).toHaveText('Opened level')
        await expect(page.getByRole('dialog')).toHaveCount(0)

        await page.keyboard.press(',')
        const settings = page.getByRole('dialog')
        await expect(settings).toHaveCount(1)
        await settings
            .locator('select')
            .filter({ has: page.locator('option[value="fft"]') })
            .selectOption('fft')
        await page.keyboard.press('Escape')
        await expect(settings).toHaveCount(0)

        await page.keyboard.press('m')
        const modal = page.getByRole('dialog')
        await expect(modal).toHaveCount(1)
        const file = modal.locator('input[type="button"]')
        const choosing = page.waitForEvent('filechooser')
        await file.click()
        await (
            await choosing
        ).setFiles({
            name: 'production-stereo.wav',
            mimeType: 'audio/wav',
            buffer: stereoWav(),
        })
        await expect(file).toHaveValue(/^00:02/)
        await modal.getByRole('button', { name: 'Confirm', exact: true }).click()
        await expect(modal).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => window.productionSmoke.fftTiles)).toBe(1)
        await expect
            .poll(() => page.evaluate(() => window.productionSmoke.fftDraws))
            .toBeGreaterThan(0)
    })

    await test.step('select, edit and save the imported note', async () => {
        const bounds = await page.locator('.editor').boundingBox()
        expect(bounds).not.toBeNull()
        // Preview Follow can pan the timeline during the transport smoke above.
        // Return to its start through real input before using chart coordinates.
        await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
        await page.mouse.wheel(0, 10000)
        await page.waitForTimeout(350) // Allow the editor's 250 ms scroll easing to finish.
        // Default 1000 pixels/s and imported BPM 60 put beat 1/4 above time zero.
        await page.keyboard.press('f')
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 - 250)
        const lane = page.getByLabel('Lane', { exact: true })
        await expect(lane).toHaveValue('-1.5')
        await lane.fill('2')
        await lane.press('Tab')
        await expect(lane).toHaveValue('2')
        await page.mouse.click(bounds!.x + bounds!.width - 15, bounds!.y + bounds!.height - 15)

        const downloading = page.waitForEvent('download')
        await page.keyboard.press('p')
        const download = await downloading
        const saved = testInfo.outputPath('smoke.leveldata.gz')
        await download.saveAs(saved)
        const level = JSON.parse(gunzipSync(await readFile(saved)).toString()) as {
            entities: { archetype: string; data: { name: string; value?: number }[] }[]
        }
        const notes = level.entities.filter((entity) => /Note$/.test(entity.archetype))
        expect(notes).toHaveLength(1)
        expect(notes[0]!.archetype).toBe('NormalTapNote')
        expect(notes[0]!.data).toEqual(
            expect.arrayContaining([
                { name: '#BEAT', value: 0.25 },
                { name: 'lane', value: 3.5 },
                { name: 'size', value: 1.5 },
            ]),
        )
        await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    await test.step('play, pause and suspend rendering when the window blurs', async () => {
        await page.keyboard.press('Space')
        await expect(page.locator('.preview-controls')).toHaveCount(0)
        const playing = await frames(page)
        await expect.poll(async () => (await frames(page)).preview).toBeGreaterThan(playing.preview)
        await page.keyboard.press('Space')
        await expect(page.locator('.preview-controls')).toBeVisible()
        await page.mouse.move(1, 1)
        // Activity labels have a deliberate 500 ms expiry; allow their final draw.
        await page.waitForTimeout(750)
        const paused = await frames(page)
        await page.waitForTimeout(300)
        expect(await frames(page)).toEqual(paused)

        // Browser focus events exercise the bundled lifecycle, with no app hooks.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
            window.dispatchEvent(new Event('blur'))
        })
        await expect(page.locator('html')).toHaveAttribute('data-app-inactive', '')
        await page.getByRole('radio', { name: '21:9', exact: true }).check()
        await page.waitForTimeout(150)
        expect(await frames(page)).toEqual(paused)
        await page.evaluate(() => {
            Reflect.deleteProperty(document, 'hasFocus')
            window.dispatchEvent(new Event('focus'))
        })
        await expect(page.locator('html')).not.toHaveAttribute('data-app-inactive')
        await expect.poll(async () => (await frames(page)).preview).toBeGreaterThan(paused.preview)
    })

    expect(errors, 'browser, console and asset errors').toEqual([])
    expect(requests.some((url) => new URL(url).pathname.startsWith('/src/'))).toBe(false)
    expect(requests.some((url) => new URL(url).pathname === '/resource/skin.scp')).toBe(true)
    expect(requests.some((url) => new URL(url).pathname === '/resource/particle.scp')).toBe(true)
    expect(requests.some((url) => new URL(url).pathname.endsWith('.mp3'))).toBe(true)
    expect(requests.some((url) => /\/assets\/bg-.*\.png$/.test(new URL(url).pathname))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('production.png'), fullPage: true })
})
