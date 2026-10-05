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

/** Loads the notes fixture with the given group names. */
const seedGroups = (page: Page, names: string[], dynamicStages = true) =>
    page.evaluate(
        ({ names, dynamicStages }) => {
            const { history, view, fixtures } = window.editorTest
            const chart = structuredClone(fixtures.notes)
            chart.isDynamicStages = dynamicStages
            // The fixture notes use groups 1 and 2; other ids stay clear of new ones.
            chart.groups = new Map(
                names.map((name, i) => [(i < 2 ? i + 1 : 1000 + i) as never, { name }]),
            )
            history.resetState(false, chart, 0, 'managers.json')
            view.groupId = undefined
            view.stageId = undefined
            view.groupVisibility = new Map()
            view.stageVisibility = new Map()
        },
        { names, dynamicStages },
    )

const manyGroups = Array.from({ length: 40 }, (_, i) => `Group ${i + 1}`)

const openGroups = async (page: Page) => {
    await page.evaluate(() => {
        window.editorTest.settings.showGroups = true
    })
    const panel = page.locator('#workspace-panel-groups')
    await expect(panel.locator('.manager-entry').first()).toBeVisible()
    return panel
}

const nameButton = (scope: Locator, name: string) =>
    scope.locator('.manager-name').filter({
        has: scope.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

const groupState = (page: Page) =>
    page.evaluate(() => {
        const { view, history } = window.editorTest
        return {
            focus: view.groupId && history.state.value.groups.get(view.groupId)?.name,
            visibility: Object.fromEntries(
                [...view.groupVisibility].map(([id, value]) => [
                    history.state.value.groups.get(id)?.name,
                    value,
                ]),
            ),
            names: [...history.state.value.groups.values()].map(({ name }) => name),
        }
    })

const scrollTops = (page: Page) =>
    page.evaluate(() => ({
        document: document.scrollingElement?.scrollTop ?? 0,
        window: window.scrollY,
        tile: document.querySelector('#workspace-panel-groups')?.scrollTop ?? 0,
        list: document.querySelector('#workspace-panel-groups .manager-entries')?.scrollTop ?? 0,
    }))

const viewports = {
    desktop: { viewport: { width: 1600, height: 1000 } },
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
} as const

for (const [device, options] of Object.entries(viewports)) {
    test.describe(device, () => {
        test.use(options)

        // Phones tap: Playwright clicks send mouse events even with touch enabled.
        const press = (locator: Locator) => (device === 'phone' ? locator.tap() : locator.click())

        test('adding a group scrolls only the list and keeps the authoring target', async ({
            page,
        }) => {
            await seedGroups(page, manyGroups)
            const panel = await openGroups(page)
            await press(nameButton(panel, 'Group 2'))
            expect((await groupState(page)).focus).toBe('Group 2')

            await press(panel.getByRole('button', { name: 'Add Group', exact: true }))

            await expect(panel.locator('.manager-entry')).toHaveCount(41)
            const added = panel.locator('li[data-entry-id]').last()
            await expect(added).toBeInViewport({ ratio: 1 })
            // It clears the Add button floating over the list.
            const addedBox = (await added.boundingBox())!
            const footerBox = (await panel.locator('.manager-footer').boundingBox())!
            expect(addedBox.y + addedBox.height).toBeLessThanOrEqual(footerBox.y + 1)
            const state = await groupState(page)
            expect(state.focus).toBe('Group 2')
            expect(state.names).toHaveLength(41)
            await expect(nameButton(panel, 'Group 2')).toHaveAttribute('aria-current', 'true')
            await expect(panel.locator('[aria-current]')).toHaveCount(1)
            // No properties dialog opens.
            await expect(page.locator('dialog')).toHaveCount(0)

            const tops = await scrollTops(page)
            expect(tops.list).toBeGreaterThan(0)
            expect(tops.tile).toBe(0)
            expect(tops.document).toBe(0)
            expect(tops.window).toBe(0)
        })

        test('names set the authoring target and eyes change visibility only', async ({ page }) => {
            await seedGroups(page, ['Default', 'Other group', 'Third'])
            const panel = await openGroups(page)
            const all = panel.locator('.manager-all .manager-name')
            await expect(all).toHaveAttribute('aria-current', 'true')

            await press(nameButton(panel, 'Other group'))
            expect((await groupState(page)).focus).toBe('Other group')
            await expect(nameButton(panel, 'Other group')).toHaveAttribute('aria-current', 'true')
            await expect(all).not.toHaveAttribute('aria-current', /.*/)
            await expect(panel.locator('[aria-current]')).toHaveCount(1)
            // Pointer clicks leave keyboard shortcuts with the editor.
            expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)

            // Selecting the target again does not toggle back to all groups.
            await press(nameButton(panel, 'Other group'))
            expect((await groupState(page)).focus).toBe('Other group')

            // The eye hides an entry without changing the target.
            await press(panel.getByRole('button', { name: 'Hide Third', exact: true }))
            let state = await groupState(page)
            expect(state.focus).toBe('Other group')
            expect(state.visibility).toEqual({ Third: 'hidden' })
            await expect(
                panel.getByRole('button', { name: 'Show Third', exact: true }),
            ).toBeVisible()
            await expect(nameButton(panel, 'Third').locator('.manager-label')).toHaveClass(
                /text-fg\/80/,
            )
            await expect(panel.locator('.manager-all .manager-meta')).toHaveText('2/3')

            // All eye shows everything while keeping the target.
            await press(panel.getByRole('button', { name: 'Show All Groups', exact: true }))
            state = await groupState(page)
            expect(state.focus).toBe('Other group')
            expect(Object.values(state.visibility)).not.toContain('hidden')
            await expect(panel.locator('.manager-all .manager-meta')).toHaveCount(0)

            // And hides everything while keeping the target.
            await press(panel.getByRole('button', { name: 'Hide All Groups', exact: true }))
            state = await groupState(page)
            expect(state.focus).toBe('Other group')
            expect(state.visibility).toEqual({
                Default: 'hidden',
                'Other group': 'hidden',
                Third: 'hidden',
            })
            await expect(panel.locator('.manager-all .manager-meta')).toHaveText('0/3')

            // Selecting a hidden entry reveals it.
            await press(nameButton(panel, 'Third'))
            state = await groupState(page)
            expect(state.focus).toBe('Third')
            expect(state.visibility.Third).toBeUndefined()

            // All clears the focus and is the only current row.
            await press(all)
            expect((await groupState(page)).focus).toBeUndefined()
            await expect(all).toHaveAttribute('aria-current', 'true')
            await expect(panel.locator('[aria-current]')).toHaveCount(1)
        })

        test('action menu opens, fits the viewport, and closes predictably', async ({ page }) => {
            await seedGroups(page, manyGroups)
            const panel = await openGroups(page)
            const menu = page.getByRole('menu')

            // The last row opens its menu above when there is no room below.
            const list = panel.locator('.manager-entries')
            await list.evaluate((element) => (element.scrollTop = element.scrollHeight))
            const more = panel.getByRole('button', { name: 'More Actions for Group 40' })
            await press(more)
            await expect(menu).toBeVisible()
            await expect(more).toHaveAttribute('aria-expanded', 'true')
            const box = (await menu.boundingBox())!
            const anchor = (await more.boundingBox())!
            const size = page.viewportSize()!
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.y + box.height).toBeLessThanOrEqual(size.height)
            expect(box.x + box.width).toBeLessThanOrEqual(size.width)
            // Opens below when it fits there, otherwise above.
            if (anchor.y + anchor.height + box.height + 12 > size.height)
                expect(box.y + box.height).toBeLessThanOrEqual(anchor.y + 1)
            else expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height - 1)
            await expect(menu.getByRole('menuitem', { name: 'Move Group Down' })).toBeDisabled()
            await expect(menu.getByRole('menuitem', { name: 'Move Group Up' })).toBeEnabled()

            // The anchor toggles the menu closed.
            await press(more)
            await expect(menu).toHaveCount(0)

            // An outside press closes it.
            await press(more)
            await expect(menu).toBeVisible()
            await press(panel.locator('.manager-all .manager-name'))
            await expect(menu).toHaveCount(0)

            // Choosing an item runs it and closes the menu.
            await press(more)
            await press(menu.getByRole('menuitem', { name: 'Move Group Up' }))
            await expect(menu).toHaveCount(0)
            expect((await groupState(page)).names.slice(-2)).toEqual(['Group 40', 'Group 39'])

            // Undoing the add of the anchor's row closes it.
            await press(panel.getByRole('button', { name: 'Add Group', exact: true }))
            await press(panel.locator('li[data-entry-id]').last().locator('.manager-more'))
            await expect(menu).toBeVisible()
            await page.evaluate(() => window.editorTest.history.undoState())
            await expect(menu).toHaveCount(0)

            // Closing the panel closes it.
            await press(more)
            await expect(menu).toBeVisible()
            await page.evaluate(() => {
                window.editorTest.settings.showGroups = false
            })
            await expect(menu).toHaveCount(0)
        })

        test('wide panels offer inline actions; narrow panels use the menu', async ({ page }) => {
            await seedGroups(page, ['Default', 'Other group', 'Third'])
            const panel = await openGroups(page)
            const rowOf = (name: string) =>
                panel.locator('li').filter({
                    has: page.locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
                })
            const inline = (name: string) => rowOf(name).locator('.manager-inline')
            const count = (name: string) => rowOf(name).locator('.manager-meta')
            const menuHasProperties = async (name: string) => {
                await press(panel.getByRole('button', { name: `More Actions for ${name}` }))
                const items = page.getByRole('menuitem', { name: 'Edit Group Properties' })
                const result = (await items.count()) > 0
                await page.keyboard.press('Escape')
                await expect(page.getByRole('menu')).toHaveCount(0)
                return result
            }

            await press(nameButton(panel, 'Third'))
            if (device === 'phone') {
                // Touch has no hover: the target shows the button beside its
                // count, which keeps its column; other rows keep it in their menu.
                await expect(inline('Third')).toBeVisible()
                await expect(count('Third')).toBeVisible()
                const right = async (name: string) => {
                    const box = (await count(name).boundingBox())!
                    return box.x + box.width
                }
                expect(
                    Math.abs((await right('Third')) - (await right('Other group'))),
                ).toBeLessThan(1)
                await expect(inline('Other group')).toBeHidden()
                expect(await menuHasProperties('Other group')).toBe(true)
                expect(await menuHasProperties('Third')).toBe(false)
            } else {
                // With a mouse the button overlays the count of the row in use
                // only, the target included, so its count stays readable.
                await page.mouse.move(1500, 900)
                await expect(inline('Third')).toBeHidden()
                await expect(count('Third')).toBeVisible()
                await expect(inline('Other group')).toBeHidden()
                await expect(count('Other group')).toBeVisible()
                await rowOf('Other group').hover()
                await expect(inline('Other group')).toBeVisible()
                await expect(count('Other group')).toBeHidden()
                // Shown inline, so not repeated in the menu.
                expect(await menuHasProperties('Other group')).toBe(false)
            }
            // Reordering moved to dragging and the menu, keeping rows quiet.
            await expect(
                rowOf('Third').getByRole('button', { name: 'Move Group Up', exact: true }),
            ).toHaveCount(0)

            // Inline properties opens the existing dialog in one press.
            if (device !== 'phone') await rowOf('Third').hover()
            await press(
                rowOf('Third').getByRole('button', { name: 'Edit Group Properties', exact: true }),
            )
            const dialog = page.locator('dialog')
            await expect(dialog).toContainText('Group Properties')
            await page.keyboard.press('Escape')
            await expect(dialog).toHaveCount(0)

            // Narrow panels keep only the menu.
            await page.evaluate(() => {
                const { settings } = window.editorTest
                settings.groupsPosition = 'left'
                settings.leftDockWidth = 240
            })
            await expect(rowOf('Third').locator('.manager-inline')).toBeHidden()
            await press(panel.getByRole('button', { name: 'More Actions for Third' }))
            await expect(
                page.getByRole('menuitem', { name: 'Edit Group Properties' }),
            ).toBeVisible()
            await press(page.getByRole('menuitem', { name: 'Move Group Up' }))
            expect((await groupState(page)).names).toEqual(['Default', 'Third', 'Other group'])
        })

        test('list scroll position survives closing the panel', async ({ page }) => {
            await seedGroups(page, manyGroups)
            const panel = await openGroups(page)
            await panel.locator('.manager-entries').evaluate((element) => {
                element.scrollTop = 300
            })
            await page.evaluate(() => {
                window.editorTest.settings.showGroups = false
            })
            await expect(panel).toHaveCount(0)
            await openGroups(page)
            await expect
                .poll(() => panel.locator('.manager-entries').evaluate((e) => e.scrollTop))
                .toBe(300)
        })

        test('stages panel explains disabled dynamic stages without enabling them', async ({
            page,
        }) => {
            await seedGroups(page, ['Default'], false)
            await page.evaluate(() => {
                window.editorTest.settings.showStages = true
            })
            const panel = page.locator('#workspace-panel-stages')
            await expect(panel.getByText('Dynamic stages are off for this level.')).toBeVisible()
            await expect(panel.locator('.manager-entry')).toHaveCount(0)
            const isDynamic = () =>
                page.evaluate(() => window.editorTest.history.state.value.isDynamicStages)
            expect(await isDynamic()).toBe(false)

            const enable = panel.getByRole('button', { name: 'Enable Dynamic Stages' })
            await press(enable)
            const dialog = page.locator('dialog')
            await expect(dialog).toBeVisible()
            await press(dialog.getByRole('button', { name: 'Cancel' }))
            await expect(dialog).toHaveCount(0)
            expect(await isDynamic()).toBe(false)
            await expect(enable).toBeVisible()

            await press(enable)
            await press(dialog.getByRole('button', { name: 'Confirm' }))
            expect(await isDynamic()).toBe(true)
            await expect(panel.locator('.manager-all .manager-name')).toHaveText('All Stages')
            await expect(panel.locator('.manager-entry')).not.toHaveCount(0)

            await page.evaluate(() => window.editorTest.history.undoState())
            expect(await isDynamic()).toBe(false)
            await expect(enable).toBeVisible()
        })
    })
}

