import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
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

/** Loads the notes fixture with these groups, in folders by name; the first two own the notes. */
const seedGroups = (page: Page, groups: Seed) =>
    page.evaluate(
        ({ groups }) => {
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
            chart.groupFolders = new Map(
                [...folderIds].map(([name, id]) => [id as never, { name, index: 0 }]),
            )
            history.resetState(false, chart, 0, 'selection.json')
            view.groupId = undefined
            view.stageId = undefined
            view.groupVisibility = new Map()
            view.stageVisibility = new Map()
            settings.showGroups = true
        },
        { groups },
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

const state = (page: Page) =>
    page.evaluate(() => {
        const { view, history } = window.editorTest
        const name = (id: number) => history.state.value.groups.get(id as never)?.name
        return {
            focus: view.groupId && name(view.groupId),
            hidden: [...view.groupVisibility]
                .filter(([, value]) => value === 'hidden')
                .map(([id]) => name(id)),
        }
    })

const panel = (page: Page) => page.locator('#workspace-panel-groups')

const nameButton = (scope: Locator, name: string) =>
    scope.locator('.manager-name').filter({
        has: scope.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

const row = (scope: Locator, name: string) =>
    scope.locator('.manager-row').filter({
        has: scope.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

/** Names of the checked entry rows, in order. */
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

const seed: Seed = [
    ['Default'],
    ['Other'],
    ['Lead', 'Verse'],
    ['Fill', 'Verse'],
    ['Bass'],
    ['Drums'],
    ['Pad', 'Outro'],
]

test('Ctrl-click and Shift-click select without changing the target; a plain click still does', async ({
    page,
}) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Other').click()
    expect((await state(page)).focus).toBe('Other')
    await expect(list.locator('.manager-check')).toHaveCount(0)

    await nameButton(list, 'Default').click({ modifiers: ['ControlOrMeta'] })
    await expect(list.locator('.manager-list')).toHaveClass(/manager-list-selecting/)
    expect(await checked(list)).toEqual(['Default'])
    // Ranges cover the rows in view from the last one toggled.
    await nameButton(list, 'Fill').click({ modifiers: ['Shift'] })
    expect(await checked(list)).toEqual(['Default', 'Other', 'Lead', 'Fill'])
    await nameButton(list, 'Other').click({ modifiers: ['Shift'] })
    expect(await checked(list)).toEqual(['Default', 'Other'])
    // While selecting, a plain click toggles too, and the target stays.
    await nameButton(list, 'Bass').click()
    expect(await checked(list)).toEqual(['Default', 'Other', 'Bass'])
    expect((await state(page)).focus).toBe('Other')
    await expect(row(list, 'Bass')).toHaveClass(/manager-row-selected/)
    await expect(list.locator('.manager-selection-bar')).toContainText('3 Selected')
    // Rows set their menus, drag handles and inline actions aside.
    await expect(list.locator('.manager-entry .manager-more')).toHaveCount(0)
    await expect(list.locator('.manager-entry .manager-eye')).toHaveCount(0)

    // Escape stops selecting; plain clicks choose the target again.
    await nameButton(list, 'Bass').focus()
    await page.keyboard.press('Escape')
    await expect(list.locator('.manager-check')).toHaveCount(0)
    await expect(list.locator('.manager-selection-bar')).toHaveCount(0)
    await expect(list.getByRole('button', { name: 'Add Group', exact: true })).toBeVisible()
    await nameButton(list, 'Bass').click()
    expect((await state(page)).focus).toBe('Bass')
    expect(await historyLength(page)).toBe(0)
})

test('ranges skip collapsed folders; folder and band checks select their entries', async ({
    page,
}) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await row(list, 'Verse').locator('.manager-name').click()
    await expect(row(list, 'Verse').locator('.manager-name')).toHaveAttribute(
        'aria-expanded',
        'false',
    )
    await nameButton(list, 'Other').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Drums').click({ modifiers: ['Shift'] })
    await row(list, 'Verse').locator('.manager-name').click()
    expect(await checked(list)).toEqual(['Other', 'Bass', 'Drums'])

    const verse = row(list, 'Verse').locator('.manager-check')
    await expect(verse).toHaveAttribute('aria-checked', 'false')
    await verse.click()
    expect(await checked(list)).toEqual(['Other', 'Lead', 'Fill', 'Bass', 'Drums'])
    await expect(verse).toHaveAttribute('aria-checked', 'true')
    await nameButton(list, 'Lead').click()
    await expect(verse).toHaveAttribute('aria-checked', 'mixed')
    // The folder's name still opens and closes it.
    await expect(row(list, 'Verse').locator('.manager-name')).toHaveAttribute(
        'aria-expanded',
        'true',
    )

    const all = list.locator('.manager-all .manager-check')
    await expect(all).toHaveAttribute('aria-checked', 'mixed')
    await all.click()
    expect(await checked(list)).toHaveLength(7)
    await list.locator('.manager-all .manager-name').click()
    expect(await checked(list)).toEqual([])
    // The band's Select button stops selecting too.
    const mode = list.getByRole('button', { name: 'Select Multiple' })
    await expect(mode).toHaveAttribute('aria-pressed', 'true')
    await mode.click()
    await expect(mode).toHaveAttribute('aria-pressed', 'false')
    await expect(list.locator('.manager-check')).toHaveCount(0)
})

test('the selection moves to a folder, out of folders and into a new folder in one step each', async ({
    page,
}) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Default').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Bass').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Pad').click({ modifiers: ['ControlOrMeta'] })

    const bar = list.locator('.manager-selection-bar')
    await bar.getByRole('button', { name: 'Move to Folder…' }).click()
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitemradio', { name: 'Verse' }).click()
    expect(await tree(page)).toBe('Other [Verse: Lead Fill Default Bass Pad] Drums [Outro:]')
    // Still selecting, so the same entries can move on.
    expect(await checked(list)).toEqual(['Default', 'Bass', 'Pad'])
    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')

    await nameButton(list, 'Default').click()
    await nameButton(list, 'Lead').click()
    await bar.getByRole('button', { name: 'Move to Folder…' }).click()
    await menu.getByRole('menuitemradio', { name: 'No Folder' }).click()
    expect(await tree(page)).toBe('Default Other [Verse: Fill] Lead Bass Drums [Outro:] Pad')
    await undo(page)

    await bar.getByRole('button', { name: 'Move to Folder…' }).click()
    await menu.getByRole('menuitem', { name: 'New Folder…' }).click()
    // The new folder sits where the first entry was and starts its naming.
    await expect(list.locator('.manager-rename')).toBeFocused()
    await page.keyboard.type('Picked')
    await page.keyboard.press('Enter')
    expect(await tree(page)).toBe(
        'Default Other [Verse: Fill] [Picked: Lead Bass Pad] Drums [Outro:]',
    )
    await expect(list.locator('.manager-selection-bar')).toHaveCount(0)
    await undo(page)
    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
})

test('the selection hides, shows, solos and selects its objects', async ({ page }) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Default').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Other').click({ modifiers: ['ControlOrMeta'] })
    const bar = list.locator('.manager-selection-bar')

    await bar.getByRole('button', { name: 'Hide Selected' }).click()
    expect((await state(page)).hidden).toEqual(['Default', 'Other'])
    await bar.getByRole('button', { name: 'Show Selected' }).click()
    expect((await state(page)).hidden).toEqual([])

    await bar.getByRole('button', { name: 'More Actions for Selection' }).click()
    await page.getByRole('menuitem', { name: 'Show Only Selected' }).click()
    expect((await state(page)).hidden).toEqual(['Lead', 'Fill', 'Bass', 'Drums', 'Pad'])
    await bar.getByRole('button', { name: 'More Actions for Selection' }).click()
    await page.getByRole('menuitem', { name: 'Show All Groups' }).click()
    expect((await state(page)).hidden).toEqual([])

    await bar.getByRole('button', { name: 'More Actions for Selection' }).click()
    await page.getByRole('menuitem', { name: 'Select Objects' }).click()
    expect(
        await page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length),
    ).toBe(42)
    // Visibility and object selection are not edits.
    expect(await historyLength(page)).toBe(0)
})

