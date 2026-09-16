import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type SaveMode =
    'picker' | 'create' | 'write' | 'abortPicker' | 'success' | 'missingAPI' | 'writeFailure'

declare global {
    interface Window {
        saveReview: {
            events: string[]
            held: boolean
            release: () => void
            downloads: { name: string; size: number }[]
            handle?: FileSystemFileHandle
            notificationId: number
        }
    }
}

const errors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const collected: string[] = []
    errors.set(page, collected)
    page.on('pageerror', (error) => collected.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(() => {
        window.saveReview = {
            events: [],
            held: false,
            release: () => {},
            downloads: [],
            notificationId: 0,
        }
        // FileSaver uses an existing saveAs implementation when available. Keep
        // production save logic, but record downloads without touching disk.
        Object.defineProperty(window, 'saveAs', {
            writable: true,
            value: (blob: Blob, name: string) => {
                window.saveReview.downloads.push({ name, size: blob.size })
            },
        })
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(({ page }) => {
    expect(errors.get(page)).toEqual([])
})

const installSave = (page: Page, mode: SaveMode) =>
    page.evaluate(async (mode) => {
        const { notification } = await import('/src/editor/notification.ts')
        const fixture = window.saveReview
        fixture.notificationId = notification.value.id
        const gate = async (phase: string) => {
            fixture.held = true
            await new Promise<void>((resolve) => (fixture.release = resolve))
            fixture.events.push(`released:${phase}`)
        }
        const writable = {
            async write(blob: Blob) {
                if (!blob.size) throw new Error('Expected serialized chart data')
                fixture.events.push('write')
                if (mode === 'write') await gate('write')
                if (mode === 'writeFailure')
                    throw new DOMException('Disk full', 'QuotaExceededError')
            },
            close() {
                fixture.events.push('close')
                return Promise.resolve()
            },
            abort() {
                fixture.events.push('abort')
                return Promise.resolve()
            },
        }
        const handle = {
            async createWritable() {
                fixture.events.push('create')
                if (mode === 'create') await gate('create')
                return writable
            },
        } as unknown as FileSystemFileHandle
        fixture.handle = handle
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value:
                mode === 'missingAPI'
                    ? undefined
                    : async () => {
                          fixture.events.push('picker')
                          if (mode === 'abortPicker') {
                              throw new DOMException('Picker dismissed', 'AbortError')
                          }
                          if (mode === 'picker') await gate('picker')
                          return handle
                      },
        })
        if (mode === 'create' || mode === 'write' || mode === 'writeFailure') {
            window.editorTest.history.setLevelDataHandle(handle)
        }
    }, mode)

for (const phase of ['picker', 'create', 'write'] as const) {
    test(`cancelling save while awaiting ${phase} prevents a commit or fallback download`, async ({
        page,
    }) => {
        await installSave(page, phase)
        await page.keyboard.press('p')
        await expect.poll(() => page.evaluate(() => window.saveReview.held)).toBe(true)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.evaluate(() => window.saveReview.release())
        await expect
            .poll(() => page.evaluate(() => window.saveReview.events))
            .toContain(phase === 'picker' ? 'released:picker' : 'abort')
        const result = await page.evaluate(async () => {
            const { notification } = await import('/src/editor/notification.ts')
            return {
                events: window.saveReview.events,
                downloads: window.saveReview.downloads,
                notificationChanged: notification.value.id !== window.saveReview.notificationId,
                handleRetained:
                    window.editorTest.history.levelDataHandle === window.saveReview.handle,
            }
        })
        expect(result.events).not.toContain('close')
        if (phase !== 'write') expect(result.events).not.toContain('write')
        expect(result.downloads).toEqual([])
        expect(result.notificationChanged).toBe(false)
        expect(result.handleRetained).toBe(phase !== 'picker')
    })
}

test('dismissing the native save picker does not download or report a saved chart', async ({
    page,
}) => {
    await installSave(page, 'abortPicker')
    await page.keyboard.press('p')
    await expect.poll(() => page.evaluate(() => window.saveReview.events)).toContain('picker')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const result = await page.evaluate(async () => {
        const { notification } = await import('/src/editor/notification.ts')
        return {
            downloads: window.saveReview.downloads,
            notificationChanged: notification.value.id !== window.saveReview.notificationId,
        }
    })
    expect(result).toEqual({ downloads: [], notificationChanged: false })
})

test('successful native save commits once and retains its handle', async ({ page }) => {
    await installSave(page, 'success')
    await page.keyboard.press('p')
    await expect.poll(() => page.evaluate(() => window.saveReview.events)).toContain('close')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => window.saveReview.events)).toEqual([
        'picker',
        'create',
        'write',
        'close',
    ])
    expect(await page.evaluate(() => window.saveReview.downloads)).toEqual([])
    expect(
        await page.evaluate(
            () => window.editorTest.history.levelDataHandle === window.saveReview.handle,
        ),
    ).toBe(true)
})

test('cancelling a pending native write preserves the previous file contents', async ({ page }) => {
    await page.evaluate(async () => {
        const directory = await navigator.storage.getDirectory()
        const handle = await directory.getFileHandle('cancelled-save.dat', { create: true })
        const initial = await handle.createWritable()
        await initial.write('previous chart')
        await initial.close()
        const fixture = window.saveReview
        window.editorTest.history.setLevelDataHandle({
            async createWritable() {
                const stream = await handle.createWritable()
                return {
                    async write(blob: Blob) {
                        await stream.write(blob)
                        fixture.held = true
                        await new Promise<void>((resolve) => (fixture.release = resolve))
                    },
                    async close() {
                        await stream.close()
                        fixture.events.push('close')
                    },
                    async abort() {
                        await stream.abort()
                        fixture.events.push('abort')
                    },
                }
            },
        } as unknown as FileSystemFileHandle)
    })
    await page.keyboard.press('p')
    await expect.poll(() => page.evaluate(() => window.saveReview.held)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.evaluate(() => window.saveReview.release())
    await expect.poll(() => page.evaluate(() => window.saveReview.events)).toEqual(['abort'])
    const contents = await page.evaluate(async () => {
        const directory = await navigator.storage.getDirectory()
        const handle = await directory.getFileHandle('cancelled-save.dat')
        const contents = await (await handle.getFile()).text()
        await directory.removeEntry('cancelled-save.dat')
        return contents
    })
    expect(contents).toBe('previous chart')
    expect(await page.evaluate(() => window.saveReview.downloads)).toEqual([])
})

for (const mode of ['missingAPI', 'writeFailure'] as const) {
    test(`save retains its download fallback for ${mode}`, async ({ page }) => {
        await installSave(page, mode)
        await page.keyboard.press('p')
        await expect.poll(() => page.evaluate(() => window.saveReview.downloads.length)).toBe(1)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        const result = await page.evaluate(() => ({
            events: window.saveReview.events,
            downloads: window.saveReview.downloads,
            hasHandle: !!window.editorTest.history.levelDataHandle,
        }))
        expect(result.downloads[0]!.size).toBeGreaterThan(0)
        expect(result.hasHandle).toBe(false)
        expect(result.events).toEqual(mode === 'writeFailure' ? ['create', 'write', 'abort'] : [])
    })
}