test('action menu supports the keyboard and keeps chart rules', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    const menu = page.getByRole('menu')
    const focused = (locator: Locator) => locator.evaluate((e) => e === document.activeElement)

    const defaultMore = panel.getByRole('button', { name: 'More Actions for Default' })
    await defaultMore.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    const item = (name: string) => menu.getByRole('menuitem', { name })
    await expect(item('Move Group Up')).toBeDisabled()
    await expect(item('Rename')).toBeFocused()

    // Arrow keys skip disabled items and wrap.
    await page.keyboard.press('ArrowDown')
    await expect(item('Show Only This')).toBeFocused()
    // Properties is inline on this wide panel, so the menu leaves it out.
    await expect(item('Edit Group Properties')).toHaveCount(0)
    await page.keyboard.press('End')
    await expect(item('Delete Group')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(item('Rename')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(item('Delete Group')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(item('Rename')).toBeFocused()

    // Editor shortcuts do not fire while the menu has focus.
    await page.keyboard.press('r')
    expect(await page.evaluate(() => window.editorTest.settings.showStages)).toBe(false)

    // Escape closes and returns focus to the menu button.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect(await focused(defaultMore)).toBe(true)

    // Move down by keyboard keeps focus on the moved row's button.
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await expect(item('Move to Folder…')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(item('Move Group Down')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    expect((await groupState(page)).names).toEqual(['Other group', 'Default', 'Third'])
    expect(await focused(defaultMore)).toBe(true)

    // Tab closes the menu.
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(menu).toHaveCount(0)

    // Delete removes the group's notes and recreates nothing while others remain.
    const notesIn = (groupId: number) =>
        page.evaluate(
            (groupId) =>
                [...window.editorTest.store.getAllEntities()].filter(
                    (entity) => entity.type === 'note' && (entity.groupId as number) === groupId,
                ).length,
            groupId,
        )
    expect(await notesIn(2)).toBeGreaterThan(0)
    const otherMore = panel.getByRole('button', { name: 'More Actions for Other group' })
    await otherMore.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    expect((await groupState(page)).names).toEqual(['Default', 'Third'])
    expect(await notesIn(2)).toBe(0)
    // Focus moves to a neighboring row instead of being lost.
    expect(await focused(defaultMore)).toBe(true)

    await page.evaluate(() => window.editorTest.history.undoState())
    expect((await groupState(page)).names).toEqual(['Other group', 'Default', 'Third'])
    expect(await notesIn(2)).toBeGreaterThan(0)

    // Deleting every group keeps a default one.
    for (const name of ['Other group', 'Default', 'Third']) {
        await panel.getByRole('button', { name: `More Actions for ${name}` }).click()
        await item('Delete Group').click()
    }
    expect((await groupState(page)).names).toHaveLength(1)
    await expect(panel.locator('.manager-entry')).toHaveCount(1)

    // Keyboard focus reveals the inline Properties button in tab order; it opens
    // the existing dialog, which keeps focus.
    await panel.locator('.manager-entry .manager-name').first().focus()
    await page.keyboard.press('Tab')
    await expect(panel.locator('.manager-inline-properties').first()).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.locator('dialog')
    await expect(dialog).toContainText('Group Properties')
    await expect(menu).toHaveCount(0)
    await expect.poll(() => dialog.evaluate((e) => e.contains(document.activeElement))).toBe(true)
})

const entryRow = (panel: Locator, name: string) =>
    panel.locator('li').filter({
        has: panel.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

const ownedNotes = (page: Page, groupId: number) =>
    page.evaluate(
        (groupId) =>
            [...window.editorTest.store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && (entity.groupId as number) === groupId,
            ).length,
        groupId,
    )

const canUndo = (page: Page) => page.evaluate(() => window.editorTest.history.canUndo.value)
const hiddenNames = (state: { visibility: Record<string, string> }) =>
    Object.entries(state.visibility)
        .filter(([, value]) => value === 'hidden')
        .map(([name]) => name)
        .sort()

test('names rename inline with double click, F2 and the menu', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    const input = panel.locator('.manager-rename')

    // A double click on another row only chooses it as the target; renaming
    // by double click is for the target, so it never changes the target.
    await nameButton(panel, 'Other group').dblclick()
    await expect(input).toHaveCount(0)
    expect((await groupState(page)).focus).toBe('Other group')

    // Double click edits the target in place, pre-selected; Enter commits one
    // history entry.
    await nameButton(panel, 'Other group').dblclick()
    await expect(input).toBeFocused()
    expect((await groupState(page)).focus).toBe('Other group')
    await expect(input).toHaveValue('Other group')
    expect(
        await input.evaluate(
            (element: HTMLInputElement) =>
                element.selectionStart === 0 && element.selectionEnd === element.value.length,
        ),
    ).toBe(true)
    await page.keyboard.type('  Lead  ')
    await page.keyboard.press('Enter')
    await expect(input).toHaveCount(0)
    expect((await groupState(page)).names).toEqual(['Default', 'Lead', 'Third'])
    await expect(nameButton(panel, 'Lead')).toBeFocused()
    await expect(page.getByText('Renamed Other group group to Lead')).toBeVisible()
    await page.evaluate(() => window.editorTest.history.undoState())
    expect((await groupState(page)).names).toEqual(['Default', 'Other group', 'Third'])

    // Escape cancels; blank names revert.
    await nameButton(panel, 'Third').focus()
    await page.keyboard.press('F2')
    await expect(input).toBeFocused()
    await page.keyboard.type('Nope')
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
    await page.keyboard.press('F2')
    await page.keyboard.type('   ')
    await page.keyboard.press('Enter')
    expect((await groupState(page)).names).toEqual(['Default', 'Other group', 'Third'])

    // The menu offers Rename too, and leaving the field commits.
    await panel.getByRole('button', { name: 'More Actions for Default' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await expect(input).toBeFocused()
    await page.keyboard.type('Base')
    await panel.locator('.manager-band').hover({ position: { x: 4, y: 4 } })
    await page.mouse.down()
    await page.mouse.up()
    expect((await groupState(page)).names).toEqual(['Base', 'Other group', 'Third'])
})

test('alt-clicking an eye shows only that entry and toggles back', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    await nameButton(panel, 'Third').click()

    await panel.getByRole('button', { name: 'Hide Other group', exact: true }).click({
        modifiers: ['Alt'],
    })
    let state = await groupState(page)
    expect(state.focus).toBe('Third')
    expect(hiddenNames(state)).toEqual(['Default', 'Third'])
    await expect(panel.locator('.manager-all .manager-meta')).toHaveText('1/3')

    await panel.getByRole('button', { name: 'Hide Other group', exact: true }).click({
        modifiers: ['Alt'],
    })
    state = await groupState(page)
    expect(Object.values(state.visibility)).not.toContain('hidden')

    // The menu offers the same for touch, and then offers to show everything.
    await panel.getByRole('button', { name: 'More Actions for Default' }).click()
    await page.getByRole('menuitem', { name: 'Show Only This' }).click()
    state = await groupState(page)
    expect(hiddenNames(state)).toEqual(['Other group', 'Third'])
    await panel.getByRole('button', { name: 'More Actions for Default' }).click()
    await page.getByRole('menuitem', { name: 'Show All Groups' }).click()
    expect(Object.values((await groupState(page)).visibility)).not.toContain('hidden')
    expect((await groupState(page)).focus).toBe('Third')
})

test('rows count objects and select or receive them', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    const count = (name: string) => entryRow(panel, name).locator('.manager-meta')
    const defaultNotes = await ownedNotes(page, 1)
    const otherNotes = await ownedNotes(page, 2)
    await expect(count('Default')).toHaveText(`${defaultNotes}`)
    await expect(count('Other group')).toHaveText(`${otherNotes}`)
    await expect(count('Third')).toHaveText('0')
    await expect(count('Default')).toHaveAttribute('title', `${defaultNotes} Objects`)

    // Nothing is selected, so nothing can move here yet; empty entries select nothing.
    await panel.getByRole('button', { name: 'More Actions for Third' }).click()
    await expect(page.getByRole('menuitem', { name: 'Move Selection Here' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Select Objects' })).toBeDisabled()
    await page.keyboard.press('Escape')

    // Selecting is not an edit.
    await panel.getByRole('button', { name: 'More Actions for Other group' }).click()
    await page.getByRole('menuitem', { name: 'Select Objects' }).click()
    expect(
        await page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length),
    ).toBe(otherNotes)
    expect(await canUndo(page)).toBe(false)

    // Moving the selection is one undoable edit, and counts follow it.
    await panel.getByRole('button', { name: 'More Actions for Third' }).click()
    await page.getByRole('menuitem', { name: 'Move Selection Here' }).click()
    await expect(count('Third')).toHaveText(`${otherNotes}`)
    await expect(count('Other group')).toHaveText('0')
    expect(await ownedNotes(page, 2)).toBe(0)
    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(count('Other group')).toHaveText(`${otherNotes}`)
    expect(await canUndo(page)).toBe(false)
})

test('stage rows count notes and stage events', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show, settings } = window.editorTest
        show(fixtures.events)
        settings.showStages = true
    })
    const panel = page.locator('#workspace-panel-stages')
    const expected = await page.evaluate(
        () =>
            [...window.editorTest.store.getAllEntities()].filter(
                (entity) =>
                    (entity.type === 'note' ||
                        entity.type === 'stageMaskEventJoint' ||
                        entity.type === 'stagePivotEventJoint' ||
                        entity.type === 'stageStyleEventJoint' ||
                        entity.type === 'stageTransformEventJoint') &&
                    (entity.stageId as number) === 1,
            ).length,
    )
    expect(expected).toBeGreaterThan(2)
    await expect(entryRow(panel, 'Center').locator('.manager-meta')).toHaveText(`${expected}`)
})

test('rows reorder by dragging and by Alt+Arrow keys', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    const center = async (name: string) => {
        const box = (await nameButton(panel, name).boundingBox())!
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }

    // Dragging a name moves the row as one history entry, without selecting it.
    const from = await center('Third')
    const to = await center('Default')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++)
        await page.mouse.move(from.x, from.y + ((to.y - 12 - from.y) * step) / 8)
    const dragged = entryRow(panel, 'Third').locator('.manager-row')
    await expect(dragged).toHaveClass(/manager-row-dragging/)
    // The lifted row stays opaque under the pointer, hiding the row beneath.
    await expect
        .poll(() => dragged.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe('rgb(255, 255, 255)')
    await page.mouse.up()
    expect((await groupState(page)).names).toEqual(['Third', 'Default', 'Other group'])
    expect((await groupState(page)).focus).toBeUndefined()
    await page.evaluate(() => window.editorTest.history.undoState())
    expect((await groupState(page)).names).toEqual(['Default', 'Other group', 'Third'])

    // Escape cancels a drag.
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, to.y - 12, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect((await groupState(page)).names).toEqual(['Default', 'Other group', 'Third'])

    // Keyboard users reorder the focused row with Alt+Arrow keys.
    await nameButton(panel, 'Default').focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect((await groupState(page)).names).toEqual(['Other group', 'Default', 'Third'])
    await expect(nameButton(panel, 'Default')).toBeFocused()

    // A mouse drags by the name; touch screens get a visible handle instead.
    await expect(panel.locator('.manager-grip').first()).toBeHidden()
})

test('manager dialog fallback hosts the same list and menus', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    await page.evaluate(() => {
        window.editorTest.settings.groupsPosition = 'disabled'
    })
    await page.keyboard.press('e')
    const dialog = page.locator('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.manager-entry')).toHaveCount(3)

    const more = dialog.getByRole('button', { name: 'More Actions for Other group' })
    await more.click()
    const menu = dialog.getByRole('menu')
    await expect(menu).toBeVisible()
    // The menu renders in the dialog's top layer and receives pointer input.
    const item = menu.getByRole('menuitem', { name: 'Move Group Down' })
    const box = (await item.boundingBox())!
    expect(
        await page.evaluate(
            ({ x, y }) =>
                document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent,
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        ),
    ).toContain('Move Group Down')

    // Escape closes only the menu.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(dialog).toBeVisible()
    expect(await more.evaluate((e) => e === document.activeElement)).toBe(true)

    await more.click()
    await item.click()
    await expect(menu).toHaveCount(0)
    await expect(dialog).toBeVisible()
    expect((await groupState(page)).names).toEqual(['Default', 'Third', 'Other group'])

    await dialog.getByRole('button', { name: 'More Actions for Third' }).click()
    await menu.getByRole('menuitem', { name: 'Delete Group' }).click()
    await expect(dialog.locator('.manager-entry')).toHaveCount(2)
    await expect(dialog).toBeVisible()

    // Renaming works in the dialog too (a first click chooses the target);
    // Escape cancels only the field.
    await nameButton(dialog, 'Default').click()
    await nameButton(dialog, 'Default').dblclick()
    await expect(dialog.locator('.manager-rename')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog.locator('.manager-rename')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await nameButton(dialog, 'Default').dblclick()
    await page.keyboard.type('Renamed')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    expect((await groupState(page)).names).toEqual(['Renamed', 'Other group'])

    // Adding scrolls nothing outside the dialog and keeps it open.
    await dialog.getByRole('button', { name: 'Add Group', exact: true }).click()
    await expect(dialog.locator('.manager-entry')).toHaveCount(3)
    // The first click chose the target; adding keeps it and starts naming the
    // new row, which Escape leaves with its generated name.
    expect((await groupState(page)).focus).toBe('Renamed')
    await expect(dialog.locator('.manager-rename')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect((await groupState(page)).names).toEqual(['Renamed', 'Other group', '#1'])
})

test('stages dialog fallback shows the disabled state', async ({ page }) => {
    await seedGroups(page, ['Default'], false)
    await page.evaluate(() => {
        window.editorTest.settings.stagesPosition = 'disabled'
    })
    await page.keyboard.press('r')
    const dialog = page.locator('dialog')
    await expect(dialog.getByText('Dynamic stages are off for this level.')).toBeVisible()
    expect(await page.evaluate(() => window.editorTest.history.state.value.isDynamicStages)).toBe(
        false,
    )

    // Enabling stacks the confirmation over the manager, which then lists stages.
    await dialog.getByRole('button', { name: 'Enable Dynamic Stages' }).click()
    await expect(dialog).toHaveCount(2)
    await dialog.last().getByRole('button', { name: 'Confirm' }).click()
    await expect(dialog).toHaveCount(1)
    expect(await page.evaluate(() => window.editorTest.history.state.value.isDynamicStages)).toBe(
        true,
    )
    await expect(dialog.locator('.manager-all .manager-name')).toHaveText('All Stages')
    await expect(dialog.locator('.manager-entry')).not.toHaveCount(0)
})

test('deleting the authoring target leaves no dangling target', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group', 'Third'])
    const panel = await openGroups(page)
    await nameButton(panel, 'Other group').click()
    expect((await groupState(page)).focus).toBe('Other group')

    await panel.getByRole('button', { name: 'More Actions for Other group' }).click()
    await page.getByRole('menuitem', { name: 'Delete Group' }).click()
    const state = await page.evaluate(() => ({
        groupId: window.editorTest.view.groupId,
        names: [...window.editorTest.history.state.value.groups.values()].map(({ name }) => name),
    }))
    expect(state).toEqual({ groupId: undefined, names: ['Default', 'Third'] })
    await expect(panel.locator('.manager-all .manager-name')).toHaveAttribute(
        'aria-current',
        'true',
    )
    await expect(panel.locator('[aria-current]')).toHaveCount(1)

    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(panel.locator('.manager-entry')).toHaveCount(3)
})

for (const [device, options] of Object.entries(viewports)) {
    test(`${device} bands, rows and columns follow the shared metrics`, async ({ browser }) => {
        const context = await browser.newContext(options)
        const page = await context.newPage()
        await page.addInitScript(installCanvasCounters)
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await seedGroups(page, ['Default', 'Other group', 'Third'])
        const panel = await openGroups(page)
        const coarse = device === 'phone'

        const band = (await panel.locator('.manager-band').boundingBox())!
        expect(band.height).toBe(coarse ? 52 : 48)
        expect(
            await panel
                .locator('.manager-all .manager-label')
                .evaluate((e) => [getComputedStyle(e).fontWeight, getComputedStyle(e).fontSize]),
        ).toEqual(['700', '16px'])
        const rows = await panel
            .locator('.manager-entry')
            .evaluateAll((elements) =>
                elements.map((element) => element.getBoundingClientRect().top),
            )
        expect(rows[1]! - rows[0]!).toBe(coarse ? 52 : 44)

        // The All count shares the entries' trailing column.
        await panel.getByRole('button', { name: 'Hide Third', exact: true }).click()
        const allMeta = (await panel.locator('.manager-all .manager-meta').boundingBox())!
        const entryMeta = (await panel
            .locator('.manager-entry .manager-meta')
            .first()
            .boundingBox())!
        expect(Math.abs(allMeta.x + allMeta.width - (entryMeta.x + entryMeta.width))).toBeLessThan(
            1,
        )
        // Partly visible collections get their own eye glyph (with a minus
        // badge) beside the count, and the eye shows everything.
        const allEye = panel.locator('.manager-all .manager-eye')
        await expect(allEye).toHaveAttribute('aria-label', 'Show All Groups')
        await expect(allEye.locator('mask')).toHaveCount(1)
        await allEye.click()
        await expect(allEye.locator('mask')).toHaveCount(0)

        // The eye column lines up across the band, the rows (touch handles sit
        // at the trailing edge) and the Add item's plus.
        const centerX = async (locator: Locator) => {
            const box = (await locator.boundingBox())!
            return box.x + box.width / 2
        }
        const eye = await centerX(allEye)
        expect(
            Math.abs((await centerX(panel.locator('.manager-entry .manager-eye').first())) - eye),
        ).toBeLessThan(1)
        expect(Math.abs((await centerX(panel.locator('.manager-add svg'))) - eye)).toBeLessThan(1)
        // And its label starts on the name column.
        const addLabel = (await panel.locator('.manager-add > span').last().boundingBox())!
        const nameText = await panel
            .locator('.manager-entry .manager-label')
            .first()
            .evaluate((element) => {
                const range = document.createRange()
                range.selectNodeContents(element)
                return range.getBoundingClientRect().x
            })
        const addText = await panel
            .locator('.manager-add > span')
            .last()
            .evaluate((element) => {
                const range = document.createRange()
                range.selectNodeContents(element)
                return range.getBoundingClientRect().x
            })
        expect(addLabel.width).toBeGreaterThan(0)
        expect(Math.abs(addText - nameText)).toBeLessThan(1)
        if (coarse)
            await expect(panel.locator('.manager-entry .manager-grip').first()).toBeVisible()

        // Without a count, the band gives its whole width to the title.
        await expect(panel.locator('.manager-all .manager-slot')).toHaveCount(0)
        await expect(panel.locator('.manager-all .manager-icon-spacer')).toHaveCount(0)
        await context.close()
    })
}

test('adding an entry starts naming it without changing the target', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group'])
    const panel = await openGroups(page)
    await nameButton(panel, 'Default').click()
    const input = panel.locator('.manager-rename')
    const add = panel.getByRole('button', { name: 'Add Group', exact: true })

    // Enter keeps the typed name.
    await add.click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('#1')
    expect(
        await input.evaluate(
            (element: HTMLInputElement) =>
                element.selectionStart === 0 && element.selectionEnd === element.value.length,
        ),
    ).toBe(true)
    await page.keyboard.type('Lead')
    await page.keyboard.press('Enter')
    let state = await groupState(page)
    expect(state.names).toEqual(['Default', 'Other group', 'Lead'])
    expect(state.focus).toBe('Default')
    await expect(page.locator('dialog')).toHaveCount(0)

    // Escape keeps the generated name.
    await add.click()
    await expect(input).toHaveValue('#1')
    await page.keyboard.type('Nope')
    await page.keyboard.press('Escape')
    expect((await groupState(page)).names).toEqual(['Default', 'Other group', 'Lead', '#1'])

    // Leaving the field keeps the typed name.
    await add.click()
    await page.keyboard.type('Bass')
    await panel.locator('.manager-band').hover({ position: { x: 4, y: 4 } })
    await page.mouse.down()
    await page.mouse.up()
    state = await groupState(page)
    expect(state.names).toEqual(['Default', 'Other group', 'Lead', '#1', 'Bass'])
    expect(state.focus).toBe('Default')
})