test('deleting the selection confirms, removes all as one step, and stops selecting', async ({
    page,
}) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Other').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Lead').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Drums').click({ modifiers: ['ControlOrMeta'] })
    const bar = list.locator('.manager-selection-bar')

    await bar.getByRole('button', { name: 'Delete Selected…' }).click()
    const dialog = page.locator('dialog')
    await expect(dialog).toContainText('Delete the selected groups (3) and their objects (21)?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
    expect(await checked(list)).toEqual(['Other', 'Lead', 'Drums'])

    await bar.getByRole('button', { name: 'Delete Selected…' }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    expect(await tree(page)).toBe('Default [Verse: Fill] Bass [Outro: Pad]')
    await expect(list.locator('.manager-check')).toHaveCount(0)
    expect(await historyLength(page)).toBe(1)
    await undo(page)
    expect(await tree(page)).toBe('Default Other [Verse: Lead Fill] Bass Drums [Outro: Pad]')
})

test('the keyboard extends, selects all, deletes and stops selecting', async ({ page }) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Other').focus()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    // Passing the folder's row selects nothing more.
    expect(await checked(list)).toEqual(['Other', 'Lead'])
    await expect(nameButton(list, 'Lead')).toBeFocused()
    await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Shift+ArrowUp')
    expect(await checked(list)).toEqual(['Other'])
    // Space toggles the focused name.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')
    expect(await checked(list)).toEqual(['Other', 'Lead'])
    await expect(nameButton(list, 'Lead')).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('ControlOrMeta+a')
    expect(await checked(list)).toHaveLength(7)
    await page.keyboard.press('Delete')
    const dialog = page.locator('dialog')
    await expect(dialog).toContainText('Delete the selected groups (7)')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await nameButton(list, 'Lead').focus()
    await page.keyboard.press('Escape')
    await expect(list.locator('.manager-check')).toHaveCount(0)
    await expect(nameButton(list, 'Lead')).toBeFocused()
    expect(await historyLength(page)).toBe(0)
})

