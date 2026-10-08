import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

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

for (const [label, content] of [
    ['null', null],
    ['an array', []],
    ['a number', 42],
    ['level data without its offset', { entities: [] }],
    ['level data with malformed entities', { bgmOffset: 0, entities: [1, 2] }],
    ['a USC of another version', { version: 3, usc: { offset: 0, objects: [] } }],
] as const)
    test(`a file that is ${label} explains what can be opened`, async ({ page }) => {
        await open(page, 'chart.json', Buffer.from(JSON.stringify(content)))
        await expect(page.getByRole('dialog')).toContainText(
            'Unsupported file. Open level data, a Chart Cyanvas level, or a USC or SUS chart.',
        )
        await expect(page.getByRole('dialog')).not.toContainText('Error')
    })

test('a file picked after a garbage collection still opens', async ({ page }) => {
    // Skip the native picker and hold the input weakly, so only the app keeps it alive.
    await page.evaluate(() => {
        HTMLInputElement.prototype.click = function () {
            ;(window as unknown as { picking: WeakRef<HTMLInputElement> }).picking = new WeakRef(
                this,
            )
        }
    })
    await page.keyboard.press('o')
    await expect.poll(() => page.evaluate(() => 'picking' in window)).toBe(true)
    const client = await page.context().newCDPSession(page)
    await client.send('HeapProfiler.collectGarbage')
    const picked = await page.evaluate(() => {
        const input = (window as unknown as { picking: WeakRef<HTMLInputElement> }).picking.deref()
        if (!input) return false
        const data = new DataTransfer()
        data.items.add(new File(['null'], 'chart.json'))
        input.files = data.files
        input.dispatchEvent(new Event('change'))
        return true
    })
    expect(picked).toBe(true)
    await expect(page.getByRole('dialog')).toContainText(
        'Unsupported file. Open level data, a Chart Cyanvas level, or a USC or SUS chart.',
    )
})

// Level data refuses these, so the editor could not reopen its own file.
const invalidBpm = 'Invalid chart: BPM must be positive and finite'
const single = usc.usc.objects[2]!
for (const [label, objects, message] of [
    ['a negative note beat', [{ ...single, beat: -5 }], 'Invalid chart: negative beat'],
    [
        'a negative time scale beat',
        [{ type: 'timeScaleGroup', changes: [{ beat: -1, timeScale: 2 }] }],
        'Invalid chart: negative beat',
    ],
    ['a negative BPM beat', [{ type: 'bpm', beat: -2, bpm: 90 }], 'Invalid chart: negative beat'],
    ['a negative note size', [{ ...single, size: -3 }], 'Invalid chart: negative note size'],
    ['a zero BPM', [{ type: 'bpm', beat: 2, bpm: 0 }], invalidBpm],
    ['a negative BPM', [{ type: 'bpm', beat: 2, bpm: -60 }], invalidBpm],
] as const)
    test(`a USC with ${label} is refused`, async ({ page }) => {
        const chart = { ...usc, usc: { ...usc.usc, objects: [...usc.usc.objects, ...objects] } }
        await open(page, 'chart.usc', Buffer.from(JSON.stringify(chart)))
        await expect(page.getByRole('dialog')).toContainText(message)
        await expect(page.getByRole('dialog')).not.toContainText('Error:')
        expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
    })

test('a SUS with a negative beat is refused', async ({ page }) => {
    await open(page, 'chart.sus', Buffer.from(`${sus}\n#TIL00: "0'-480:2"`))
    await expect(page.getByRole('dialog')).toContainText('Invalid chart: negative beat')
    await expect(page.getByRole('dialog')).not.toContainText('Error:')
    expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
})