test('rows scrolled under the band get a separator and a fade', async ({ page }) => {
    await seedGroups(page, manyGroups)
    const panel = await openGroups(page)
    const band = panel.locator('.manager-band')
    const list = panel.locator('.manager-entries')
    await expect(band).not.toHaveClass(/manager-band-raised/)
    await list.evaluate((element) => {
        element.scrollTop = 80
    })
    await expect(band).toHaveClass(/manager-band-raised/)
    await expect(list).toHaveClass(/manager-entries-scrolled/)
    expect(await list.evaluate((element) => getComputedStyle(element).maskImage)).toContain(
        'gradient',
    )
    await list.evaluate((element) => {
        element.scrollTop = 0
    })
    await expect(band).not.toHaveClass(/manager-band-raised/)
})

test('long band titles fit narrow docks', async ({ page }) => {
    await seedGroups(page, ['Default'])
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.locale = 'fr'
        settings.groupsPosition = 'left'
        settings.leftDockWidth = 260
    })
    const panel = await openGroups(page)
    const label = panel.locator('.manager-all .manager-label')
    await expect(label).toHaveText('Tous les groupes')
    expect(await label.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
})

test('the Add item stops floating over very short lists', async ({ page }) => {
    await seedGroups(page, manyGroups)
    const panel = await openGroups(page)
    await expect(panel.locator('.manager-footer-floating')).toHaveCount(1)
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.groupsPosition = 'top'
        settings.topDockHeight = 140
    })
    await expect(panel.locator('.manager-footer')).toBeVisible()
    await expect(panel.locator('.manager-footer-floating')).toHaveCount(0)
    // The first row stays uncovered.
    const row = (await panel.locator('.manager-entry').first().boundingBox())!
    const list = (await panel.locator('.manager-entries').boundingBox())!
    expect(row.y + row.height).toBeLessThanOrEqual(list.y + list.height)
})

