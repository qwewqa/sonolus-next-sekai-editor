import { expect, test, type Locator, type Page } from '@playwright/test'
import type { LevelDataEntity } from '@sonolus/core'
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

type Seed = [name: string, folder?: string][]

/**
 * Loads the notes fixture with these groups, in folders by name. The first two
 * groups own the fixture's notes. Folders sit at their first member, or at the
 * end when empty.
 */
const seedGroups = (page: Page, groups: Seed, emptyFolders: string[] = []) =>
    page.evaluate(
        ({ groups, emptyFolders }) => {
            const { history, view, fixtures, settings } = window.editorTest
            const chart = structuredClone(fixtures.notes)
            chart.isDynamicStages = true
            const folderIds = new Map<string, number>()
            const folderOf = (name: string) => {
                let id = folderIds.get(name)
                if (id === undefined) folderIds.set(name, (id = 9000 + folderIds.size))
                return id
            }
            chart.groups = new Map(
                groups.map(([name, folder], i) => [
                    (i < 2 ? i + 1 : 1000 + i) as never,
                    folder === undefined ? { name } : { name, folderId: folderOf(folder) as never },
                ]),
            )
            for (const name of emptyFolders) folderOf(name)
            chart.groupFolders = new Map(
                [...folderIds].map(([name, id]) => [
                    id as never,
                    { name, index: emptyFolders.includes(name) ? Infinity : 0 },
                ]),
            )
            history.resetState(false, chart, 0, 'folders.json')
            view.groupId = undefined
            view.stageId = undefined
            view.groupVisibility = new Map()
            view.stageVisibility = new Map()
            settings.showGroups = true
        },
        { groups, emptyFolders },
    )

/** The groups as a compact tree: `name` or `[Folder: a b]`. */
const tree = (page: Page) =>
    page.evaluate(() => {
        const { groups, groupFolders } = window.editorTest.history.state.value
        const parts: string[] = []
        let open: number | undefined
        const close = () => {
            if (open !== undefined) parts[parts.length - 1] += ']'
            open = undefined
        }
        const emptyAt = new Map<number, string[]>()
        const used = new Set([...groups.values()].flatMap(({ folderId }) => folderId ?? []))
        for (const [id, folder] of groupFolders)
            if (!used.has(id))
                emptyAt.set(folder.index, [...(emptyAt.get(folder.index) ?? []), folder.name])
        let index = 0
        for (const { name, folderId } of groups.values()) {
            for (const empty of emptyAt.get(index) ?? []) {
                close()
                parts.push(`[${empty}:]`)
            }
            index++
            if (folderId !== open) {
                close()
                if (folderId !== undefined) {
                    parts.push(`[${groupFolders.get(folderId)?.name}: ${name}`)
                    open = folderId
                    continue
                }
            } else if (folderId !== undefined) {
                parts[parts.length - 1] += ` ${name}`
                continue
            }
            parts.push(name)
        }
        close()
        for (const [at, names] of emptyAt)
            if (at >= index) for (const n of names) parts.push(`[${n}:]`)
        return parts.join(' ')
    })

const panel = (page: Page) => page.locator('#workspace-panel-groups')