// The editor's own level data for the USC chart, with one value replaced.
const levelWithValue = async (page: Page) => {
    await open(page, 'chart.usc', Buffer.from(JSON.stringify(usc)))
    await expect(page.locator('.notification')).toHaveText('Imported USC chart')
    const level = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { state } = (await import(
            urls.get('/src/history/index.ts') ?? '/src/history/index.ts'
        )) as typeof import('../../src/history/index')
        const { serializeToLevelData } = (await import(
            urls.get('/src/levelData/serialize.ts') ?? '/src/levelData/serialize.ts'
        )) as typeof import('../../src/levelData/serialize')
        const { store, groups, stages } = state.value
        return serializeToLevelData(1000, false, 0, store, groups, stages)
    })
    return (name: string, value: unknown) => {
        const copy = structuredClone(level)
        const item = copy.entities
            .flatMap((entity) => entity.data)
            .find((item) => item.name === name && 'value' in item)
        if (!item) throw new Error(`no ${name}`)
        Object.assign(item, { value })
        return gzipSync(JSON.stringify(copy))
    }
}

test('level data with a value its format refuses names it, and is refused', async ({ page }) => {
    const withValue = await levelWithValue(page)
    for (const [name, value, message] of [
        ['connectorEase', 99, 'Invalid level: unknown value for connectorEase'],
        ['#BEAT', -1, 'Invalid level: invalid value for #BEAT'],
    ] as const) {
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await open(page, 'level-data', withValue(name, value))
        await expect(page.getByRole('dialog')).toContainText(message)
        await expect(page.getByRole('dialog')).not.toContainText('Unsupported')
        expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
    }
})

test('refusals read in the chosen language', async ({ page }) => {
    const withValue = await levelWithValue(page)
    const dialog = page.getByRole('dialog')
    for (const [name, buffer, message] of [
        [
            'level-data',
            withValue('connectorEase', 99),
            'Niveau non valide : valeur inconnue pour connectorEase',
        ],
        [
            'chart.sus',
            Buffer.from(sus.replace('ticks_per_beat 480', 'ticks_per_beat 1e999')),
            'Partition non valide : ticks par temps manquants ou inattendus',
        ],
    ] as const) {
        await page.reload()
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(async () => {
            const { settings } = await import('/src/settings.ts')
            settings.locale = 'fr'
        })
        await open(page, name, buffer)
        await expect(dialog).toContainText(message)
        await expect(dialog).not.toContainText('Invalid')
        expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
    }
})

// An unknown BPM id reads as 0 in SUS.
for (const [label, lines] of [
    ['a zero BPM', ['#BPM02:0', '#00108:02']],
    ['a negative BPM', ['#BPM02:-90', '#00108:02']],
    ['an infinite BPM', ['#BPM02:1e999', '#00108:02']],
    ['an undefined BPM', ['#00108:03']],
] as const)
    test(`a SUS with ${label} is refused`, async ({ page }) => {
        await open(page, 'chart.sus', Buffer.from([sus, ...lines].join('\n')))
        await expect(page.getByRole('dialog')).toContainText(invalidBpm)
        await expect(page.getByRole('dialog')).not.toContainText('Error:')
        expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
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

test('Chart Cyanvas attached ticks after a BPM change export clean lanes and sizes', async ({
    page,
}) => {
    const note = (name: string, archetype: string, data: Record<string, unknown>) => ({
        name,
        archetype,
        data: Object.entries(data).map(([key, value]) =>
            typeof value === 'string' ? { name: key, ref: value } : { name: key, value },
        ),
    })
    // At 70 BPM their time fractions carry float noise.
    const ticks = [3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75].map((beat, index) =>
        note(`t${index}`, 'NormalAttachedSlideTickNote', { '#BEAT': beat, attach: 'c' }),
    )
    const level = {
        ...chcy,
        entities: [
            ...chcy.entities.slice(0, 6),
            note('', '#BPM_CHANGE', { '#BEAT': 0, '#BPM': 60 }),
            note('', '#BPM_CHANGE', { '#BEAT': 1, '#BPM': 70 }),
            note('s', 'NormalSlideStartNote', {
                '#BEAT': 3,
                lane: -3,
                size: 1,
                timeScaleGroup: 'tsg:0',
            }),
            note('e', 'NormalSlideEndNote', {
                '#BEAT': 5,
                lane: 5,
                size: 2,
                slide: 'c',
                timeScaleGroup: 'tsg:0',
            }),
            note('c', 'NormalSlideConnector', {
                start: 's',
                end: 'e',
                head: 's',
                tail: 'e',
                ease: 1,
                startType: 0,
            }),
            ...ticks,
        ],
    }
    await open(page, 'level-data', gzipSync(JSON.stringify(level)))
    await expect(page.locator('.notification')).toHaveText('Imported Chart Cyanvas level')
    const values = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(urls.get(pathname) ?? pathname)
        const { state } =
            await appImport<typeof import('../../src/history/index')>('/src/history/index.ts')
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const { entities } = serializeToLevelData(
            1000,
            false,
            0,
            state.value.store,
            state.value.groups,
            state.value.stages,
        )
        const value = (entity: (typeof entities)[number], name: string) => {
            const item = entity.data.find((item) => item.name === name)
            return item && 'value' in item ? item.value : undefined
        }
        return entities
            .filter(
                (entity) =>
                    value(entity, 'isAttached') === 1 && value(entity, 'lane') !== undefined,
            )
            .flatMap((entity) => [value(entity, 'lane'), value(entity, 'size')])
    })
    expect(values).toHaveLength(14)
    // At most 9 decimals: no float noise.
    for (const value of values) expect(String(value)).toMatch(/^-?\d+(\.\d{1,9})?$/)
})