test('the floating Add fades rows only while more lie below, and the last row clears it', async ({
    page,
}) => {
    await seedGroups(page, manyGroups)
    const panel = await openGroups(page)
    const list = panel.locator('.manager-entries')
    const add = panel.locator('.manager-add')
    // Only the button is drawn: the floating footer itself paints nothing.
    expect(
        await panel
            .locator('.manager-footer-floating')
            .evaluate((element) => getComputedStyle(element).backgroundImage),
    ).toBe('none')
    await expect(list).toHaveClass(/manager-entries-more/)

    await list.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(list).not.toHaveClass(/manager-entries-more/)
    const last = (await panel.locator('.manager-entry').last().boundingBox())!
    const button = (await add.boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual(button.y - 4)

    // A list that fits shows no fade at all.
    await seedGroups(page, ['Default', 'Other'])
    await expect(list).not.toHaveClass(/manager-entries-more/)
    expect(await list.evaluate((element) => getComputedStyle(element).maskImage)).toBe('none')
})

test('the disabled stages band keeps the heading row layout', async ({ page }) => {
    await seedGroups(page, ['Default'], false)
    await page.evaluate(() => {
        window.editorTest.settings.showStages = true
    })
    const panel = page.locator('#workspace-panel-stages')
    const label = panel.locator('.manager-all .manager-label')
    const eye = panel.locator('.manager-all .manager-eye')
    await expect(eye).toBeDisabled()
    expect(Number(await eye.evaluate((e) => getComputedStyle(e).opacity))).toBeLessThanOrEqual(0.4)
    const before = (await label.boundingBox())!

    await panel.getByRole('button', { name: 'Enable Dynamic Stages' }).click()
    await page.locator('dialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(panel.locator('.manager-entry')).not.toHaveCount(0)
    const after = (await label.boundingBox())!
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
})

test('deleting an entry keeps the rest of the selection', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group'])
    const panel = await openGroups(page)
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
        })
    })
    const defaultNotes = await ownedNotes(page, 1)
    await panel.getByRole('button', { name: 'More Actions for Other group' }).click()
    await page.getByRole('menuitem', { name: 'Delete Group' }).click()
    const selection = await page.evaluate(() => {
        const { history, store } = window.editorTest
        const all = store.getAllEntities()
        const selected = history.state.value.selectedEntities
        return {
            count: selected.length,
            groups: [...new Set(selected.map((entity) => (entity as { groupId: number }).groupId))],
            current: selected.every((entity) => all.has(entity)),
        }
    })
    expect(selection).toEqual({ count: defaultNotes, groups: [1], current: true })
})