const nameButton = (scope: Locator, name: string) =>
    scope.locator('.manager-name').filter({
        has: scope.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

const folderRow = (page: Page, name: string) =>
    panel(page)
        .locator('.manager-folder-row')
        .filter({
            has: page.locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
        })

const entryRow = (page: Page, name: string) =>
    panel(page)
        .locator('.manager-entry')
        .filter({
            has: page.locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
        })

const canUndo = (page: Page) => page.evaluate(() => window.editorTest.history.canUndo.value)

const undo = (page: Page) => page.evaluate(() => window.editorTest.history.undoState())

test.describe('level data', () => {
    const entities = (extra: LevelDataEntity[]): LevelDataEntity[] => [
        { archetype: 'Initialization', data: [{ name: 'initialLife', value: 1000 }] },
        {
            archetype: '#BPM_CHANGE',
            data: [
                { name: '#BEAT', value: 0 },
                { name: '#BPM', value: 60 },
            ],
        },
        ...extra,
    ]
    const group = (name: string, editorName: string, folder?: string): LevelDataEntity => ({
        archetype: '#TIMESCALE_GROUP',
        name,
        data: [
            { name: 'editorName', ref: editorName },
            ...(folder === undefined ? [] : [{ name: 'editorFolder', ref: folder }]),
        ],
    })
    const folder = (
        name: string,
        editorName: string,
        index?: number,
        parent?: string,
    ): LevelDataEntity => ({
        archetype: 'EditorGroupFolder',
        name,
        data: [
            { name: 'editorName', ref: editorName },
            ...(index === undefined ? [] : [{ name: 'editorIndex', value: index }]),
            ...(parent === undefined ? [] : [{ name: 'editorFolder', ref: parent }]),
        ],
    })

    /** Parses, saves and parses again, returning both trees and the saved entities. */
    const roundTrip = (page: Page, input: LevelDataEntity[], folders = true) =>
        page.evaluate(
            async ({ input, folders }) => {
                const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
                const { serializeToLevelDataEntities } =
                    await import('/src/levelData/entities/serialize/index.ts')
                const { buildFolderTree } = await import('/src/chart/folders.ts')
                const { createState } = await import('/src/state/index.ts')
                const show = (chart: ReturnType<typeof parseLevelDataChart>) =>
                    buildFolderTree(chart.groups, chart.groupFolders ?? new Map())
                        .map((item) =>
                            item.type === 'entry'
                                ? chart.groups.get(item.id)?.name
                                : `[${chart.groupFolders?.get(item.id)?.name}: ${item.members
                                      .map((id) => chart.groups.get(id)?.name)
                                      .join(' ')}]`,
                        )
                        .join(' ')
                const chart = parseLevelDataChart(input)
                const state = createState(chart, 0)
                const output = serializeToLevelDataEntities(
                    state.initialLife,
                    state.isDynamicStages,
                    state.store,
                    state.groups,
                    state.stages,
                    folders
                        ? { groups: state.groupFolders, stages: state.stageFolders }
                        : undefined,
                )
                return {
                    before: show(chart),
                    after: show(parseLevelDataChart(output)),
                    stageFolders: chart.stageFolders?.size ?? 0,
                    output,
                }
            },
            { input, folders },
        )

    test('folders, members and empty folders round-trip', async ({ page }) => {
        const result = await roundTrip(
            page,
            entities([
                group('g0', 'Default'),
                group('g1', 'Lead', 'f0'),
                group('g2', 'Bass'),
                group('g3', 'Echo', 'f0'),
                folder('f0', 'Verse', 1),
                folder('f1', 'Empty', 3),
            ]),
        )
        // Members gather at the folder's first member.
        expect(result.before).toBe('Default [Verse: Lead Echo] Bass [Empty: ]')
        expect(result.after).toBe(result.before)

        const folders = result.output.filter(
            (entity): entity is LevelDataEntity => entity.archetype === 'EditorGroupFolder',
        )
        expect(folders.map((entity) => entity.data)).toEqual([
            [
                { name: 'editorName', ref: 'Verse' },
                { name: 'editorIndex', value: 1 },
            ],
            [
                { name: 'editorName', ref: 'Empty' },
                { name: 'editorIndex', value: 4 },
            ],
        ])
        const refs = result.output
            .filter((entity) => entity.archetype === '#TIMESCALE_GROUP')
            .map((entity) => entity.data.find((data) => data.name === 'editorFolder'))
        expect(refs).toEqual([
            undefined,
            { name: 'editorFolder', ref: folders[0]?.name },
            { name: 'editorFolder', ref: folders[0]?.name },
            undefined,
        ])
    })

    test('blank group and folder names load as default names', async ({ page }) => {
        const result = await roundTrip(
            page,
            entities([
                group('g0', 'Default'),
                group('g1', '', 'f0'),
                group('g2', '  '),
                folder('f0', ' '),
            ]),
        )
        expect(result.before).toBe('Default [f0: #1] #2')
    })

    test('levels without folders and clipboard data carry no folder data', async ({ page }) => {
        const plain = await roundTrip(page, entities([group('g0', 'Default'), group('g1', 'Lead')]))
        const clipboard = await roundTrip(
            page,
            entities([group('g0', 'Default'), group('g1', 'Lead', 'f0'), folder('f0', 'Verse')]),
            false,
        )
        for (const { output } of [plain, clipboard])
            expect(
                output.some(
                    (entity) =>
                        entity.archetype.startsWith('Editor') ||
                        entity.data.some((data) => data.name === 'editorFolder'),
                ),
            ).toBe(false)
    })

    test('nested folders from a later version flatten into their top-level ancestor', async ({
        page,
    }) => {
        const result = await roundTrip(
            page,
            entities([
                group('g0', 'Default'),
                group('g1', 'Lead', 'inner'),
                group('g2', 'Bass', 'outer'),
                group('g3', 'Deep', 'deepest'),
                folder('outer', 'Song', 1),
                folder('inner', 'Verse', 1, 'outer'),
                folder('deepest', 'Bar', 1, 'inner'),
                // A cycle neither hangs nor loses its members.
                folder('x', 'X', 9, 'y'),
                folder('y', 'Y', 9, 'x'),
                group('g4', 'Loop', 'x'),
            ]),
        )
        expect(result.before).toBe('Default [Song: Lead Bass Deep] [X: Loop]')
    })

    test('stage folders exist only with dynamic stages', async ({ page }) => {
        const stageFolder: LevelDataEntity = {
            archetype: 'EditorStageFolder',
            name: 's',
            data: [{ name: 'editorName', ref: 'Stages' }],
        }
        const off = await roundTrip(page, entities([group('g0', 'Default'), stageFolder]))
        expect(off.stageFolders).toBe(0)
        const on = await roundTrip(
            page,
            entities([
                group('g0', 'Default'),
                {
                    archetype: 'Stage',
                    name: 'st',
                    data: [
                        { name: 'editorName', ref: 'Main' },
                        { name: 'fromStart', value: 1 },
                        { name: 'untilEnd', value: 1 },
                        { name: 'editorFolder', ref: 's' },
                    ],
                },
                stageFolder,
            ]),
        )
        expect(on.stageFolders).toBe(1)
        expect(on.output.filter((entity) => entity.archetype === 'EditorStageFolder')).toHaveLength(
            1,
        )
        expect(
            on.output
                .find((entity) => entity.archetype === 'Stage')
                ?.data.some((data) => data.name === 'editorFolder'),
        ).toBe(true)
    })

    test('saving and reopening keeps folders', async ({ page }) => {
        await seedGroups(
            page,
            [['Default'], ['Lead', 'Verse'], ['Echo', 'Verse'], ['Bass']],
            ['Empty'],
        )
        const reopened = await page.evaluate(async () => {
            const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
            const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
            const { history } = window.editorTest
            const state = history.state.value
            const data = serializeToLevelData(
                state.initialLife,
                state.isDynamicStages,
                0,
                state.store,
                state.groups,
                state.stages,
                { groups: state.groupFolders, stages: state.stageFolders },
            )
            history.resetState(false, parseLevelDataChart(data.entities), 0, 'reopened.json')
        })
        expect(reopened).toBeUndefined()
        expect(await tree(page)).toBe('Default [Verse: Lead Echo] Bass [Empty:]')
    })
})

test('folders show their members indented, collapse without an edit, and count objects', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    const verse = folderRow(page, 'Verse')
    await expect(verse).toBeVisible()
    // The folder counts its members' objects.
    await expect(verse.locator('.manager-meta')).toHaveText(
        await entryRow(page, 'Lead').locator('.manager-meta').innerText(),
    )
    const name = verse.locator('.manager-name')
    await expect(name).toHaveAttribute('aria-expanded', 'true')
    const members = page.locator(`#${await name.getAttribute('aria-controls')}`)
    await expect(members.locator('.manager-entry')).toHaveCount(2)
    // Members' names sit right of loose names; eyes stay in one column.
    const loose = (await nameButton(panel(page), 'Default').boundingBox())!
    const member = (await nameButton(panel(page), 'Lead').boundingBox())!
    expect(member.x).toBeGreaterThan(loose.x + 12)
    const eyes = await panel(page)
        .locator('.manager-entries .manager-eye')
        .evaluateAll((elements) => elements.map((e) => Math.round(e.getBoundingClientRect().x)))
    expect(new Set(eyes).size).toBe(1)

    await name.click()
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await expect(entryRow(page, 'Lead')).toHaveCount(0)
    expect(await canUndo(page)).toBe(false)
    // Keyboard: Right expands, Left collapses, Left on a member goes to its folder.
    await name.focus()
    await page.keyboard.press('ArrowRight')
    await expect(name).toHaveAttribute('aria-expanded', 'true')
    await nameButton(panel(page), 'Fill').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(name).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(entryRow(page, 'Fill')).toHaveCount(0)

    // Focusing a member of a collapsed folder opens it.
    await page.evaluate(() => {
        window.editorTest.view.groupId = 2 as never
    })
    await expect(name).toHaveAttribute('aria-expanded', 'true')
    await expect(entryRow(page, 'Lead')).toHaveClass(/manager-row-current/)
})

test('an empty folder controls no member list', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse']], ['Empty'])
    const empty = folderRow(page, 'Empty').locator('.manager-name')
    await expect(empty).toHaveAttribute('aria-expanded', 'true')
    await expect(empty).not.toHaveAttribute('aria-controls')
    const verse = folderRow(page, 'Verse').locator('.manager-name')
    const id = await verse.getAttribute('aria-controls')
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
})

