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
    expect(await tree(page)).toBe('Default [Verse: Bass] Lead [Folder 1: Outro]')
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

test('New Folder adds and names a folder at the end', async ({ page }) => {
    await seedGroups(page, [['Default'], ['Lead']])
    await panel(page).getByRole('button', { name: 'New Folder', exact: true }).click()
    const input = panel(page).getByRole('textbox')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Folder 1')
    await input.press('Escape')
    expect(await tree(page)).toBe('Default Lead [Folder 1:]')
    // Folders rename by double click like other rows.
    await folderRow(page, 'Folder 1').locator('.manager-name').dblclick()
    await input.fill('Drums')
    await input.press('Enter')
    expect(await tree(page)).toBe('Default Lead [Drums:]')
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

test.describe('touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

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
