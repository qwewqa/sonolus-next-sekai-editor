import { expect, test, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

// Chart Cyanvas level data as its servers serve it (gzipped JSON with named
// entities), e.g. https://cc.milkbun.org/.
const chcy = {
    bgmOffset: 0.5,
    entities: [
        { archetype: 'Initialization', data: [] },
        { archetype: 'InputManager', data: [] },
        { archetype: 'Stage', data: [] },
        {
            name: 'tsg:0',
            archetype: 'TimeScaleGroup',
            data: [
                { name: 'first', ref: 'tsc:0:0' },
                { name: 'length', value: 0 },
                { name: 'next', ref: 'tsg:1' },
            ],
        },
        {
            name: 'tsg:1',
            archetype: 'TimeScaleGroup',
            data: [
                { name: 'first', ref: 'tsc:1:0' },
                { name: 'length', value: 1 },
                { name: 'next', value: -1 },
            ],
        },
        {
            name: 'tsc:1:0',
            archetype: 'TimeScaleChange',
            data: [
                { name: '#BEAT', value: 0 },
                { name: 'timeScale', value: 2 },
                { name: 'next', value: -1 },
            ],
        },
        {
            archetype: '#BPM_CHANGE',
            data: [
                { name: '#BEAT', value: 0 },
                { name: '#BPM', value: 150 },
            ],
        },
        {
            archetype: 'CriticalTapNote',
            data: [
                { name: '#BEAT', value: 1 },
                { name: 'lane', value: -2 },
                { name: 'size', value: 1.5 },
                { name: 'timeScaleGroup', ref: 'tsg:1' },
            ],
        },
        {
            name: 's',
            archetype: 'NormalSlideStartNote',
            data: [
                { name: '#BEAT', value: 2 },
                { name: 'lane', value: 0 },
                { name: 'size', value: 1 },
                { name: 'timeScaleGroup', ref: 'tsg:0' },
            ],
        },
        {
            name: 'e',
            archetype: 'NormalSlideEndNote',
            data: [
                { name: '#BEAT', value: 3 },
                { name: 'lane', value: 2 },
                { name: 'size', value: 1 },
                { name: 'slide', ref: 'c' },
                { name: 'timeScaleGroup', ref: 'tsg:0' },
            ],
        },
        {
            name: 'c',
            archetype: 'NormalSlideConnector',
            data: [
                { name: 'start', ref: 's' },
                { name: 'end', ref: 'e' },
                { name: 'head', ref: 's' },
                { name: 'tail', ref: 'e' },
                { name: 'ease', value: 1 },
                { name: 'startType', value: 0 },
            ],
        },
        {
            archetype: 'IgnoredSlideTickNote',
            data: [
                { name: '#BEAT', value: 2.5 },
                { name: 'attach', ref: 'c' },
            ],
        },
        {
            archetype: 'SimLine',
            data: [
                { name: 'a', ref: 's' },
                { name: 'b', ref: 'e' },
            ],
        },
    ],
}

const usc = {
    version: 2,
    usc: {
        offset: -0.25,
        objects: [
            { type: 'bpm', beat: 0, bpm: 120 },
            { type: 'timeScaleGroup', changes: [{ beat: 0, timeScale: 1 }] },
            {
                type: 'single',
                beat: 1,
                timeScaleGroup: 0,
                lane: 0,
                size: 1,
                critical: false,
                trace: false,
            },
        ],
    },
}

const sus = [
    '#TITLE "Import"',
    '#ARTIST "Test"',
    '#DESIGNER "Test"',
    '#DIFFICULTY 0',
    '#PLAYLEVEL 1',
    '#SONGID "import"',
    '#WAVE "import.mp3"',
    '#WAVEOFFSET 0',
    '#REQUEST "ticks_per_beat 480"',
    '#00002:4',
    '#BPM01:120',
    '#00008:01',
    '#00112:11',
    '#00113:11',
].join('\n')

const notes = (page: Page) =>
    page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { state } = (await import(
            urls.get('/src/history/index.ts') ?? '/src/history/index.ts'
        )) as typeof import('../../src/history/index')
        return {
            notes: [...state.value.store.slides.note.values()].flat().length,
            offset: state.value.bgm.offset,
        }
    })

const open = async (page: Page, name: string, buffer: Buffer) => {
    const opening = page.waitForEvent('filechooser')
    await page.keyboard.press('o')
    await (await opening).setFiles({ name, mimeType: 'application/octet-stream', buffer })
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        // The file input path, as in browsers without the File System Access API.
        Object.defineProperty(window, 'showOpenFilePicker', {
            configurable: true,
            value: undefined,
        })
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
})

for (const [label, name, buffer] of [
    ['gzipped, as served', 'level-data', gzipSync(JSON.stringify(chcy))],
    ['plain JSON', 'level.json', Buffer.from(JSON.stringify(chcy))],
] as const) {
    test(`Chart Cyanvas level data imports from ${label}`, async ({ page }) => {
        await open(page, name, buffer)
        await expect(page.locator('.notification')).toHaveText('Imported Chart Cyanvas level')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        // The tap and both slide notes; the combo tick is scheduled by the editor.
        expect(await notes(page)).toEqual({ notes: 3, offset: 0.5 })
    })
}

test('USC and SUS charts import with their own messages', async ({ page }) => {
    await open(page, 'chart.usc', Buffer.from(JSON.stringify(usc)))
    await expect(page.locator('.notification')).toHaveText('Imported USC chart')
    expect(await notes(page)).toEqual({ notes: 1, offset: -0.25 })

    await open(page, 'chart.sus', Buffer.from(sus))
    await expect(page.locator('.notification')).toHaveText('Imported SUS chart')
    expect((await notes(page)).notes).toBe(2)
})

test('an unsupported file explains what can be opened', async ({ page }) => {
    await open(page, 'notes.txt', Buffer.from('not a chart'))
    await expect(page.getByRole('dialog')).toContainText(
        'Unsupported file. Open level data, a Chart Cyanvas level, or a USC or SUS chart.',
    )
    await expect(page.getByRole('dialog')).not.toContainText('Error:')
})

test("a USC 'none' direction flicks up, as the engine reads it", async ({ page }) => {
    const single = (beat: number, direction?: string) => ({
        type: 'single',
        beat,
        timeScaleGroup: 0,
        lane: 0,
        size: 1,
        critical: false,
        trace: true,
        ...(direction === undefined ? {} : { direction }),
    })
    const chart = {
        version: 2,
        usc: {
            offset: 0,
            objects: [
                { type: 'bpm', beat: 0, bpm: 120 },
                { type: 'timeScaleGroup', changes: [{ beat: 0, timeScale: 1 }] },
                single(1, 'none'),
                single(2),
            ],
        },
    }
    await open(page, 'chart.usc', Buffer.from(JSON.stringify(chart)))
    await expect(page.locator('.notification')).toHaveText('Imported USC chart')
    const directions = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { state } = (await import(
            urls.get('/src/history/index.ts') ?? '/src/history/index.ts'
        )) as typeof import('../../src/history/index')
        return [...state.value.store.slides.note.values()]
            .flat()
            .sort((a, b) => a.beat - b.beat)
            .map((note) => [note.noteType, note.flickDirection])
    })
    expect(directions).toEqual([
        ['trace', 'up'],
        ['trace', 'none'],
    ])
})