test('the folder eye hides or shows all members, shows partial state and solos', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    const eye = folderRow(page, 'Verse').locator('.manager-eye')
    const visibility = () =>
        page.evaluate(() => {
            const { view, history } = window.editorTest
            return Object.fromEntries(
                [...view.groupVisibility].map(([id, value]) => [
                    history.state.value.groups.get(id)?.name,
                    value,
                ]),
            )
        })
    await expect(eye).toHaveAccessibleName('Hide Verse')
    await eye.click()
    expect(await visibility()).toEqual({ Lead: 'hidden', Fill: 'hidden' })
    await expect(eye).toHaveAccessibleName('Show Verse')

    // One member shown: partial; the eye then shows all.
    await entryRow(page, 'Lead').locator('.manager-eye').click()
    await expect(eye).toHaveAccessibleName('Show Verse')
    expect(await visibility()).toEqual({ Fill: 'hidden' })
    await eye.click()
    expect(await visibility()).toEqual({})

    // Alt+click shows only the folder's members, and again shows all.
    await eye.click({ modifiers: ['Alt'] })
    expect(await visibility()).toEqual({ Default: 'hidden', Outro: 'hidden' })
    await eye.click({ modifiers: ['Alt'] })
    expect(await visibility()).toEqual({})
})

test('groups move into and out of folders through the menu', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Bass'], ['Outro']])
    const menu = page.getByRole('menu')
    await entryRow(page, 'Bass').getByRole('button', { name: 'More Actions for Bass' }).click()
    await menu.getByRole('menuitem', { name: 'Move to Folder…' }).click()
    // The menu swaps to the folder choice in place.
    await expect(menu).toHaveAccessibleName('Move to Folder…')
    await expect(menu.getByRole('menuitemradio', { name: 'No Folder' })).toHaveAttribute(
        'aria-checked',
        'true',
    )
    await menu.getByRole('menuitemradio', { name: 'Verse' }).click()
    await expect(menu).toHaveCount(0)
    expect(await tree(page)).toBe('Default [Verse: Lead Bass] Outro')

    // Out again, just below the folder.
    await entryRow(page, 'Lead').getByRole('button', { name: 'More Actions for Lead' }).click()
    await menu.getByRole('menuitem', { name: 'Move to Folder…' }).click()
    await menu.getByRole('menuitemradio', { name: 'No Folder' }).click()
    expect(await tree(page)).toBe('Default [Verse: Bass] Lead Outro')

    // New Folder… creates a folder holding the group and names it.
    await entryRow(page, 'Outro').getByRole('button', { name: 'More Actions for Outro' }).click()
    await menu.getByRole('menuitem', { name: 'Move to Folder…' }).click()
    await menu.getByRole('menuitem', { name: 'New Folder…' }).click()
    const input = panel(page).getByRole('textbox')
    await expect(input).toBeFocused()
    await input.fill('Ending')
    await input.press('Enter')
    expect(await tree(page)).toBe('Default [Verse: Bass] Lead [Ending: Outro]')

    // Each step is one undo.
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Bass] Lead [#1: Outro]')
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Bass] Lead Outro')
})

test('stepping crosses folder edges and folders move as blocks', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    await nameButton(panel(page), 'Default').focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect(await tree(page)).toBe('[Verse: Default Lead Fill] Outro')
    await expect(nameButton(panel(page), 'Default')).toBeFocused()
    await page.keyboard.press('Alt+ArrowUp')
    expect(await tree(page)).toBe('Default [Verse: Lead Fill] Outro')

    const menu = page.getByRole('menu')
    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await expect(menu.getByRole('menuitem', { name: 'Edit Group Properties' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Move Folder Down' }).click()
    expect(await tree(page)).toBe('Default Outro [Verse: Lead Fill]')
})

test('dragging joins, reorders and leaves folders', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Bass'], ['Outro']])
    const center = async (locator: Locator) => {
        const box = (await locator.boundingBox())!
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const dragTo = async (
        from: Locator,
        y: (to: { x: number; y: number }) => number,
        to: Locator,
    ) => {
        const start = await center(from)
        const target = await center(to)
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        for (let step = 1; step <= 10; step++)
            await page.mouse.move(start.x, start.y + ((y(target) - start.y) * step) / 10)
        await page.mouse.up()
    }

    // Onto a folder row: joins at its end, with the row marked while held.
    const outro = nameButton(panel(page), 'Outro')
    const verse = folderRow(page, 'Verse')
    const start = await center(outro)
    const target = await center(verse)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++)
        await page.mouse.move(start.x, start.y + ((target.y - start.y) * step) / 10)
    await expect(verse).toHaveClass(/manager-row-drop/)
    await page.mouse.up()
    expect(await tree(page)).toBe('Default [Verse: Lead Fill Outro] Bass')

    // Between members: into the folder at that place.
    await dragTo(
        nameButton(panel(page), 'Bass'),
        (to) => to.y - 18,
        nameButton(panel(page), 'Fill'),
    )
    expect(await tree(page)).toBe('Default [Verse: Lead Bass Fill Outro]')

    // Between loose rows: out of the folder.
    await dragTo(nameButton(panel(page), 'Lead'), (to) => to.y - 18, verse)
    expect(await tree(page)).toBe('Default Lead [Verse: Bass Fill Outro]')

    // A folder moves with its members and lands only between top-level rows.
    await dragTo(verse, (to) => to.y - 18, nameButton(panel(page), 'Default'))
    expect(await tree(page)).toBe('[Verse: Bass Fill Outro] Default Lead')
})

test('a drag held still near the list edge keeps scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 600 })
    await seedGroups(page, [
        ['Default'],
        ...Array.from({ length: 30 }, (_, i): [string] => [`Part ${i + 1}`]),
    ])
    const list = panel(page).locator('.manager-entries')
    const bounds = (await list.boundingBox())!
    const part = (await nameButton(panel(page), 'Part 1').boundingBox())!
    await page.mouse.move(part.x + 60, part.y + part.height / 2)
    await page.mouse.down()
    await page.mouse.move(part.x + 60, bounds.y + bounds.height - 10, { steps: 10 })
    const end = await list.evaluate((element) => element.scrollHeight - element.clientHeight)
    // Without further moves it scrolls all the way, and the row lands at the end.
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(end - 2)
    await page.mouse.up()
    expect((await tree(page)).endsWith('Part 30 Part 1')).toBe(true)
})