test('closing the delete prompt by a button returns focus to the row', async ({ page }) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await nameButton(list, 'Other').focus()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(nameButton(list, 'Lead')).toBeFocused()
    await page.keyboard.press('Delete')
    const dialog = page.locator('dialog')
    await expect(dialog).toContainText('Delete the selected groups (2)')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(nameButton(list, 'Lead')).toBeFocused()
    expect(await historyLength(page)).toBe(0)
})

test('Escape in the dialog fallback stops selecting and keeps the dialog', async ({ page }) => {
    await seedGroups(page, seed)
    await page.evaluate(() => {
        window.editorTest.settings.groupsPosition = 'disabled'
    })
    await page.keyboard.press('e')
    const dialog = page.locator('dialog')
    await expect(dialog).toBeVisible()
    await nameButton(dialog, 'Bass').click({ modifiers: ['ControlOrMeta'] })
    await expect(dialog.locator('.manager-selection-bar')).toBeVisible()
    await nameButton(dialog, 'Bass').focus()
    await page.keyboard.press('Escape')
    await expect(dialog.locator('.manager-check')).toHaveCount(0)
    await expect(dialog).toBeVisible()
})

test('the target row comes into view when the target changes elsewhere', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 600 })
    await seedGroups(
        page,
        Array.from({ length: 30 }, (_, i): [string] => [`Group ${i + 1}`]),
    )
    const list = panel(page)
    const last = nameButton(list, 'Group 30')
    await expect(last).not.toBeInViewport()
    await page.evaluate(() => {
        const { view, history } = window.editorTest
        view.groupId = [...history.state.value.groups.keys()].at(-1)
    })
    await expect(last).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0)
})