test('keyboard focus in the action menu shows a ring', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group'])
    const panel = await openGroups(page)
    await panel.getByRole('button', { name: 'More Actions for Other group' }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    const focused = page.locator('[role="menuitem"]:focus')
    await expect(focused).toHaveCount(1)
    expect(await focused.evaluate((e) => getComputedStyle(e).boxShadow)).toMatch(/inset/)
})

test('stages disabled state keeps its band and fits narrow tiles', async ({ page }) => {
    await seedGroups(page, ['Default'], false)
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.stagesPosition = 'left'
        settings.showStages = true
        settings.leftDockWidth = 200
    })
    const panel = page.locator('#workspace-panel-stages')
    await expect(panel.locator('.manager-band')).toHaveText('All Stages')
    const enable = panel.locator('.manager-enable')
    const box = (await enable.boundingBox())!
    const tile = (await panel.boundingBox())!
    // A long label wraps inside the pill rather than truncating.
    expect(box.height).toBeGreaterThanOrEqual(36)
    expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width)
    expect(await enable.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
    )
    await page.evaluate(() => {
        window.editorTest.settings.leftDockWidth = 360
    })
    await expect.poll(async () => (await enable.boundingBox())?.height).toBe(36)
})

test('Escape in a menu leaves the elevation editor open', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group'])
    const panel = await openGroups(page)
    const elevation = (action: 'open' | 'isOpen') =>
        page.evaluate(async (action) => {
            const url =
                performance
                    .getEntriesByType('resource')
                    .map((entry) => new URL(entry.name))
                    .find((entry) => entry.pathname === '/src/editor/elevation/state.ts')?.href ??
                '/src/editor/elevation/state.ts'
            const state = (await import(url)) as typeof import('../../src/editor/elevation/state')
            if (action === 'open') state.openElevationEditor(3)
            return state.isElevationEditorOpen.value
        }, action)
    expect(await elevation('open')).toBe(true)
    await panel.getByRole('button', { name: 'More Actions for Default' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await elevation('isOpen')).toBe(true)
})