test('a drag stops scrolling at the last row', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 600 })
    await seedGroups(page, [
        ['Default'],
        ...Array.from({ length: 20 }, (_, i): [string] => [`Part ${i + 1}`]),
    ])
    const list = panel(page).locator('.manager-entries')
    const end = await list.evaluate((element) => element.scrollHeight - element.clientHeight)
    const bounds = (await list.boundingBox())!
    const part = (await nameButton(panel(page), 'Part 1').boundingBox())!
    await page.mouse.move(part.x + 60, part.y + part.height / 2)
    await page.mouse.down()
    // Moving on at the edge carries the held row past the rows; the list stops there.
    for (let step = 0; step < 120; step++)
        await page.mouse.move(part.x + 60 + (step % 2), bounds.y + bounds.height - 10)
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(end - 2)
    await page.waitForTimeout(300)
    expect(await list.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(end)
    // The held row stays in sight: the fade toward the hidden Add is off.
    expect(await list.evaluate((element) => getComputedStyle(element).maskImage)).not.toContain(
        '100% - 24px',
    )
    await expect(nameButton(panel(page), 'Part 20')).toBeInViewport()
    await page.mouse.up()
    expect((await tree(page)).endsWith('Part 20 Part 1')).toBe(true)
})

for (const { device, viewport, touch } of [
    { device: 'desktop', viewport: { width: 1600, height: 1000 }, touch: false },
    { device: 'phone', viewport: { width: 390, height: 844 }, touch: true },
]) {
    test.describe(`end of a folder (${device})`, () => {
        test.use({ viewport, isMobile: touch, hasTouch: touch })

        test('the upper half below a last member joins the folder, the lower half stays out', async ({
            page,
        }) => {
            // Room for the rows on a phone, where the panel shares the screen.
            await page.evaluate(() => {
                window.editorTest.settings.topDockHeight = 600
            })
            const client = touch ? await page.context().newCDPSession(page) : undefined
            /** Drags a row by its name (mouse) or handle (touch) to `y`, held at `left`, and drops it. */
            const drop = async (name: string, y: number, left: number) => {
                const handle = touch
                    ? entryRow(page, name).locator('.manager-grip')
                    : nameButton(panel(page), name)
                const box = (await handle.boundingBox())!
                const x = box.x + box.width / 2
                const from = box.y + box.height / 2
                if (client) {
                    await client.send('Input.dispatchTouchEvent', {
                        type: 'touchStart',
                        touchPoints: [{ x, y: from }],
                    })
                    for (let step = 1; step <= 10; step++)
                        await client.send('Input.dispatchTouchEvent', {
                            type: 'touchMove',
                            touchPoints: [{ x, y: from + ((y - from) * step) / 10 }],
                        })
                } else {
                    await page.mouse.move(x, from)
                    await page.mouse.down()
                    await page.mouse.move(x, y, { steps: 10 })
                }
                // The held row previews the depth it lands at.
                await expect
                    .poll(async () => (await nameButton(panel(page), name).boundingBox())!.x)
                    .toBe(left)
                if (client)
                    await client.send('Input.dispatchTouchEvent', {
                        type: 'touchEnd',
                        touchPoints: [],
                    })
                else await page.mouse.up()
            }
            const center = async (name: string) => {
                const box = (await nameButton(panel(page), name).boundingBox())!
                return box.y + box.height / 2
            }

            for (const [seed, joined, outside] of [
                [
                    [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro'], ['Bass']],
                    'Default [Verse: Lead Fill Bass] Outro',
                    'Default [Verse: Lead Fill] Bass Outro',
                ],
                // At the end of the list, below a folder.
                [
                    [['Default'], ['Bass'], ['Lead', 'Verse'], ['Fill', 'Verse']],
                    'Default [Verse: Lead Fill Bass]',
                    'Default [Verse: Lead Fill] Bass',
                ],
            ] as const) {
                await seedGroups(page, seed.map((row) => [...row]) as [string, string?][])
                const member = (await nameButton(panel(page), 'Fill').boundingBox())!.x
                const loose = (await nameButton(panel(page), 'Default').boundingBox())!.x
                const fill = await center('Fill')
                // Rows are 40px (48px coarse) with a 4px gap: the halves split at the gap's middle.
                const half = touch ? 26 : 22
                await drop('Bass', fill + half - 6, member)
                expect(await tree(page)).toBe(joined)
                await undo(page)
                await drop('Bass', fill + half + 6, loose)
                expect(await tree(page)).toBe(outside)
            }
        })
    })
}

test('a held row takes the indent of where it would land', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro'], ['Bass']])
    const left = async (name: string) => (await nameButton(panel(page), name).boundingBox())!.x
    const loose = await left('Default')
    const member = await left('Fill')
    const hold = async (name: string, y: number) => {
        const box = (await nameButton(panel(page), name).boundingBox())!
        await page.mouse.move(box.x + 60, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + 60, y, { steps: 10 })
    }
    const marked = () =>
        panel(page)
            .locator('li.manager-dragged')
            .evaluate((element) => getComputedStyle(element, '::after').content)

    // A loose row between members indents, with the folder's line through its pill.
    await hold('Bass', (await nameButton(panel(page), 'Fill').boundingBox())!.y + 2)
    expect(await left('Bass')).toBe(member)
    expect(await marked()).not.toBe('none')
    // The folder's guide line runs on across the slot opened for it.
    const breaks = await panel(page)
        .locator('.manager-members > li:not(.manager-dragged)')
        .evaluateAll((members) =>
            members.slice(1).flatMap((member, index) => {
                const above = members[index]!.getBoundingClientRect()
                const top =
                    member.getBoundingClientRect().top +
                    parseFloat(getComputedStyle(member, '::before').top)
                return top > above.bottom + 0.5 ? [Math.round(top - above.bottom)] : []
            }),
        )
    expect(breaks).toEqual([])
    await page.mouse.up()
    expect(await tree(page)).toBe('Default [Verse: Lead Bass Fill] Outro')

    // A member below the folder's last member outdents: it would land loose.
    await hold('Lead', (await nameButton(panel(page), 'Outro').boundingBox())!.y + 4)
    expect(await left('Lead')).toBe(loose)
    expect(await marked()).toBe('none')
    await page.mouse.up()
    expect(await tree(page)).toBe('Default [Verse: Bass Fill] Lead Outro')
})