for (const [device, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 1024, height: 768 }],
] as const) {
    test.describe(device, () => {
        test.use({ viewport, isMobile: true, hasTouch: true })

        test('Select enters selecting; taps toggle without changing the target', async ({
            page,
        }) => {
            await seedGroups(page, seed)
            const list = panel(page)
            await nameButton(list, 'Other').tap()
            expect((await state(page)).focus).toBe('Other')

            await list.getByRole('button', { name: 'Select Multiple' }).tap()
            const bar = list.locator('.manager-selection-bar')
            await expect(bar).toBeVisible()
            await expect(bar.getByRole('button', { name: 'Move to Folder…' })).toBeDisabled()
            await nameButton(list, 'Default').tap()
            await row(list, 'Verse').locator('.manager-check').tap()
            expect(await checked(list)).toEqual(['Default', 'Lead', 'Fill'])
            expect((await state(page)).focus).toBe('Other')

            // The bar fits the panel at this size.
            const panelBox = (await list.boundingBox())!
            for (const button of await bar.getByRole('button').all()) {
                const box = (await button.boundingBox())!
                expect(box.x).toBeGreaterThanOrEqual(panelBox.x)
                expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
            }

            await bar.getByRole('button', { name: 'Stop Selecting' }).tap()
            await expect(bar).toHaveCount(0)
            await nameButton(list, 'Default').tap()
            expect((await state(page)).focus).toBe('Default')
        })

        test('a long press offers Select Multiple, and acts on the selection once selecting', async ({
            page,
        }) => {
            await seedGroups(page, seed)
            const list = panel(page)
            const client = await page.context().newCDPSession(page)
            const longPress = async (locator: Locator) => {
                const box = (await locator.boundingBox())!
                const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
                await client.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [point],
                })
                await page.waitForTimeout(700)
                await client.send('Input.dispatchTouchEvent', {
                    type: 'touchEnd',
                    touchPoints: [],
                })
            }
            await longPress(nameButton(list, 'Default'))
            await page.getByRole('menuitem', { name: 'Select Multiple' }).tap()
            expect(await checked(list)).toEqual(['Default'])

            await longPress(nameButton(list, 'Other'))
            const menu = page.getByRole('menu')
            await expect(menu).toHaveAccessibleName('More Actions for Selection')
            // The pressed row joins the selection, and the press did not toggle it back.
            expect(await checked(list)).toEqual(['Default', 'Other'])
            await menu.getByRole('menuitem', { name: 'Hide Selected' }).tap()
            expect((await state(page)).hidden).toEqual(['Default', 'Other'])
        })
    })
}

test('a list without a remembered position opens at the target', async ({ page }) => {
    await seedGroups(
        page,
        Array.from({ length: 40 }, (_, i): [string] => [`Group ${i + 1}`]),
    )
    await page.evaluate(() => {
        const { view, history, settings } = window.editorTest
        settings.groupsPosition = 'disabled'
        view.groupId = [...history.state.value.groups.keys()].at(-2)
    })
    await page.keyboard.press('e')
    const dialog = page.locator('dialog')
    await expect(nameButton(dialog, 'Group 39')).toBeInViewport({ ratio: 1 })
    // Clear of the floating Add.
    const row = (await nameButton(dialog, 'Group 39').boundingBox())!
    const add = (await dialog.locator('.manager-footer').boundingBox())!
    expect(row.y + row.height).toBeLessThanOrEqual(add.y + 1)
})

