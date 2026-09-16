import { expect, test, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        loadingReview: {
            held: boolean
            release: () => void
            completed: number
            downloadUrls: string[]
            errors: string[]
        }
    }
}

// Hold the existing import/restoration delay rather than relying on the user
// winning a timing race. Releasing it resumes the real task after cancellation.
const holdPreparation = () => {
    const original = window.setTimeout
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== 50) return original(handler, delay, ...args)
        window.loadingReview.held = true
        window.loadingReview.release = () => {
            window.setTimeout = original
            window.loadingReview.held = false
            if (typeof handler === 'function') handler(...args)
        }
        return 0
    }) as typeof setTimeout
}

const openUtility = async (page: Page, name: 'coverEditor' | 'previewEditor') => {
    await page.evaluate(async (name) => {
        const { showModal } = await import('/src/modals/index.ts')
        const { default: component } =
            name === 'coverEditor'
                ? await import('/src/editor/utilities/coverEditor/CoverEditorModal.vue')
                : await import('/src/editor/utilities/previewEditor/PreviewEditorModal.vue')
        void showModal(component, {})
    }, name)
    await expect(page.getByRole('dialog')).toHaveCount(1)
}

const chooseFile = async (page: Page, name: string, mimeType: string, buffer: Buffer) => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('dialog').first().locator('input[type="button"]').click()
    await (await chooser).setFiles({ name, mimeType, buffer })
}