test('a collapsed folder held over opens and keeps the dragged row under the pointer', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro'], ['Bass']])
    const verse = folderRow(page, 'Verse')
    await verse.locator('.manager-name').click()
    await expect(verse.locator('.manager-name')).toHaveAttribute('aria-expanded', 'false')
    const bass = (await nameButton(panel(page), 'Bass').boundingBox())!
    const head = (await verse.boundingBox())!
    const x = bass.x + 60
    const y = head.y + head.height / 2
    await page.mouse.move(x, bass.y + bass.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 10 })
    await expect(verse.locator('.manager-name')).toHaveAttribute('aria-expanded', 'true')
    await expect(verse).toHaveClass(/manager-row-drop/)
    // The members opened above the held row; it stays where the pointer is.
    const held = (await entryRow(page, 'Bass').boundingBox())!
    expect(Math.abs(held.y + held.height / 2 - y)).toBeLessThan(4)
    await page.mouse.up()
    expect(await tree(page)).toBe('Default [Verse: Lead Fill Bass] Outro')
})

test('ungrouping keeps members; deleting a folder confirms and removes them', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro', 'Ending']])
    const menu = page.getByRole('menu')
    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await menu.getByRole('menuitem', { name: 'Ungroup' }).click()
    expect(await tree(page)).toBe('Default Lead Fill [Ending: Outro]')
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Lead Fill] [Ending: Outro]')

    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    const remove = menu.getByRole('menuitem', { name: 'Delete Folder and Groups…' })
    await expect(remove).toHaveClass(/text-danger/)
    await remove.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete the Verse folder, its groups (2)')
    // Cancel changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await tree(page)).toBe('Default [Verse: Lead Fill] [Ending: Outro]')

    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await menu.getByRole('menuitem', { name: 'Delete Folder and Groups…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    expect(await tree(page)).toBe('Default [Ending: Outro]')
    // The fixture's notes in Lead went with it; undo brings everything back.
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Lead Fill] [Ending: Outro]')
})

test('undoing an ungroup or a delete brings a collapsed folder back collapsed', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse']])
    const menu = page.getByRole('menu')
    const verse = nameButton(panel(page), 'Verse')
    await verse.click()
    await expect(verse).toHaveAttribute('aria-expanded', 'false')
    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await menu.getByRole('menuitem', { name: 'Ungroup' }).click()
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Lead Fill]')
    await expect(verse).toHaveAttribute('aria-expanded', 'false')

    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await menu.getByRole('menuitem', { name: 'Delete Folder and Groups…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await undo(page)
    await expect(verse).toHaveAttribute('aria-expanded', 'false')
})

test('undoing a delete brings hidden groups and stages back hidden', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    const scope = (action?: 'group' | 'stage') =>
        page.evaluate(async (action) => {
            const { appImport, history, nextTick } = window.editorTest
            const { groupScope, stageScope } =
                await appImport<typeof import('../../src/editor/scope')>('/src/editor/scope.ts')
            if (action === 'group') {
                const { deleteGroup } = await appImport<
                    typeof import('../../src/editor/workspace/manager/groups')
                >('/src/editor/workspace/manager/groups.ts')
                deleteGroup(1003 as never)
            } else if (action === 'stage') {
                const { deleteStage } = await appImport<
                    typeof import('../../src/editor/workspace/manager/stages')
                >('/src/editor/workspace/manager/stages.ts')
                deleteStage(2 as never)
            }
            await nextTick()
            const { groups, stages } = history.state.value
            const of = <T>(ids: Map<T, unknown>, id: T, visibility: (id: T) => string) =>
                ids.has(id) ? visibility(id) : 'deleted'
            return [
                of(groups, 2 as never, groupScope.visibility),
                of(groups, 1003 as never, groupScope.visibility),
                of(stages, 2 as never, stageScope.visibility),
            ]
        }, action)
    await page.evaluate(async () => {
        const { appImport } = window.editorTest
        const { groupScope, stageScope } =
            await appImport<typeof import('../../src/editor/scope')>('/src/editor/scope.ts')
        groupScope.setSomeShown([2, 1003] as never[], false)
        stageScope.setShown(2 as never, false)
    })
    expect(await scope()).toEqual(['hidden', 'hidden', 'hidden'])

    // A folder deleted as a unit.
    const menu = page.getByRole('menu')
    await folderRow(page, 'Verse').getByRole('button', { name: 'More Actions for Verse' }).click()
    await menu.getByRole('menuitem', { name: 'Delete Folder and Groups…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    expect(await scope()).toEqual(['deleted', 'hidden', 'hidden'])
    await undo(page)
    expect(await scope()).toEqual(['hidden', 'hidden', 'hidden'])

    // A single group, then a stage.
    expect(await scope('group')).toEqual(['hidden', 'deleted', 'hidden'])
    await undo(page)
    expect(await scope()).toEqual(['hidden', 'hidden', 'hidden'])
    expect(await scope('stage')).toEqual(['hidden', 'hidden', 'deleted'])
    await undo(page)
    expect(await scope()).toEqual(['hidden', 'hidden', 'hidden'])
})

test('New Folder adds and names a folder at the end', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead']])
    await panel(page).getByRole('button', { name: 'New Folder', exact: true }).click()
    const input = panel(page).getByRole('textbox')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('#1')
    await input.press('Escape')
    await expect(page.locator('.notification')).toHaveText('Added #1 folder')
    expect(await tree(page)).toBe('Default Lead [#1:]')
    // Numbered like new groups and stages.
    await panel(page).getByRole('button', { name: 'New Folder', exact: true }).click()
    await expect(input).toHaveValue('#2')
    await input.press('Escape')
    expect(await tree(page)).toBe('Default Lead [#1:] [#2:]')
    // Folders rename by double click like other rows.
    await folderRow(page, '#1').locator('.manager-name').dblclick()
    await input.fill('Drums')
    await input.press('Enter')
    expect(await tree(page)).toBe('Default Lead [Drums:] [#2:]')
})