test('stages select, move into a new folder and delete in one step each', async ({ page }) => {
    await seedGroups(page, seed)
    await page.evaluate(() => {
        const { history, settings } = window.editorTest
        const stages = new Map(history.state.value.stages)
        stages.set(1003 as never, { ...stages.get(1 as never), name: 'Third' } as never)
        history.resetState(
            false,
            { ...window.editorTest.fixtures.notes, isDynamicStages: true, stages },
            0,
            'stages.json',
        )
        settings.showStages = true
    })
    const list = page.locator('#workspace-panel-stages')
    const stageTree = () =>
        page.evaluate(() => {
            const { stages, stageFolders } = window.editorTest.history.state.value
            return [...stages.values()].map(({ name, folderId }) =>
                folderId === undefined ? name : `${stageFolders.get(folderId)?.name}/${name}`,
            )
        })
    await nameButton(list, 'Side stage').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Third').click({ modifiers: ['ControlOrMeta'] })
    const bar = list.locator('.manager-selection-bar')
    await bar.getByRole('button', { name: 'Move to Folder…' }).click()
    await page.getByRole('menuitem', { name: 'New Folder…' }).click()
    await expect(list.locator('.manager-rename')).toBeFocused()
    await page.keyboard.type('Picked')
    await page.keyboard.press('Enter')
    expect(await stageTree()).toEqual(['Center', 'Picked/Side stage', 'Picked/Third'])
    await undo(page)
    await undo(page)
    expect(await stageTree()).toEqual(['Center', 'Side stage', 'Third'])

    await nameButton(list, 'Side stage').click({ modifiers: ['ControlOrMeta'] })
    await nameButton(list, 'Third').click({ modifiers: ['ControlOrMeta'] })
    await bar.getByRole('button', { name: 'Delete Selected…' }).click()
    const dialog = page.locator('dialog')
    await expect(dialog).toContainText('Delete the selected stages (2) and their objects (21)?')
    await dialog.getByRole('button', { name: 'Delete' }).click()
    expect(await stageTree()).toEqual(['Center'])
    await undo(page)
    expect(await stageTree()).toEqual(['Center', 'Side stage', 'Third'])
})

test('the selection bar fits the narrowest dock', async ({ page }) => {
    await seedGroups(page, seed)
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.groupsPosition = 'left'
        settings.leftDockWidth = 220
    })
    const list = panel(page)
    await nameButton(list, 'Default').click({ modifiers: ['ControlOrMeta'] })
    const bar = list.locator('.manager-selection-bar')
    await expect(bar).toBeVisible()
    const panelBox = (await list.boundingBox())!
    expect(panelBox.width).toBeLessThanOrEqual(221)
    for (const button of await bar.getByRole('button').all()) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(panelBox.x)
        expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
    }
})

test("the band's count keeps clear of the pressed Select toggle", async ({ page }) => {
    await seedGroups(page, seed)
    const list = panel(page)
    await list.getByRole('button', { name: 'Hide Bass', exact: true }).click()
    await list.locator('.manager-mode').click()
    await expect(list.locator('.manager-mode')).toHaveAttribute('aria-pressed', 'true')
    const gap = await list.locator('.manager-all').evaluate((row) => {
        const range = document.createRange()
        range.selectNodeContents(row.querySelector('.manager-meta')!)
        const text = range.getBoundingClientRect()
        return row.querySelector('.manager-mode')!.getBoundingClientRect().left - text.right
    })
    expect(gap).toBeGreaterThanOrEqual(4)
})

test('a long band count widens its column and the name gives way', async ({ page }) => {
    await seedGroups(
        page,
        Array.from({ length: 150 }, (_, i): Seed[number] => [`Group ${i + 1}`]),
    )
    await page.evaluate(() => {
        const { settings, view } = window.editorTest
        settings.groupsPosition = 'left'
        settings.leftDockWidth = 220
        view.groupVisibility = new Map(
            Array.from({ length: 27 }, (_, i) => [(1003 + i) as never, 'hidden' as const]),
        )
    })
    const list = panel(page)
    await list.locator('.manager-mode').click()
    await expect(list.locator('.manager-all .manager-meta')).toHaveText('123/150')
    const gaps = await list.locator('.manager-all').evaluate((row) => {
        const range = document.createRange()
        range.selectNodeContents(row.querySelector('.manager-meta')!)
        const text = range.getBoundingClientRect()
        return {
            name: text.left - row.querySelector('.manager-name')!.getBoundingClientRect().right,
            mode: row.querySelector('.manager-mode')!.getBoundingClientRect().left - text.right,
        }
    })
    expect(gaps.name).toBeGreaterThanOrEqual(0)
    expect(gaps.mode).toBeGreaterThanOrEqual(4)
})

