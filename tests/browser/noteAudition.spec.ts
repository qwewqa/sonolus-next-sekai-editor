import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

type AudioStart = { offset: number; duration?: number }

declare global {
    interface Window {
        noteAudition: { starts: AudioStart[]; stops: number[] }
    }
}

const installAudioProbe = () => {
    window.noteAudition = { starts: [], stops: [] }
    const ids = new WeakMap<AudioBufferSourceNode, number>()
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
        ids.set(this, window.noteAudition.starts.length)
        window.noteAudition.starts.push({ offset, duration })
        start.call(this, when, offset, duration)
    }
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (when) {
        const id = ids.get(this)
        if (id !== undefined) window.noteAudition.stops.push(id)
        stop.call(this, when)
    }
}

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const click = async (page: Page, lane: number, beat: number) => {
    const p = await point(page, lane, beat)
    await page.mouse.click(p.x, p.y)
    await settle(page)
}

const snapshot = (page: Page) =>
    page.evaluate(() => ({
        cursor: window.editorTest.view.cursorTime,
        starts: window.noteAudition.starts,
    }))

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript(installAudioProbe)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { settings, history } = window.editorTest
        settings.playPreviewDuration = 120
        settings.playBgmVolume = 40
        settings.waveform = 'off'
        history.replaceState({
            ...history.state.value,
            bgm: {
                offset: 0.25,
                buffer: new AudioBuffer({
                    length: 12 * 8000,
                    sampleRate: 8000,
                    numberOfChannels: 1,
                }),
            },
        })
    })
    await settle(page)
    await page.evaluate(() => {
        window.noteAudition.starts = []
        window.noteAudition.stops = []
    })
})

test('selecting, reselecting, and Ctrl-clicking notes auditions their time without seeking', async ({
    page,
}) => {
    await click(page, -3, 3)
    expect(await snapshot(page)).toEqual({
        cursor: 3,
        starts: [{ offset: 1.75, duration: 0.12 }],
    })
    await click(page, -3, 3)
    await page.keyboard.down('Control')
    await click(page, 1, 5)
    await click(page, 1, 5)
    await page.keyboard.up('Control')
    expect(await snapshot(page)).toEqual({
        cursor: 3,
        starts: [1.75, 1.75, 2.75, 2.75].map((offset) => ({ offset, duration: 0.12 })),
    })
    expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual([
        { type: 'note', beat: 3, left: -4, size: 2 },
    ])
})

for (const tool of ['note', 'slide'] as const) {
    test(`${tool} tool auditions an existing note without seeking`, async ({ page }) => {
        await page.keyboard.press(tool === 'note' ? 'a' : 's')
        await click(page, -3, 3)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [{ offset: 1.75, duration: 0.12 }],
        })
    })
}

for (const tool of ['select', 'note', 'slide'] as const) {
    test(`${tool} dragging auditions new snapped beats without duplicates from horizontal motion or release`, async ({
        page,
    }) => {
        if (tool !== 'select') await page.keyboard.press(tool === 'note' ? 'a' : 's')
        const start = await point(page, -3, 3)
        const horizontal = await point(page, -2, 3)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(horizontal.x, horizontal.y)
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [{ offset: 1.75, duration: 0.12 }],
        })

        const moved = await point(page, -2, 4)
        await page.mouse.move(moved.x, moved.y)
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [1.75, 2.25].map((offset) => ({ offset, duration: 0.12 })),
        })
        await page.mouse.move(moved.x + 2, moved.y + 1)
        await page.mouse.up()
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [1.75, 2.25].map((offset) => ({ offset, duration: 0.12 })),
        })
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toContainEqual({
            type: 'note',
            beat: 4,
            left: -3,
            size: 2,
        })
    })
}

test('empty-space clicks seek while note creation auditions once without moving the preview', async ({
    page,
}) => {
    await click(page, -7, 8)
    expect(await snapshot(page)).toEqual({
        cursor: 4,
        starts: [{ offset: 4.25, duration: 0.12 }],
    })
    await page.keyboard.press('a')
    await click(page, -7, 10)
    expect(await snapshot(page)).toEqual({
        cursor: 4,
        starts: [4.25, 5.25].map((offset) => ({ offset, duration: 0.12 })),
    })
    expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toContainEqual({
        type: 'note',
        beat: 10,
        left: -7,
        size: 2,
    })
})

for (const tool of ['note', 'slide'] as const) {
    test(`${tool} creation dragging auditions changed beats once while preserving the preview`, async ({
        page,
    }) => {
        await page.keyboard.press(tool === 'note' ? 'a' : 's')
        const start = await point(page, -7, 8)
        const horizontal = await point(page, -5, 8)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(horizontal.x, horizontal.y)
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [{ offset: 4.25, duration: 0.12 }],
        })

        const moved = await point(page, -5, 10)
        await page.mouse.move(moved.x, moved.y)
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [4.25, 5.25].map((offset) => ({ offset, duration: 0.12 })),
        })
        await page.mouse.move(moved.x + 2, moved.y + 1)
        await page.mouse.up()
        await settle(page)
        expect(await snapshot(page)).toEqual({
            cursor: 3,
            starts: [4.25, 5.25].map((offset) => ({ offset, duration: 0.12 })),
        })
        expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toContainEqual({
            type: 'note',
            beat: 10,
            left: -7,
            size: 2,
        })
    })
}

test('resizing a note auditions its fixed beat instead of the pointer beat', async ({ page }) => {
    const start = await point(page, -4, 3)
    const end = await point(page, -5, 4)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y)
    await settle(page)
    expect(await snapshot(page)).toEqual({
        cursor: 3,
        starts: [{ offset: 1.75, duration: 0.12 }],
    })
    await page.mouse.up()
    await settle(page)
    expect(await snapshot(page)).toEqual({
        cursor: 3,
        starts: [{ offset: 1.75, duration: 0.12 }],
    })
    expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toContainEqual({
        type: 'note',
        beat: 3,
        left: -5,
        size: 3,
    })
})

test('disabled audio previews keep note clicks silent without seeking', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.playPreviewDuration = 0
    })
    await click(page, -3, 3)
    expect(await snapshot(page)).toEqual({ cursor: 3, starts: [] })
})

test('a second note audition stops the previous snippet', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/editor/tools/index.ts')!.name
        const { tools } = (await import(url)) as typeof import('../../src/editor/tools')
        const { settings, point, nextTick, view } = window.editorTest
        settings.playPreviewDuration = 1000
        const modifiers = { ctrl: false, shift: false }
        // Run both selections in the same browser task, so the first snippet
        // cannot finish naturally before the replacement is tested.
        for (const [lane, beat] of [
            [-3, 3],
            [1, 5],
        ] as const) {
            const { x, y } = point(lane, beat)
            await tools.select.tap?.(x, y, modifiers)
            await nextTick()
        }
        return { ...window.noteAudition, cursor: view.cursorTime }
    })
    expect(result).toEqual({
        cursor: 3,
        starts: [1.75, 2.75].map((offset) => ({ offset, duration: 1 })),
        stops: [0],
    })
})