test('double clicks on a folder chevron only toggle it', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Outro']])
    const name = folderRow(page, 'Verse').locator('.manager-name')
    await folderRow(page, 'Verse').locator('.manager-chevron').dblclick()
    await expect(name).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page).locator('.manager-rename')).toHaveCount(0)
    // A second press on the label after one on the eye counts for neither.
    const client = await page.context().newCDPSession(page)
    for (const [locator, clickCount] of [
        [folderRow(page, 'Verse').locator('.manager-eye'), 1],
        [folderRow(page, 'Verse').locator('.manager-label'), 2],
    ] as const) {
        const box = (await locator.boundingBox())!
        const point = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            button: 'left' as const,
        }
        await client.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            ...point,
            clickCount,
        })
        await client.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...point,
            clickCount,
        })
    }
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await expect(panel(page).locator('.manager-rename')).toHaveCount(0)
    // The label still renames.
    await folderRow(page, 'Verse').locator('.manager-label').dblclick()
    await expect(panel(page).locator('.manager-rename')).toBeFocused()
})

test('pickers group options by folder and the status bar names shared names by folder', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Lead', 'Chorus'], ['Outro']])
    const labels = await page.evaluate(async () => {
        const { folderSections } = await import('/src/chart/folders.ts')
        const { groups, groupFolders } = window.editorTest.history.state.value
        return folderSections(groups, groupFolders).map(({ label, options }) => [
            label ?? null,
            options.map(([name]) => name),
        ])
    })
    expect(labels).toEqual([
        [null, ['Default']],
        ['Verse', ['Lead']],
        ['Chorus', ['Lead']],
        [null, ['Outro']],
    ])

    // The Properties panel's group field shows them as option groups.
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
        window.editorTest.settings.propertiesSection = 'view'
    })
    const select = page.locator('#workspace-panel-properties select').filter({
        has: page.locator('optgroup[label="Chorus"]'),
    })
    await expect(select).toHaveCount(1)

    await page.evaluate(() => {
        window.editorTest.view.groupId = 1002 as never
    })
    await expect(page.locator('.status-chip').filter({ hasText: 'Lead' })).toHaveText(
        /Chorus › Lead/,
    )
})

test('the folder holding the target names it and marks the line through it', async ({ page }) => {
    await seedGroups(page, [
        ['Default'],
        ['Lead', 'Verse'],
        ['Fill', 'Verse'],
        ['Echo', 'Verse'],
        ['Bass', 'Chorus'],
    ])
    const groupChip = page.locator('.status-chip').filter({ hasText: 'Group' })
    const verse = folderRow(page, 'Verse')
    const marked = (name: string) =>
        panel(page)
            .locator('.manager-members > li')
            .filter({
                has: page.locator('.manager-label', { hasText: new RegExp('^' + name + '$') }),
            })
            .evaluate((element) => getComputedStyle(element, '::after').content)

    // Fill, the target, sits in Verse.
    await page.evaluate(() => {
        window.editorTest.view.groupId = 1002 as never
    })
    await expect(verse.locator('.manager-name')).toHaveAttribute(
        'aria-description',
        'New objects are added to Verse › Fill',
    )
    await expect(folderRow(page, 'Chorus').locator('.manager-name')).not.toHaveAttribute(
        'aria-description',
        /.*/,
    )
    // The status bar always leads with the folder.
    await expect(groupChip).toHaveText('Verse › Fill Group')
    // A short stretch of line marks the target's pill, and only there.
    expect(await marked('Fill')).not.toBe('none')
    expect(await marked('Lead')).toBe('none')

    // Collapsed, the folder takes the target's pill.
    await nameButton(verse, 'Verse').click()
    await expect(verse).toHaveClass(/manager-row-current/)
    await expect(verse.locator('.manager-name')).toHaveAttribute(
        'aria-description',
        'New objects are added to Verse › Fill',
    )

    // A loose target marks no folder.
    await page.evaluate(() => {
        window.editorTest.view.groupId = 1 as never
    })
    await expect(panel(page).locator('.manager-name[aria-description]')).toHaveCount(0)
    await expect(groupChip).toHaveText('Default Group')
})

test('the folder line and its target mark keep showing in high contrast', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse']])
    await page.evaluate(() => {
        window.editorTest.view.groupId = 1002 as never
    })
    await expect(entryRow(page, 'Fill')).toHaveClass(/manager-row-current/)
    const text = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'CanvasText'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })
    const line = (name: string, pseudo: string) =>
        panel(page)
            .locator('.manager-members > li')
            .filter({
                has: page.locator('.manager-label', { hasText: new RegExp('^' + name + '$') }),
            })
            .evaluate(
                (element, pseudo) => getComputedStyle(element, pseudo).backgroundColor,
                pseudo,
            )
    expect(await line('Lead', '::before')).toBe(text)
    expect(await line('Fill', '::before')).toBe(text)
    expect(await line('Fill', '::after')).toBe(text)
})