const cover = (width: number, height: number) =>
    Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="red"/></svg>`,
    )

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        window.loadingReview = {
            held: false,
            release() {},
            completed: 0,
            downloadUrls: [],
            errors: [],
        }
        window.addEventListener('error', (event) => window.loadingReview.errors.push(event.message))
        window.addEventListener('unhandledrejection', (event) =>
            window.loadingReview.errors.push(String(event.reason)),
        )

        const moduleUrls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { watch } = await import(moduleUrls.get('/node_modules/.vite/deps/vue.js')!)
        const { modals } = await import(moduleUrls.get('/src/modals/index.ts')!)
        const wrapped = new WeakSet<object>()
        // Observe completion of the actual generator, including its delayed
        // final step. An unchanged field before that step would be a false pass.
        watch(
            () => modals.length,
            () => {
                for (const modal of modals) {
                    const props = modal.props as {
                        task?: (signal: AbortSignal) => AsyncIterable<() => string>
                    }
                    if (!props.task || wrapped.has(props)) continue
                    wrapped.add(props)
                    const task = props.task
                    props.task = async function* (signal) {
                        try {
                            yield* task(signal)
                        } finally {
                            window.loadingReview.completed++
                        }
                    }
                }
            },
            { flush: 'sync' },
        )
        const createUrl = URL.createObjectURL
        URL.createObjectURL = (blob) => {
            const url = createUrl.call(URL, blob)
            window.loadingReview.downloadUrls.push(url)
            return url
        }
    })
})

test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => window.loadingReview.errors)).toEqual([])
})

for (const command of ['open', 'autosave'] as const) {
    test(`cancelled ${command} cannot replace edits made after its dialog is dismissed`, async ({
        page,
    }) => {
        const data = await page.evaluate(async () => {
            const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
            const state = window.editorTest.history.state.value
            return serializeToLevelData(
                state.initialLife,
                state.isDynamicStages,
                state.bgm.offset,
                state.store,
                state.groups,
                state.stages,
            )
        })
        await page.evaluate(holdPreparation)
        await page.evaluate(
            async ({ command, bytes, data }) => {
                if (command === 'open') {
                    const { open } = await import('/src/editor/commands/open/index.ts')
                    const file = new File([new Uint8Array(bytes)], 'incoming.gz', {
                        type: 'application/octet-stream',
                    })
                    window.showOpenFilePicker = async () =>
                        [{ getFile: async () => file }] as FileSystemFileHandle[]
                    void open.execute()
                } else {
                    const { serializeAutoSave } = await import('/src/history/autoSave/serialize.ts')
                    const { storageSet } = await import('/src/storage.ts')
                    const { useAutoSave } = await import('/src/history/autoSave/index.ts')
                    storageSet('autoSave.levelData', serializeAutoSave(data, 'incoming'))
                    useAutoSave()
                }
            },
            { command, bytes: [...gzipSync(JSON.stringify(data))], data },
        )
        await expect.poll(() => page.evaluate(() => window.loadingReview.held)).toBe(true)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.evaluate(() => {
            const { history } = window.editorTest
            history.pushState(() => 'Later edit', {
                ...history.state.value,
                filename: 'later-edit',
            })
            window.loadingReview.release()
        })
        await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(1)
        expect(
            await page.evaluate(() => ({
                filename: window.editorTest.history.state.value.filename,
                canUndo: window.editorTest.history.canUndo.value,
            })),
        ).toEqual({ filename: 'later-edit', canUndo: true })
    })
}

test('cancelled cover decoding cannot replace a newer selected image', async ({ page }) => {
    await page.evaluate(() => {
        const OriginalImage = window.Image
        window.Image = function (width?: number, height?: number) {
            const image = new OriginalImage(width, height)
            const hold = (event: Event) => {
                if (image.width !== 11) return
                event.stopImmediatePropagation()
                window.loadingReview.held = true
                window.loadingReview.release = () => {
                    window.loadingReview.held = false
                    image.removeEventListener('load', hold)
                    image.dispatchEvent(new Event('load'))
                }
            }
            image.addEventListener('load', hold)
            return image
        } as typeof Image
    })
    await openUtility(page, 'coverEditor')
    await chooseFile(page, 'old.svg', 'image/svg+xml', cover(11, 12))
    await expect.poll(() => page.evaluate(() => window.loadingReview.held)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)

    await chooseFile(page, 'new.svg', 'image/svg+xml', cover(22, 33))
    const file = page.getByRole('dialog').first().locator('input[type="button"]')
    await expect(file).toHaveValue('22x33')
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(1)
    await page.evaluate(() => window.loadingReview.release())
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(2)
    await expect(file).toHaveValue('22x33')
})

test('cancelled audio decoding cannot replace newer preview audio', async ({ page }) => {
    await page.evaluate(() => {
        const decode = AudioContext.prototype.decodeAudioData
        AudioContext.prototype.decodeAudioData = function (data, ...callbacks) {
            if (data.byteLength !== 8 && data.byteLength !== 16) {
                return decode.call(this, data, ...callbacks)
            }
            const buffer = new AudioBuffer({ length: data.byteLength * 6000, sampleRate: 48000 })
            if (data.byteLength === 16) return Promise.resolve(buffer)
            window.loadingReview.held = true
            return new Promise((resolve) => {
                window.loadingReview.release = () => {
                    window.loadingReview.held = false
                    resolve(buffer)
                }
            })
        }
    })
    await openUtility(page, 'previewEditor')
    await chooseFile(page, 'old.wav', 'audio/wav', Buffer.alloc(8))
    await expect.poll(() => page.evaluate(() => window.loadingReview.held)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)

    await chooseFile(page, 'new.wav', 'audio/wav', Buffer.alloc(16))
    const file = page.getByRole('dialog').first().locator('input[type="button"]')
    await expect(file).toHaveValue(/^00:02/)
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(1)
    const replacement = await file.inputValue()
    await page.evaluate(() => window.loadingReview.release())
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(2)
    await expect(file).toHaveValue(replacement)
})

test('cancelling cover generation while PNG encoding finishes prevents the download', async ({
    page,
}) => {
    await openUtility(page, 'coverEditor')
    await chooseFile(page, 'cover.svg', 'image/svg+xml', cover(22, 33))
    await expect(page.getByRole('dialog').locator('input[type="button"]')).toHaveValue('22x33')
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(1)
    await page.evaluate(() => {
        const toBlob = HTMLCanvasElement.prototype.toBlob
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
            toBlob.call(
                this,
                (blob) => {
                    window.loadingReview.held = true
                    window.loadingReview.release = () => {
                        window.loadingReview.held = false
                        callback(blob)
                    }
                },
                ...args,
            )
        }
    })
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.loadingReview.held)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.evaluate(() => window.loadingReview.release())
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(2)
    expect(await page.evaluate(() => window.loadingReview.downloadUrls)).toEqual([])
})

test('cancelling preview generation during encoder loading prevents the download', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            bgm: { offset: 0, buffer: new AudioBuffer({ length: 1024, sampleRate: 48000 }) },
        })
    })
    let release: (() => Promise<void>) | undefined
    await page.route(
        '**/*lamejs*',
        (route) => {
            release = () => route.continue()
        },
        { times: 1 },
    )
    await openUtility(page, 'previewEditor')
    await page.getByRole('dialog').locator('input[type="number"]').nth(1).fill('0.02')
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(() => !!release).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await release!()
    await expect.poll(() => page.evaluate(() => window.loadingReview.completed)).toBe(1)
    expect(await page.evaluate(() => window.loadingReview.downloadUrls)).toEqual([])
})