test.describe('touch reordering', () => {
    test.use(viewports.phone)

    test('rows drag by their handle on touch screens', async ({ page }) => {
        await seedGroups(page, ['Default', 'Other group', 'Third'])
        const panel = await openGroups(page)
        const grip = entryRow(panel, 'Third').locator('.manager-grip')
        await expect(grip).toBeVisible()
        const from = (await grip.boundingBox())!
        const to = (await entryRow(panel, 'Default').boundingBox())!
        const x = from.x + from.width / 2
        const y = from.y + from.height / 2

        const client = await page.context().newCDPSession(page)
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchY?: number) =>
            client.send('Input.dispatchTouchEvent', {
                type,
                touchPoints: touchY === undefined ? [] : [{ x, y: touchY }],
            })
        await touch('touchStart', y)
        for (let step = 1; step <= 8; step++)
            await touch('touchMove', y + ((to.y + 4 - y) * step) / 8)
        await touch('touchEnd')

        expect((await groupState(page)).names).toEqual(['Third', 'Default', 'Other group'])
        expect((await groupState(page)).focus).toBeUndefined()
    })
})

test('menus scroll internally on short screens', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 150 })
    await seedGroups(page, ['Default', 'Other group'])
    await page.evaluate(() => {
        window.editorTest.settings.groupsPosition = 'disabled'
    })
    await page.keyboard.press('e')
    const dialog = page.locator('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'More Actions for Default' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const metrics = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
            top: rect.top,
            bottom: rect.bottom,
            // Items scroll inside the menu, which keeps its chrome fixed.
            scrolls: ((items) => !!items && items.scrollHeight > items.clientHeight)(
                element.querySelector('.scroll-edges'),
            ),
        }
    })
    expect(metrics.top).toBeGreaterThanOrEqual(0)
    expect(metrics.bottom).toBeLessThanOrEqual(150)
    expect(metrics.scrolls).toBe(true)
})

test('the properties dialog keeps a name rather than storing a blank one', async ({ page }) => {
    await seedGroups(page, ['Default', 'Other group'])
    const panel = await openGroups(page)
    await entryRow(panel, 'Other group').locator('.manager-name').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    const name = page.locator('dialog').getByRole('textbox')
    await name.fill('   ')
    await name.press('Enter')
    expect((await groupState(page)).names).toEqual(['Default', 'Other group'])
    // The field shows the name it kept, not the refused entry.
    await expect(name).toHaveValue('Other group')
    expect(await canUndo(page)).toBe(false)
    await name.fill('  Renamed  ')
    await name.press('Enter')
    expect((await groupState(page)).names).toEqual(['Default', 'Renamed'])
})