test.describe('touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('a narrow status bar shortens the folder first and keeps the count', async ({ page }) => {
        await seedGroups(page, [['Default'], ['Lead Synth Layer', 'An Extremely Long Folder Name']])
        await page.evaluate(() => {
            const { view } = window.editorTest
            view.groupId = 2 as never
            view.groupVisibility = new Map([[1, 'hidden']]) as never
        })
        const chip = page.locator('.status-chip').filter({ hasText: 'Group' })
        await expect(chip).toContainText('· 1/2')
        const parts = await chip.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const folder = element.querySelector<HTMLElement>('.status-folder')!
            const spans = [...element.querySelectorAll<HTMLElement>('span')]
            const name = spans.find((span) => span.textContent === 'Lead Synth Layer')!
            const count = spans.find((span) => span.textContent.startsWith('· '))!
            return {
                folderTruncated: folder.scrollWidth > folder.clientWidth,
                folderWidth: folder.clientWidth,
                nameWidth: name.clientWidth,
                countInside: count.getBoundingClientRect().right <= box.right + 0.5,
                countWidth: count.getBoundingClientRect().width,
            }
        })
        expect(parts.folderTruncated).toBe(true)
        // The folder gave way first: the name keeps more room than the folder.
        expect(parts.nameWidth).toBeGreaterThan(parts.folderWidth)
        expect(parts.countInside).toBe(true)
        expect(parts.countWidth).toBeGreaterThan(0)
        // The status bar's division, not the toolbar's.
        const bar = chip.locator('..')
        await expect(bar.getByText('1/4', { exact: true })).toBeInViewport()
    })

    test('double taps on a chevron or across controls never rename', async ({ page }) => {
        await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Outro']])
        await page.evaluate(() => {
            window.editorTest.view.groupId = 1002 as never
        })
        const client = await page.context().newCDPSession(page)
        // Two quick taps, the second where the first was or on another control.
        const doubleTap = async (first: Locator, second = first) => {
            const points = []
            for (const locator of [first, second]) {
                const box = (await locator.boundingBox())!
                points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
            }
            for (const point of points) {
                await client.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [point],
                })
                await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
                // Taps closer than 40ms are no double tap.
                await page.waitForTimeout(80)
            }
            // Past the double-tap delay, so the next pair starts afresh.
            await page.waitForTimeout(600)
        }
        const rename = panel(page).locator('.manager-rename')
        const verse = folderRow(page, 'Verse')
        await doubleTap(verse.locator('.manager-chevron'))
        await expect(verse.locator('.manager-name')).toHaveAttribute('aria-expanded', 'true')
        await expect(rename).toHaveCount(0)

        // A tap on the eye and then the name is no double tap on the name.
        await doubleTap(verse.locator('.manager-eye'), verse.locator('.manager-label'))
        await expect(rename).toHaveCount(0)
        const outro = entryRow(page, 'Outro')
        await doubleTap(outro.locator('.manager-eye'), outro.locator('.manager-label'))
        await expect(rename).toHaveCount(0)

        // Two taps on the target's name still rename it.
        await doubleTap(outro.locator('.manager-label'))
        await expect(rename).toBeFocused()
    })

    test('a long press on a folder opens its menu', async ({ page }) => {
        await seedGroups(page, [['Default'], ['Lead', 'Verse']])
        const name = folderRow(page, 'Verse').locator('.manager-name')
        await expect(name).toBeVisible()
        const box = (await name.boundingBox())!
        const client = await page.context().newCDPSession(page)
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await page.waitForTimeout(700)
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        const menu = page.getByRole('menu')
        await expect(menu).toHaveAccessibleName('More Actions for Verse')
        // The tap that ended the long press did not also collapse the folder.
        await expect(name).toHaveAttribute('aria-expanded', 'true')
    })

    test('a long press focuses the menu without a keyboard highlight', async ({ page }) => {
        await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Outro']])
        const client = await page.context().newCDPSession(page)
        for (const row of [folderRow(page, 'Verse'), entryRow(page, 'Outro')]) {
            const box = (await row.locator('.manager-name').boundingBox())!
            const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            await client.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [point],
            })
            await page.waitForTimeout(700)
            await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            const menu = page.getByRole('menu')
            await expect(menu.getByRole('menuitem').first()).toBeFocused()
            expect(
                await page.evaluate(() => document.activeElement?.matches(':focus-visible')),
            ).toBe(false)
            await page.keyboard.press('Escape')
            await expect(menu).toHaveCount(0)
        }
    })
})

test('stages get folders too when dynamic stages are on', async ({ page }) => {
    await seedGroups(page, [['Default']])
    await page.evaluate(() => {
        window.editorTest.settings.showStages = true
    })
    const stages = page.locator('#workspace-panel-stages')
    await expect(stages.locator('.manager-entry').first()).toBeVisible()
    await stages.getByRole('button', { name: 'New Folder', exact: true }).click()
    const input = stages.getByRole('textbox')
    await input.fill('Intro')
    await input.press('Enter')
    const menu = page.getByRole('menu')
    await stages.locator('.manager-entry .manager-more').first().click()
    await menu.getByRole('menuitem', { name: 'Move to Folder…' }).click()
    await menu.getByRole('menuitemradio', { name: 'Intro' }).click()
    expect(
        await page.evaluate(() => {
            const { stages, stageFolders } = window.editorTest.history.state.value
            return [...stages.values()].flatMap(({ folderId }) =>
                folderId === undefined ? [] : [stageFolders.get(folderId)?.name],
            )
        }),
    ).toEqual(['Intro'])
    await expect(
        stages.locator('.manager-folder-row').getByRole('button', {
            name: 'More Actions for Intro',
        }),
    ).toBeVisible()
})

test('a collapsed folder holding the target stands in for it with the pill', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    const verse = folderRow(page, 'Verse')
    const name = verse.locator('.manager-name')
    await nameButton(panel(page), 'Fill').click()
    await expect(verse).not.toHaveClass(/manager-row-current/)

    await name.click()
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await expect(verse).toHaveClass(/manager-row-current/)
    // The folder is never the target itself; it only says where the target is.
    await expect(name).not.toHaveAttribute('aria-current')
    await expect(name).toHaveAttribute('title', /New objects are added to Verse › Fill/)

    // Another target elsewhere leaves the folder plain.
    await nameButton(panel(page), 'Outro').click()
    await expect(verse).not.toHaveClass(/manager-row-current/)
})

test("a folder's menu adds a group into it in one step", async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Outro']])
    const verse = folderRow(page, 'Verse')
    await verse.locator('.manager-name').click()
    await expect(verse.locator('.manager-name')).toHaveAttribute('aria-expanded', 'false')
    await verse.getByRole('button', { name: 'More Actions for Verse' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Add Group' }).click()
    // The folder opens and the new group is named right away.
    const input = panel(page).getByRole('textbox')
    await expect(input).toBeFocused()
    await input.fill('Echo')
    await input.press('Enter')
    await expect(verse.locator('.manager-name')).toHaveAttribute('aria-expanded', 'true')
    expect(await tree(page)).toBe('Default [Verse: Lead Echo] Outro')
    // Adding into the folder is one step; naming is the next.
    await undo(page)
    await undo(page)
    expect(await tree(page)).toBe('Default [Verse: Lead] Outro')
})

test("a folder's row stays at the top while its members scroll by", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 600 })
    await seedGroups(page, [
        ['Default'],
        ['Intro'],
        ...Array.from({ length: 16 }, (_, i): [string, string] => [`Part ${i + 1}`, 'Chorus']),
        ['Outro'],
    ])
    const list = panel(page).locator('.manager-entries')
    const head = panel(page).locator('.manager-folder-head')
    await list.evaluate((element) => (element.scrollTop = 400))
    const top = (await list.boundingBox())!.y
    await expect.poll(async () => Math.round((await head.boundingBox())!.y - top)).toBe(0)
    // The members passing under it are covered, not drawn over it.
    const covered = await head.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return element.contains(hit)
    })
    expect(covered).toBe(true)

    // Revealing a member keeps it clear of the folder's row.
    await nameButton(panel(page), 'Part 1').focus()
    await page.keyboard.press('ArrowDown')
    await expect(nameButton(panel(page), 'Part 2')).toBeFocused()
    const part = (await nameButton(panel(page), 'Part 2').boundingBox())!
    const headBox = (await head.boundingBox())!
    expect(part.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 1)

    // Dragging measures rows where they lie, not where the folder's row sticks.
    await list.evaluate((element) => (element.scrollTop = 300))
    await expect.poll(async () => Math.round((await head.boundingBox())!.y - top)).toBe(0)
    const listBox = (await list.boundingBox())!
    const stuck = (await head.boundingBox())!
    const visible: { name: string; y: number; x: number }[] = []
    for (let i = 1; i <= 16; i++) {
        const box = (await nameButton(panel(page), `Part ${i}`).boundingBox())!
        if (box.y > stuck.y + stuck.height && box.y + box.height < listBox.y + listBox.height - 64)
            visible.push({ name: `Part ${i}`, y: box.y + box.height / 2, x: box.x + 40 })
    }
    const [, to, , from] = visible
    if (!to || !from) throw new Error('Too few visible members')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, to.y - 16, { steps: 8 })
    await page.mouse.up()
    // The held member now sits before the one it was dropped above.
    const order = await tree(page)
    expect(order.indexOf(`${from.name} `)).toBeLessThan(order.indexOf(`${to.name} `))
})