// These would save as null, so the editor could not reopen its own file.
for (const [label, edit, message] of [
    [
        'an infinite time scale',
        (chart: string) => `${chart}
#TIL00: "0'480:1e999"`,
        'Invalid chart: unexpected time scale change',
    ],
    [
        'a malformed time scale segment',
        (chart: string) => `${chart}
#TIL00: "abc"`,
        'Invalid chart: unexpected time scale change',
    ],
    [
        'an infinite offset',
        (chart: string) => chart.replace('#WAVEOFFSET 0', '#WAVEOFFSET 1e999'),
        'Invalid chart: unexpected offset',
    ],
    [
        'an infinite tick resolution',
        (chart: string) => chart.replace('ticks_per_beat 480', 'ticks_per_beat 1e999'),
        'Invalid chart: missing or unexpected ticks per beat',
    ],
    // A beat no number holds, from a section shift past any measure.
    [
        'an infinite measure',
        (chart: string) => chart.replace('#00112:11', '#MEASUREBS 1e999\n#00112:11'),
        'Invalid chart: invalid value for beat',
    ],
] as const)
    test(`a SUS with ${label} is refused`, async ({ page }) => {
        await open(page, 'chart.sus', Buffer.from(edit(sus)))
        await expect(page.getByRole('dialog')).toContainText(message)
        expect(await notes(page)).toEqual({ notes: 0, offset: 0 })
    })

// The header plus a guide with one note and no end.
const guideSus = [...sus.split('\n').slice(0, 12), '#00194a:13', '#00112:13'].join('\n')
// Taps, flicks, slides, guides (one of them a single note), BPM and time scale changes.
const richSus = [
    '#TITLE "Regression"',
    '#ARTIST "Test"',
    '#DESIGNER "Test"',
    '#DIFFICULTY 0',
    '#PLAYLEVEL 1',
    '#SONGID "reg"',
    '#WAVE "reg.mp3"',
    '#WAVEOFFSET 0.5',
    '#REQUEST "ticks_per_beat 480"',
    '#00002:4',
    '#BPM01:120',
    '#BPM02:180',
    '#00008:01',
    '#00308:02',
    `#TIL00:"0'0:1.0, 1'960:2.0, 3'0:0.5"`,
    '#HISPEED 00',
    '#00112:13002400',
    '#00116:1300',
    '#00156:1300',
    '#0011a:2400',
    '#0015a:3400',
    '#00118:13',
    '#00158:40',
    '#00230a:13000000',
    '#00232a:00003300',
    '#00234a:00000000',
    '#00334a:23',
    '#00232a:0000',
    '#00252:0020',
    '#00230b:1400',
    '#00330b:2400',
    '#00290c:1200',
    '#00294c:0022',
    '#00396c:23',
    '#00410:1300',
    '#00450:6000',
    '#00413:1213141516',
    '#00418:5300',
    '#00458:1300',
    '#00510:31',
    '#00413:0000',
].join('\n')