// The count gives up its words before the bar gives up its visibility button.
const locales = ['en', 'fr', 'ja', 'ko', 'tr', 'zhs', 'zht']
for (const [device, viewport, mobile, dock, worded] of [
    ['desktop', { width: 1600, height: 1000 }, false, undefined, locales],
    ['336px dock', { width: 1600, height: 1000 }, false, 336, ['en', 'ko', 'tr']],
    ['260px dock', { width: 1600, height: 1000 }, false, 260, ['tr']],
    ['phone', { width: 375, height: 812 }, true, undefined, ['en', 'ko', 'tr']],
] as const) {
    test.describe(`${device} selection bar`, () => {
        test.use({ viewport, isMobile: mobile, hasTouch: mobile })

        for (const locale of locales) {
            test(`${locale} shortens its count before dropping the visibility button`, async ({
                page,
            }) => {
                await seedGroups(page, seed)
                await page.evaluate(
                    ({ locale, dock }) => {
                        const { settings } = window.editorTest
                        settings.locale = locale as never
                        if (dock !== undefined) settings.leftDockWidth = dock
                    },
                    { locale, dock },
                )
                const list = panel(page)
                const bar = list.locator('.manager-selection-bar')
                if (mobile) {
                    await list.locator('.manager-mode').tap()
                    for (const name of ['Default', 'Other', 'Bass']) {
                        await nameButton(list, name).tap()
                    }
                } else {
                    for (const name of ['Default', 'Other', 'Bass']) {
                        await nameButton(list, name).click({ modifiers: ['ControlOrMeta'] })
                    }
                }
                const count = bar.locator('.manager-selection-count')
                await expect(count).toContainText('3')
                await expect
                    .poll(() => count.evaluate((span) => span.scrollWidth <= span.clientWidth))
                    .toBe(true)
                const panelBox = (await list.boundingBox())!
                for (const button of await bar.getByRole('button').all()) {
                    const box = (await button.boundingBox())!
                    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
                }
                // Labels that fit beside the visibility button keep their words; the
                // rest show the number, titled in full, and keep the button.
                const full = (await bar.locator('[role="status"]').textContent())!
                if ((worded as readonly string[]).includes(locale)) {
                    await expect(count).toHaveText(full)
                    await expect(count).not.toHaveAttribute('title')
                } else {
                    await expect(count).toHaveText('3')
                    await expect(count).toHaveAttribute('title', full)
                }
                const visibility = bar.locator('.manager-bulk-visibility')
                if (dock !== 260) {
                    await expect(visibility).toBeVisible()
                    return
                }
                // Too narrow even for the number beside it: the action stays in More.
                await expect(visibility).toHaveCount(0)
                await bar.locator('.manager-bulk-more').click()
                const messages = JSON.parse(
                    readFileSync(
                        new URL(`../../src/i18n/${locale}/index.json`, import.meta.url),
                        'utf8',
                    ),
                ) as { workspace: { manager: { hideSelected: string } } }
                await expect(page.getByRole('menuitem').first()).toContainText(
                    messages.workspace.manager.hideSelected,
                )
            })
        }
    })
}

test('a long list keeps the full selection bar while the count is short', async ({ page }) => {
    await seedGroups(
        page,
        Array.from({ length: 150 }, (_, i): Seed[number] => [`Group ${i + 1}`]),
    )
    const list = panel(page)
    for (const name of ['Group 1', 'Group 2', 'Group 3']) {
        await nameButton(list, name).click({ modifiers: ['ControlOrMeta'] })
    }
    const bar = list.locator('.manager-selection-bar')
    await expect(bar.locator('.manager-selection-done > span').last()).toHaveText('3 Selected')
    await expect(bar.locator('.manager-bulk-visibility')).toBeVisible()
})