test('Up and Down step between names, Home and End reach the ends', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Fill', 'Verse'], ['Outro']])
    const all = panel(page).locator('.manager-all .manager-name')
    await all.focus()
    await page.keyboard.press('ArrowDown')
    await expect(nameButton(panel(page), 'Default')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(folderRow(page, 'Verse').locator('.manager-name')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(nameButton(panel(page), 'Lead')).toBeFocused()
    await page.keyboard.press('End')
    await expect(nameButton(panel(page), 'Outro')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(nameButton(panel(page), 'Fill')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(all).toBeFocused()
    // Moving focus is not an edit and never changes the target.
    expect(await canUndo(page)).toBe(false)
    expect(await page.evaluate(() => window.editorTest.view.groupId)).toBeUndefined()
    // Alt+arrows still reorder.
    await nameButton(panel(page), 'Default').focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect(await tree(page)).toBe('[Verse: Default Lead Fill] Outro')
})

/** How far each folder's guide line and target stretch sit from its chevron's center. */
const guideOffsets = (page: Page) =>
    panel(page).evaluate((panel) =>
        [...panel.querySelectorAll<HTMLElement>('.manager-members')].flatMap((members) => {
            const folder = members.closest('.manager-folder')!
            const chevron = folder.querySelector('.manager-chevron svg')!.getBoundingClientRect()
            const center = chevron.left + chevron.width / 2
            return [...members.children].flatMap((item) => {
                const box = item.getBoundingClientRect()
                return (['::before', '::after'] as const)
                    .map((pseudo) => getComputedStyle(item, pseudo))
                    .filter((style) => style.content !== 'none' && style.display !== 'none')
                    .map(
                        (style) =>
                            box.left +
                            parseFloat(style.left) +
                            parseFloat(style.width) / 2 -
                            center,
                    )
            })
        }),
    )

for (const { name, viewport, touch } of [
    { name: 'desktop', viewport: { width: 1600, height: 1000 }, touch: false },
    { name: 'laptop', viewport: { width: 1366, height: 768 }, touch: false },
    { name: 'tablet', viewport: { width: 820, height: 1180 }, touch: true },
    { name: 'landscape tablet', viewport: { width: 1180, height: 820 }, touch: true },
    { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
]) {
    test.describe(`guide alignment (${name})`, () => {
        test.use({ viewport, isMobile: touch, hasTouch: touch })

        test('the guide line and its target stretch run under the folder chevron', async ({
            page,
        }) => {
            await seedGroups(page, [
                ['Default'],
                ['Lead', 'Verse'],
                ['Fill', 'Verse'],
                ['Echo', 'Verse'],
            ])
            await page.evaluate(() => {
                window.editorTest.view.groupId = 1002 as never
            })
            await expect(folderRow(page, 'Verse')).toBeVisible()
            const offsets = await guideOffsets(page)
            // Three stretches of line and the one inside the target's pill.
            expect(offsets).toHaveLength(4)
            for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(0.5)
        })
    })
}

test('a double click whose first press only closed a menu counts as one click', async ({
    page,
}) => {
    await seedGroups(page, [['Default'], ['Lead', 'Verse'], ['Outro']])
    const name = folderRow(page, 'Verse').locator('.manager-name')
    await expect(name).toHaveAttribute('aria-expanded', 'true')
    await panel(page).locator('.manager-name', { hasText: 'Default' }).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const box = (await folderRow(page, 'Verse').locator('.manager-label').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect(menu).toHaveCount(0)
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await expect(panel(page).locator('.manager-rename')).toHaveCount(0)
    // A double click of its own still renames.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(600)
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect(panel(page).locator('.manager-rename')).toBeFocused()
})

for (const { device, viewport, touch } of [
    { device: 'desktop', viewport: { width: 1600, height: 1000 }, touch: false },
    { device: 'phone', viewport: { width: 390, height: 844 }, touch: true },
]) {
    test.describe(`long folder names (${device})`, () => {
        test.use({ viewport, isMobile: touch, hasTouch: touch })

        test('Move to Folder caps its width and truncates a long name', async ({ page }) => {
            const long = `Folder ${'long'.repeat(40)}`
            await seedGroups(page, [['Default'], ['Lead', long], ['Bass']])
            const menu = page.getByRole('menu')
            const more = entryRow(page, 'Bass').getByRole('button', {
                name: 'More Actions for Bass',
            })
            await (touch ? more.tap() : more.click())
            const move = menu.getByRole('menuitem', { name: 'Move to Folder…' })
            await (touch ? move.tap() : move.click())
            const item = menu.getByRole('menuitemradio', { name: long })
            await expect(item).toHaveAttribute('title', long)
            // At most 20rem, or the phone sheet's width; the name ends in an ellipsis.
            const box = (await menu.boundingBox())!
            if (touch) expect([box.x, box.width]).toEqual([8, viewport.width - 16])
            else expect(box.width).toBeLessThanOrEqual(320)
            const label = await item
                .locator('span')
                .last()
                .evaluate((span) => ({
                    overflow: getComputedStyle(span).textOverflow,
                    truncated: span.scrollWidth > span.clientWidth,
                    right: span.getBoundingClientRect().right,
                }))
            expect(label).toMatchObject({ overflow: 'ellipsis', truncated: true })
            expect(label.right).toBeLessThanOrEqual(box.x + box.width)
        })
    })
}