for (const [label, chart] of [
    ['a one-note guide', guideSus],
    ['a one-note guide among other notes', richSus],
] as const)
    test(`a SUS with ${label} saves, reopens and restores`, async ({ page }) => {
        await open(page, 'chart.sus', Buffer.from(chart))
        await expect(page.locator('.notification')).toHaveText('Imported SUS chart')
        const imported = (await notes(page)).notes

        await page.evaluate(() => {
            // The download path, as in browsers without the File System Access API.
            Object.defineProperty(window, 'showSaveFilePicker', {
                configurable: true,
                value: undefined,
            })
        })
        const downloading = page.waitForEvent('download')
        await page.keyboard.press('p')
        const saved = readFileSync((await (await downloading).path())!)
        expect(gunzipSync(saved).toString()).not.toContain('null')

        await open(page, 'saved', saved)
        await expect(page.locator('.notification')).toHaveText('Opened level')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        expect((await notes(page)).notes).toBe(imported)

        // Edit so auto save writes a recovery, then restore it.
        await page.evaluate(async () => {
            const urls = new Map(
                performance
                    .getEntriesByType('resource')
                    .map((entry) => [new URL(entry.name).pathname, entry.name]),
            )
            const appImport = <T>(pathname: string): Promise<T> =>
                import(urls.get(pathname) ?? pathname)
            const { settings } =
                await appImport<typeof import('../../src/settings')>('/src/settings.ts')
            const { state, replaceState } =
                await appImport<typeof import('../../src/history/index')>('/src/history/index.ts')
            const { editSelectedEditableEntities } = await appImport<
                typeof import('../../src/editor/sidebars/default/index')
            >('/src/editor/sidebars/default/index.ts')
            settings.autoSaveDelay = 0
            settings.autoSave = true
            const note = [...state.value.store.slides.note.values()].flat()[0]!
            replaceState({ ...state.value, selectedEntities: [note] })
            editSelectedEditableEntities({ size: note.size + 1 })
        })
        await expect
            .poll(() =>
                page.evaluate(() =>
                    localStorage.getItem('sonolus-next-sekai-editor.autoSave.levelData'),
                ),
            )
            .not.toBeNull()
        await page.reload()
        await expect.poll(async () => (await notes(page)).notes).toBe(imported)
        await expect(page.getByRole('dialog')).toHaveCount(0)
    })

test('level data with a null guide alpha, as older editors saved, opens with alpha 1', async ({
    page,
}) => {
    await open(page, 'chart.sus', Buffer.from(guideSus))
    await expect(page.locator('.notification')).toHaveText('Imported SUS chart')
    const level = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(urls.get(pathname) ?? pathname)
        const { state } =
            await appImport<typeof import('../../src/history/index')>('/src/history/index.ts')
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const { store, groups, stages } = state.value
        return serializeToLevelData(1000, false, 0, store, groups, stages)
    })
    // Every alpha null, as the one-note guide's NaN saved.
    const text = JSON.stringify(level).replace(/("segmentAlpha","value":)[^}]+/g, '$1null')
    expect(text).toContain('"segmentAlpha","value":null')

    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await open(page, 'level-data', gzipSync(text))
    await expect(page.locator('.notification')).toHaveText('Opened level')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const alphas = await page.evaluate(async () => {
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
            .map((note) => note.connectorGuideAlpha)
    })
    expect(alphas).toEqual([1, 1])
})
