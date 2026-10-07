import { expect, test, type Locator, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

/**
 * The notes fixture with groups in folders (Default and Other own its notes),
 * plus, for Other and the side stage: a time scale and event of each type with
 * same-beat pairs, a slide with a same-beat pair, and a slide crossing into Default.
 */
const seed = (page: Page) =>
    page.evaluate(() => {
        const { history, view, fixtures, settings } = window.editorTest
        const chart = structuredClone(fixtures.notes)
        chart.isDynamicStages = true
        const groups: [string, number?][] = [
            ['Default'],
            ['Other'],
            ['Lead', 9000],
            ['Fill', 9000],
            ['Bass'],
            ['Drums'],
            ['Pad', 9001],
        ]
        chart.groups = new Map(
            groups.map(([name, folderId], i) => [
                (i < 2 ? i + 1 : 1000 + i) as never,
                folderId === undefined ? { name } : { name, folderId: folderId as never },
            ]),
        )
        chart.groupFolders = new Map([
            [9000 as never, { name: 'Verse', index: 0 }],
            [9001 as never, { name: 'Outro', index: 0 }],
        ])

        const timeScale = (beat: number, value: number, skip = 0) => ({
            groupId: 2 as never,
            beat,
            editorLane: -6,
            timeScale: value,
            skip,
            timeScaleEase: 'linear' as const,
            timeScaleTransition: 'timeScale' as const,
            hideNotes: false,
        })
        chart.timeScales = [
            timeScale(4, 2),
            timeScale(4, 0.5, 1),
            timeScale(8, 1),
            { ...timeScale(12, 3), groupId: 1 as never },
        ]

        const events = fixtures.events
        const pair = <T extends { stageId: unknown; beat: number }>(list: T[]) => {
            const moved = list.map((event) => ({ ...event, stageId: 2 as never }))
            const [first] = moved
            return first ? [...moved, { ...first, beat: moved[1]?.beat ?? first.beat }] : moved
        }
        chart.stageMaskEvents = [...events.stageMaskEvents, ...pair(events.stageMaskEvents)]
        chart.stagePivotEvents = [...events.stagePivotEvents, ...pair(events.stagePivotEvents)]
        chart.stageStyleEvents = [...events.stageStyleEvents, ...pair(events.stageStyleEvents)]
        chart.stageTransformEvents = [
            ...events.stageTransformEvents,
            ...pair(events.stageTransformEvents),
        ]

        const base = chart.slides[0]![0]!
        const note = (beat: number, left: number, groupId = 2, stageId = 2) => ({
            ...base,
            beat,
            left,
            groupId: groupId as never,
            stageId: stageId as never,
        })
        chart.slides.push(
            [note(30, -2), note(32, 0, 1)],
            [note(34, -4), note(36, -2), note(36, 2), note(38, 0)],
        )

        history.resetState(false, chart, 0, 'duplicate.json')
        view.groupId = undefined
        view.stageId = undefined
        view.groupVisibility = new Map()
        view.stageVisibility = new Map()
        settings.showGroups = true
        settings.showStages = true
        settings.autoAddGroup = true
    })

/** The groups as a compact tree: `name` or `[Folder: a b]`. */
const tree = (page: Page, key: 'groups' | 'stages' = 'groups') =>
    page.evaluate(
        async ({ key }) => {
            const { buildFolderTree } = await import('/src/chart/folders.ts')
            const state = window.editorTest.history.state.value
            const entries: ReadonlyMap<number, { name: string; folderId?: number }> = state[key]
            const folders = key === 'groups' ? state.groupFolders : state.stageFolders
            return buildFolderTree(entries as never, folders)
                .map((item) =>
                    item.type === 'entry'
                        ? entries.get(item.id as never)?.name
                        : `[${folders.get(item.id)?.name}:${item.members
                              .map((id) => ` ${entries.get(id as never)?.name}`)
                              .join('')}]`,
                )
                .join(' ')
        },
        { key },
    )

/**
 * The level as exported: each group's and stage's chains (time scales, stage
 * events) as their values in chain order, notes by slide with owners by name,
 * and the folder entities.
 */
const exported = (page: Page) =>
    page.evaluate(async () => {
        const { serializeToLevelDataEntities } =
            await import('/src/levelData/entities/serialize/index.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const state = window.editorTest.history.state.value
        const entities = serializeToLevelDataEntities(
            state.initialLife,
            state.isDynamicStages,
            state.store,
            state.groups,
            state.stages,
            { groups: state.groupFolders, stages: state.stageFolders },
        )
        const byName = new Map(
            entities.flatMap((entity) =>
                'name' in entity && entity.name ? [[entity.name, entity] as const] : [],
            ),
        )
        const refOf = (entity: (typeof entities)[number] | undefined, name: string) => {
            const data = entity?.data.find((data) => data.name === name)
            return data && 'ref' in data ? data.ref : undefined
        }
        const chains = (archetype: string) =>
            Object.fromEntries(
                entities
                    .filter((entity) => entity.archetype === archetype)
                    .map((owner) => {
                        const chain: Record<string, string[]> = {}
                        for (const data of owner.data) {
                            if (!data.name.startsWith('first') || !('ref' in data)) continue
                            const values: string[] = []
                            for (let name: string | undefined = data.ref; name;) {
                                const entity = byName.get(name)
                                values.push(
                                    JSON.stringify(entity?.data.filter((data) => !('ref' in data))),
                                )
                                name = refOf(entity, 'next')
                            }
                            chain[data.name] = values
                        }
                        return [refOf(owner, 'editorName'), chain]
                    }),
            )
        const chart = parseLevelDataChart(entities)
        return {
            groups: chains('#TIMESCALE_GROUP'),
            stages: chains('Stage'),
            slides: chart.slides.map((slide) =>
                slide.map((note) => ({
                    ...note,
                    groupId: chart.groups.get(note.groupId)?.name,
                    stageId: chart.stages.get(note.stageId)?.name,
                })),
            ),
            folders: entities
                .filter((entity) => entity.archetype.startsWith('Editor'))
                .map((entity) => refOf(entity, 'editorName')),
        }
    })

type Exported = Awaited<ReturnType<typeof exported>>

/** Each slide's notes owned by this group or stage, without the owner, in order. */
const ownedSlides = (level: Exported, key: 'groupId' | 'stageId', name: string) =>
    level.slides
        .map((slide) =>
            slide
                .filter((note) => note[key] === name)
                .map((note) => JSON.stringify({ ...note, [key]: undefined })),
        )
        .filter((slide) => slide.length)
        .map((slide) => slide.join('|'))
        .sort()

const panel = (page: Page, key: 'groups' | 'stages' = 'groups') =>
    page.locator(`#workspace-panel-${key}`)

const row = (scope: Locator, name: string) =>
    scope.locator('.manager-row').filter({
        has: scope.page().locator('.manager-label', {
            hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`),
        }),
    })

const nameButton = (scope: Locator, name: string) => row(scope, name).locator('.manager-name')

const checked = (scope: Locator) =>
    scope
        .locator('.manager-entry .manager-check[aria-checked="true"]')
        .evaluateAll((checks) =>
            checks.map(
                (check) =>
                    check.closest('.manager-row')?.querySelector('.manager-label')?.textContent,
            ),
        )

const undo = (page: Page) => page.evaluate(() => window.editorTest.history.undoState())
const redo = (page: Page) => page.evaluate(() => window.editorTest.history.redoState())

const historyLength = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        let steps = 0
        while (history.canUndo.value) {
            history.undoState()
            steps++
        }
        for (let i = 0; i < steps; i++) history.redoState()
        return steps
    })

/** The view and canvas state Duplicate must leave alone. */
const viewState = (page: Page) =>
    page.evaluate(() => {
        const { view, history } = window.editorTest
        const state = history.state.value
        return {
            group: view.groupId,
            stage: view.stageId,
            groupVisibility: [...view.groupVisibility],
            stageVisibility: [...view.stageVisibility],
            selected: state.selectedEntities.length,
            firstGroup: [...state.groups.keys()][0],
            firstStage: [...state.stages.keys()][0],
        }
    })

const openMenu = async (scope: Locator, name: string) => {
    await row(scope, name).locator('.manager-more').click()
    return scope.page().getByRole('menu')
}

test('a group duplicates with its time scales and notes right after itself, in one step', async ({
    page,
}) => {
    await seed(page)
    const list = panel(page)
    await nameButton(list, 'Other').click()
    // A hide and a canvas selection that the copy must leave alone.
    await row(list, 'Bass').locator('.manager-eye').click()
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const notes = [...store.store.value.slides.note.values()].flat().slice(0, 3)
        history.replaceState({ ...history.state.value, selectedEntities: notes })
    })
    const view = await viewState(page)
    const before = await exported(page)

    const menu = await openMenu(list, 'Other')
    await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
    // The copy follows its source and starts its naming; Escape keeps the copy name.
    await expect(list.locator('.manager-rename')).toBeFocused()
    await page.keyboard.press('Escape')
    expect(await tree(page)).toBe(
        'Default Other Other (2) [Verse: Lead Fill] Bass Drums [Outro: Pad]',
    )
    expect(await historyLength(page)).toBe(1)
    expect(await viewState(page)).toEqual(view)

    const after = await exported(page)
    // The chain is the source's, same-beat pair included, in the same order.
    expect(after.groups['Other (2)']).toEqual(before.groups.Other)
    expect(after.groups['Other (2)']?.first).toHaveLength(3)
    // Every other group exports as before.
    for (const name of Object.keys(before.groups))
        expect(after.groups[name]).toEqual(before.groups[name])
    // The copy owns the same notes, keeping their stages and same-beat order;
    // the slide crossing into Default keeps only Other's note.
    expect(ownedSlides(after, 'groupId', 'Other (2)')).toEqual(
        ownedSlides(before, 'groupId', 'Other'),
    )
    expect(ownedSlides(after, 'groupId', 'Other')).toEqual(ownedSlides(before, 'groupId', 'Other'))
    expect(after.slides.length - before.slides.length).toBe(
        ownedSlides(before, 'groupId', 'Other').length,
    )

    // Next from the source reaches the copy.
    await page.evaluate(async () => {
        const { groupNext } = await import('/src/editor/commands/groups/groupNext.ts')
        groupNext.execute()
    })
    await expect(row(list, 'Other (2)').locator('.manager-name')).toHaveAttribute(
        'aria-current',
        'true',
    )

    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
    expect(await exported(page)).toEqual(before)
    await redo(page)
    expect(await tree(page)).toBe(
        'Default Other Other (2) [Verse: Lead Fill] Bass Drums [Outro: Pad]',
    )
})

test('a typed name is a second step; duplicating again counts on', async ({ page }) => {
    await seed(page)
    const list = panel(page)
    await (await openMenu(list, 'Lead')).getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(list.locator('.manager-rename')).toBeFocused()
    await page.keyboard.type('Echo')
    await page.keyboard.press('Enter')
    expect(await tree(page)).toBe('Default Other [Verse: Lead Echo Fill] Bass Drums [Outro: Pad]')
    await undo(page)
    expect(await tree(page)).toBe(
        'Default Other [Verse: Lead Lead (2) Fill] Bass Drums [Outro: Pad]',
    )
    await (await openMenu(list, 'Lead (2)')).getByRole('menuitem', { name: 'Duplicate' }).click()
    await page.keyboard.press('Escape')
    // A numbered copy bumps its number rather than nesting another.
    expect(await tree(page)).toBe(
        'Default Other [Verse: Lead Lead (2) Lead (3) Fill] Bass Drums [Outro: Pad]',
    )
    await undo(page)
    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
})

test('the default group duplicates after itself and stays the default', async ({ page }) => {
    await seed(page)
    const list = panel(page)
    const first = (await viewState(page)).firstGroup
    await (await openMenu(list, 'Default')).getByRole('menuitem', { name: 'Duplicate' }).click()
    await page.keyboard.press('Escape')
    expect(await tree(page)).toBe(
        'Default Default (2) Other [Verse: Lead Fill] Bass Drums [Outro: Pad]',
    )
    expect((await viewState(page)).firstGroup).toBe(first)
})

test('the selection duplicates in one step, each copy beside its source, and selects the copies', async ({
    page,
}) => {
    await seed(page)
    const list = panel(page)
    const before = await exported(page)
    await nameButton(list, 'Default').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Other').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Lead').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Pad').click({ modifiers: ['ControlOrMeta'] })
    const bar = list.locator('.manager-selection-bar')
    await bar.getByRole('button', { name: 'More Actions for Selection' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate Selected' }).click()

    expect(await tree(page)).toBe(
        'Default Default (2) Other Other (2) [Verse: Lead Lead (2) Fill] Bass Drums [Outro: Pad Pad (2)]',
    )
    // Still selecting, now the copies, ready to move together.
    expect(await checked(list)).toEqual(['Default (2)', 'Other (2)', 'Lead (2)', 'Pad (2)'])
    await expect(list.locator('.manager-rename')).toHaveCount(0)
    expect(await historyLength(page)).toBe(1)

    const after = await exported(page)
    // Copied together, the slide spanning Other and Default stays one slide.
    const crossing = (level: Exported, groups: string[]) =>
        level.slides.filter(
            (slide) =>
                slide.length === 2 && slide.every((note) => groups.includes(note.groupId ?? '')),
        ).length
    expect(crossing(before, ['Default', 'Other'])).toBe(1)
    expect(crossing(after, ['Default (2)', 'Other (2)'])).toBe(1)
    expect(after.groups['Other (2)']).toEqual(before.groups.Other)
    expect(after.groups['Default (2)']).toEqual(before.groups.Default)

    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
    await expect(list.locator('.manager-check')).not.toHaveCount(0)
    expect(await checked(list)).toEqual([])
})

test('a folder duplicates after itself with copies of its members, keeping their names', async ({
    page,
}) => {
    await seed(page)
    const list = panel(page)
    await (await openMenu(list, 'Verse')).getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(list.locator('.manager-rename')).toBeFocused()
    await page.keyboard.press('Escape')
    expect(await tree(page)).toBe(
        'Default Other [Verse: Lead Fill] [Verse (2): Lead Fill] Bass Drums [Outro: Pad]',
    )
    await expect(row(list, 'Verse (2)').locator('.manager-name')).toHaveAttribute(
        'aria-expanded',
        'true',
    )
    expect(await historyLength(page)).toBe(1)
    expect((await exported(page)).folders).toEqual(['Verse', 'Verse (2)', 'Outro'])

    // An empty folder copies too.
    await (await openMenu(list, 'Outro')).getByRole('menuitem', { name: 'Ungroup' }).click()
    await page.evaluate(async () => {
        const { groupFolderOps } = await import('/src/editor/workspace/manager/groups.ts')
        const empty = groupFolderOps.create()
        groupFolderOps.duplicateFolder(empty)
    })
    expect(await tree(page)).toBe(
        'Default Other [Verse: Lead Fill] [Verse (2): Lead Fill] Bass Drums Pad [Folder 1:] [Folder 1 (2):]',
    )
})

test('a whole folder checked with other entries duplicates entries, not the folder', async ({
    page,
}) => {
    await seed(page)
    const list = panel(page)
    await nameButton(list, 'Bass').click({ modifiers: ['ControlOrMeta'] })
    await row(list, 'Verse').locator('.manager-check').click()
    expect(await checked(list)).toEqual(['Lead', 'Fill', 'Bass'])
    await list.locator('.manager-selection-bar .manager-bulk-more').click()
    await page.getByRole('menuitem', { name: 'Duplicate Selected' }).click()
    expect(await tree(page)).toBe(
        'Default Other [Verse: Lead Lead (2) Fill Fill (2)] Bass Bass (2) Drums [Outro: Pad]',
    )
})

test('a stage duplicates with its events and notes, which keep their groups', async ({ page }) => {
    await seed(page)
    const list = panel(page, 'stages')
    const before = await exported(page)
    const view = await viewState(page)
    await (
        await openMenu(list, 'Side stage')
    )
        .getByRole('menuitem', { name: 'Duplicate', exact: true })
        .click()
    await page.keyboard.press('Escape')
    expect(await tree(page, 'stages')).toBe('Center Side stage Side stage (2)')
    expect(await historyLength(page)).toBe(1)
    expect(await viewState(page)).toEqual(view)

    const after = await exported(page)
    const chains = after.stages['Side stage (2)'] ?? {}
    expect(chains).toEqual(before.stages['Side stage'])
    // Each event type, with its same-beat pair.
    expect(Object.keys(chains).sort()).toEqual([
        'firstMaskChange',
        'firstPivotChange',
        'firstStyleChange',
        'firstTransformChange',
    ])
    for (const name of Object.keys(before.stages))
        expect(after.stages[name]).toEqual(before.stages[name])
    expect(ownedSlides(after, 'stageId', 'Side stage (2)')).toEqual(
        ownedSlides(before, 'stageId', 'Side stage'),
    )
    // Copied notes add no group, and every group exports as before.
    expect(Object.keys(after.groups)).toEqual(Object.keys(before.groups))
    expect(after.groups).toEqual(before.groups)
})

for (const [key, owner] of [
    ['groups', 'Other'],
    ['stages', 'Side stage'],
] as const) {
    test(`a ${key.slice(0, -1)} owning part of a slide duplicates its ticks attached`, async ({
        page,
    }) => {
        await seed(page)
        // An Out Quad slide whose head and ticks Other and the side stage own, but not its tail.
        await page.evaluate(async () => {
            const { history, appImport } = window.editorTest
            const { createTransaction } = await appImport<
                typeof import('../../src/state/transaction')
            >('/src/state/transaction.ts')
            const { addNote } = await appImport<
                typeof import('../../src/state/mutations/slides/note')
            >('/src/state/mutations/slides/note.ts')
            const { createSlideId } = await appImport<
                typeof import('../../src/state/entities/slides')
            >('/src/state/entities/slides/index.ts')
            const { addToGroups } =
                await appImport<typeof import('../../src/chart/groups')>('/src/chart/groups.ts')
            const { addToStages } =
                await appImport<typeof import('../../src/chart/stages')>('/src/chart/stages.ts')
            const source = history.state.value
            // The seed's ids were not minted; move both counters past them.
            const last = Math.max(...source.groups.keys(), ...source.stages.keys())
            while (addToGroups(new Map())[0] < last);
            while (addToStages(new Map())[0] < last);
            const base = [...source.store.slides.note.values()][0]![0]!
            const transaction = createTransaction(source)
            const slideId = createSlideId()
            for (const [beat, left, owner, isAttached] of [
                [40, -4, 2, false],
                [41, 0, 2, true],
                [42, 0, 2, true],
                [44, 4, 1, false],
            ] as const)
                addNote(transaction, slideId, {
                    ...base,
                    beat,
                    left,
                    size: 2,
                    groupId: owner as never,
                    stageId: owner as never,
                    isAttached,
                    isConnectorSeparator: false,
                    connectorEase: 'outQuad',
                })
            history.replaceState(transaction.commit([]))
            ;(window as unknown as { notesBefore: unknown[] }).notesBefore = [
                ...history.state.value.store.slides.note.values(),
            ].flat()
        })
        const notesOf = (name: string) =>
            page.evaluate(
                ({ key, name }) => {
                    const state = window.editorTest.history.state.value
                    const id = [...state[key]].find(([, entry]) => entry.name === name)?.[0]
                    return [...state.store.slides.note.values()]
                        .flat()
                        .filter(
                            (note) =>
                                note.beat >= 40 &&
                                note[key === 'groups' ? 'groupId' : 'stageId'] === id,
                        )
                        .sort((a, b) => a.beat - b.beat)
                        .map(({ beat, left, size, isAttached }) => ({
                            beat,
                            left,
                            size,
                            isAttached,
                        }))
                },
                { key, name },
            )

        // Out Quad from lane -4 to 4: the ticks at beats 41 and 42 are drawn at left -0.5 and 2.
        const source = await notesOf(owner)
        expect(source).toEqual([
            { beat: 40, left: -4, size: 2, isAttached: false },
            { beat: 41, left: expect.closeTo(-0.5, 6), size: 2, isAttached: true },
            { beat: 42, left: expect.closeTo(2, 6), size: 2, isAttached: true },
        ])
        const list = panel(page, key)
        await (
            await openMenu(list, owner)
        )
            .getByRole('menuitem', { name: 'Duplicate', exact: true })
            .click()
        await page.keyboard.press('Escape')
        // The beat 42 tick ends the copy where it was drawn; the beat 41 tick follows it.
        expect(await notesOf(`${owner} (2)`)).toEqual([
            { beat: 40, left: -4, size: 2, isAttached: false },
            { beat: 41, left: expect.closeTo(0.5, 6), size: 2, isAttached: true },
            { beat: 42, left: expect.closeTo(2, 6), size: 2, isAttached: true },
        ])

        await undo(page)
        expect(await tree(page, key)).not.toContain(`${owner} (2)`)
        expect(
            await page.evaluate(() => {
                const before = (window as unknown as { notesBefore: unknown[] }).notesBefore
                const after = [
                    ...window.editorTest.history.state.value.store.slides.note.values(),
                ].flat()
                return (
                    after.length === before.length && after.every((note, i) => note === before[i])
                )
            }),
        ).toBe(true)
    })
}

test('without dynamic stages there is no stage to duplicate', async ({ page }) => {
    await seed(page)
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.resetState(
            false,
            { ...window.editorTest.fixtures.notes, isDynamicStages: false },
            0,
            'static.json',
        )
    })
    const list = panel(page, 'stages')
    await expect(list.locator('.manager-disabled')).toBeVisible()
    await expect(list.locator('.manager-more')).toHaveCount(0)
})

test('duplicating a large group and stage stays quick', async ({ page }) => {
    await seed(page)
    const times = await page.evaluate(async () => {
        const { history, fixtures } = window.editorTest
        const chart = structuredClone(fixtures.notes)
        chart.isDynamicStages = true
        const base = chart.slides[0]![0]!
        chart.slides = Array.from({ length: 500 }, (_, slide) =>
            Array.from({ length: 10 }, (_, i) => ({
                ...base,
                beat: slide * 2 + i * 0.125,
                left: (i % 5) - 4,
                groupId: 2 as never,
                stageId: 2 as never,
            })),
        )
        chart.timeScales = Array.from({ length: 2000 }, (_, i) => ({
            groupId: 2 as never,
            beat: Math.floor(i / 2) * 0.5,
            editorLane: -6,
            timeScale: (i % 4) + 0.5,
            skip: 0,
            timeScaleEase: 'linear' as const,
            timeScaleTransition: 'timeScale' as const,
            hideNotes: false,
        }))
        const [mask] = fixtures.events.stageMaskEvents
        chart.stageMaskEvents = Array.from({ length: 2000 }, (_, i) => ({
            ...mask!,
            stageId: 2 as never,
            beat: Math.floor(i / 2) * 0.5,
            maskLeft: (i % 6) - 6,
        }))
        history.resetState(false, chart, 0, 'large.json')
        const { groupFolderOps } = await import('/src/editor/workspace/manager/groups.ts')
        const { stageFolderOps } = await import('/src/editor/workspace/manager/stages.ts')
        const time = (run: () => void) => {
            const start = performance.now()
            run()
            return performance.now() - start
        }
        return {
            group: time(() => groupFolderOps.duplicate(new Set([2 as never]))),
            stage: time(() => stageFolderOps.duplicate(new Set([2 as never]))),
            notes: [...history.state.value.store.slides.note.values()].flat().length,
        }
    })
    console.log('duplicate timings (ms)', times)
    // The group copy doubles 5000 notes; the stage copy doubles both sets again.
    expect(times.notes).toBe(5000 * 2 * 2)
    expect(times.group).toBeLessThan(3000)
    expect(times.stage).toBeLessThan(3000)
})

for (const [device, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 1024, height: 768 }],
] as const) {
    test.describe(device, () => {
        test.use({ viewport, isMobile: true, hasTouch: true })

        test('row and folder menus offer Duplicate and fit without scrolling', async ({ page }) => {
            await seed(page)
            const list = panel(page)
            for (const name of ['Default', 'Verse']) {
                await row(list, name).locator('.manager-more').tap()
                const menu = page.getByRole('menu')
                await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
                const fits = await menu.evaluate((element) => {
                    const scroller = element.firstElementChild as HTMLElement
                    return scroller.scrollHeight <= scroller.clientHeight + 1
                })
                expect(fits).toBe(true)
                await page.keyboard.press('Escape')
                await expect(menu).toHaveCount(0)
            }
            await row(list, 'Default').locator('.manager-more').tap()
            await page.getByRole('menuitem', { name: 'Duplicate' }).tap()
            await expect(list.locator('.manager-rename')).toBeFocused()
            await page.keyboard.press('Enter')
            expect(await tree(page)).toBe(
                'Default Default (2) Other [Verse: Lead Fill] Bass Drums [Outro: Pad]',
            )
        })
    })
}
