import { expect, test, type Locator, type Page } from '@playwright/test'
import type { StageId } from '../../src/chart/stages'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Selection temporarily isolates one entry; All restores its saved visibility choices.

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { history, view, fixtures, settings } = window.editorTest
        const chart = structuredClone(fixtures.notes)
        chart.isDynamicStages = true
        chart.groups = new Map([
            [1 as never, { name: 'Default' }],
            [2 as never, { name: 'Other group' }],
            [3 as never, { name: 'Third' }],
        ])
        const [stage] = [...chart.stages.values()]
        chart.stages = new Map(
            ['Center', 'Side stage', 'Back'].map((name, i) => [
                (i + 1) as StageId,
                { ...stage!, name },
            ]),
        )
        history.resetState(false, chart, 0, 'commands.json')
        view.groupId = undefined
        view.stageId = undefined
        settings.showOtherGroups = false
        settings.showOtherStages = false
        settings.keyboardShortcuts = {
            groupPrev: '1',
            groupNext: '2',
            groupAll: '3',
            stagePrev: '4',
            stageNext: '5',
            stageAll: '6',
        }
    })
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const openManager = async (page: Page, kind: 'groups' | 'stages') => {
    await page.evaluate((kind) => {
        const { settings } = window.editorTest
        if (kind === 'groups') settings.showGroups = true
        else settings.showStages = true
    }, kind)
    const panel = page.locator(`#workspace-panel-${kind}`)
    await expect(panel.locator('.manager-entry').first()).toBeVisible()
    return panel
}

const nameButton = (panel: Locator, name: string) =>
    panel.locator('.manager-name').filter({
        has: panel.page().locator('.manager-label', { hasText: new RegExp(`^${name}$`) }),
    })

/** Each entry's effective visibility, by name, and the focused name. */
const scope = (page: Page, kind: 'groups' | 'stages') =>
    page.evaluate(async (kind) => {
        const { history, view } = window.editorTest
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { groupScope, stageScope } = (await import(
            urls.get('/src/editor/scope.ts') ?? '/src/editor/scope.ts'
        )) as typeof import('../../src/editor/scope')
        const entries = kind === 'groups' ? history.state.value.groups : history.state.value.stages
        const scope = (kind === 'groups' ? groupScope : stageScope) as typeof groupScope
        const focus = kind === 'groups' ? view.groupId : view.stageId
        return {
            focus: focus === undefined ? undefined : entries.get(focus as never)?.name,
            visibility: Object.fromEntries(
                [...entries].map(([id, { name }]) => [name, scope.visibility(id as never)]),
            ),
        }
    }, kind)

/** Runs a shortcut with the editor focused, as after a pointer click in a manager. */
const press = async (page: Page, key: string) => {
    await expect
        .poll(() =>
            page.evaluate(() => !document.activeElement?.closest('[id^="workspace-panel-"]')),
        )
        .toBe(true)
    await page.keyboard.press(key)
}

test('All Groups preserves groups hidden in the manager even when already All', async ({
    page,
}) => {
    const panel = await openManager(page, 'groups')
    await panel.getByRole('button', { name: 'Hide Third', exact: true }).click()
    expect((await scope(page, 'groups')).visibility.Third).toBe('hidden')

    await press(page, '3')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'full', 'Other group': 'full', Third: 'hidden' },
    })
    await expect(panel.getByRole('button', { name: 'Show Third', exact: true })).toBeEnabled()
    await expect(page.locator('.status-chip').filter({ hasText: 'Groups' })).toContainText('2/3')
})

test('All Groups restores a solo mask after selecting a hidden group', async ({ page }) => {
    const panel = await openManager(page, 'groups')
    await panel
        .getByRole('button', { name: 'Hide Default', exact: true })
        .click({ modifiers: ['Alt'] })
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'full',
        'Other group': 'hidden',
        Third: 'hidden',
    })
    await nameButton(panel, 'Other group').click()
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'hidden',
        'Other group': 'full',
        Third: 'hidden',
    })
    await expect(
        panel.getByRole('button', { name: 'Hide Other group', exact: true }),
    ).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Show Default', exact: true })).toBeDisabled()

    await press(page, '3')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'full', 'Other group': 'hidden', Third: 'hidden' },
    })
})

test('Next and Previous Group isolate their target and restore an all-hidden mask at All', async ({
    page,
}) => {
    const panel = await openManager(page, 'groups')
    await panel.getByRole('button', { name: 'Hide All Groups', exact: true }).click()

    await press(page, '2')
    expect(await scope(page, 'groups')).toEqual({
        focus: 'Default',
        visibility: { Default: 'full', 'Other group': 'hidden', Third: 'hidden' },
    })
    await press(page, '2')
    expect(await scope(page, 'groups')).toEqual({
        focus: 'Other group',
        visibility: { Default: 'hidden', 'Other group': 'full', Third: 'hidden' },
    })

    // Stepping past the ends reaches all groups, like All Groups.
    await press(page, '1')
    await press(page, '1')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'hidden', 'Other group': 'hidden', Third: 'hidden' },
    })
    await expect(panel.getByRole('button', { name: 'Show All Groups', exact: true })).toBeEnabled()
})

for (const [device, options] of Object.entries({
    desktop: {},
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
})) {
    test.describe(device, () => {
        test.use(options)

        test('the toolbar All Groups restores a group hidden in the manager', async ({ page }) => {
            const press = (locator: Locator) =>
                device === 'phone' ? locator.tap() : locator.click()
            const panel = await openManager(page, 'groups')
            await press(panel.getByRole('button', { name: 'Hide Third', exact: true }))
            await press(nameButton(panel, 'Third'))
            const chip = page.locator('.status-chip').filter({ hasText: 'Groups' })
            await expect(
                panel.getByRole('button', { name: 'Hide Third', exact: true }),
            ).toBeDisabled()

            const toolbar = page.locator('[data-editor-toolbar]').first()
            const tool = toolbar.locator('button[title="Manage Groups"]').first()
            if (device === 'phone') await tool.tap()
            else await tool.hover()
            await press(toolbar.locator('.overflow-y-auto button[title="All Groups"]'))

            expect((await scope(page, 'groups')).visibility).toEqual({
                Default: 'full',
                'Other group': 'full',
                Third: 'hidden',
            })
            await expect(chip).toContainText('2/3')
            await expect(
                panel.getByRole('button', { name: 'Show Third', exact: true }),
            ).toBeEnabled()
            // For review screenshots, e.g. SCOPE_SHOTS=/tmp/shots.
            const shots = process.env.SCOPE_SHOTS
            if (shots) await page.screenshot({ path: `${shots}/scope-all-${device}.png` })
        })
    })
}

test('stage commands behave the same after manager changes', async ({ page }) => {
    const panel = await openManager(page, 'stages')
    await panel.getByRole('button', { name: 'Hide Back', exact: true }).click()
    await press(page, '6')
    expect(await scope(page, 'stages')).toEqual({
        focus: undefined,
        visibility: { Center: 'full', 'Side stage': 'full', Back: 'hidden' },
    })

    await panel.getByRole('button', { name: 'Show All Stages', exact: true }).click()
    await panel.getByRole('button', { name: 'Hide All Stages', exact: true }).click()
    await press(page, '4')
    expect(await scope(page, 'stages')).toEqual({
        focus: 'Back',
        visibility: { Center: 'hidden', 'Side stage': 'hidden', Back: 'full' },
    })
    await press(page, '5')
    expect(await scope(page, 'stages')).toEqual({
        focus: undefined,
        visibility: { Center: 'hidden', 'Side stage': 'hidden', Back: 'hidden' },
    })
})

test('the status bar lists the group before the stage', async ({ page }) => {
    await expect(page.locator('.status-chip')).toHaveText([/^All Groups/, /^All Stages/])
})

for (const kind of ['groups', 'stages'] as const) {
    test(`${kind} with Show Other enabled forces focus visible while preserving individual hides and accepting bulk masks`, async ({
        page,
    }) => {
        const panel = await openManager(page, kind)
        const result = await page.evaluate(async (kind) => {
            const { appImport, settings, view } = window.editorTest
            const { groupScope, stageScope } =
                await appImport<typeof import('../../src/editor/scope')>('/src/editor/scope.ts')
            if (kind === 'groups') settings.showOtherGroups = true
            else settings.showOtherStages = true
            const scope = (kind === 'groups' ? groupScope : stageScope) as typeof groupScope
            scope.setShown(2 as never, false)
            scope.focus(2 as never)
            const original = kind === 'groups' ? view.groupVisibility : view.stageVisibility
            const selected = scope.visibility(2 as never)
            scope.setShown(2 as never, true)
            scope.setShown(2 as never, false)
            scope.reveal(2 as never)
            const guarded =
                original === (kind === 'groups' ? view.groupVisibility : view.stageVisibility)
            scope.setShown(1 as never, false)
            scope.setShown(1 as never, true)
            const otherShown = scope.visibility(1 as never)
            scope.showOnly([3 as never])
            const solo = [1, 2, 3].map((id) => scope.visibility(id as never))
            scope.focus(1 as never)
            const switched = [1, 2, 3].map((id) => scope.visibility(id as never))
            scope.focus(2 as never)
            scope.focusAll()
            const restored = [1, 2, 3].map((id) => scope.visibility(id as never))
            scope.focus(2 as never)
            scope.setSomeShown([2 as never], true)
            const bulkShown = scope.isShownInAll(2 as never)
            scope.setAllShown(false)
            return {
                selected,
                guarded,
                otherShown,
                solo,
                switched,
                restored,
                bulkShown,
                hiddenMask: [1, 2, 3].map((id) => scope.isShownInAll(id as never)),
                effective: [1, 2, 3].map((id) => scope.visibility(id as never)),
                editable: scope.canSetVisibility.value,
            }
        }, kind)
        expect(result).toEqual({
            selected: 'full',
            guarded: true,
            otherShown: 'dimmed',
            solo: ['hidden', 'full', 'dimmed'],
            switched: ['full', 'hidden', 'dimmed'],
            restored: ['hidden', 'hidden', 'full'],
            bulkShown: true,
            hiddenMask: [false, false, false],
            effective: ['hidden', 'full', 'hidden'],
            editable: true,
        })
        await expect(
            panel.getByRole('button', {
                name: `Hide ${kind === 'groups' ? 'Other group' : 'Side stage'}`,
                exact: true,
            }),
        ).toBeDisabled()
        await expect(
            panel.getByRole('button', {
                name: `Show ${kind === 'groups' ? 'Third' : 'Back'}`,
                exact: true,
            }),
        ).toBeEnabled()
        await expect(panel.locator('.manager-all .manager-eye')).toBeEnabled()
        expect((await scope(page, kind)).focus).toBe(
            kind === 'groups' ? 'Other group' : 'Side stage',
        )
    })

    test(`${kind} isolation disables eyes, folder and bulk visibility and solo actions`, async ({
        page,
    }) => {
        await page.evaluate((kind) => {
            const { history } = window.editorTest
            const current = history.state.value
            const key = kind === 'groups' ? 'groups' : 'stages'
            const folderKey = kind === 'groups' ? 'groupFolders' : 'stageFolders'
            const entries = new Map(
                [...current[key]].map(([id, entry]) => [id, { ...entry, folderId: 9000 as never }]),
            )
            history.replaceState({
                ...current,
                [key]: entries,
                [folderKey]: new Map([[9000 as never, { name: 'Collection', index: 0 }]]),
            })
        }, kind)
        const panel = await openManager(page, kind)
        const chosen = kind === 'groups' ? 'Other group' : 'Side stage'
        const other = kind === 'groups' ? 'Third' : 'Back'
        await nameButton(panel, chosen).click()
        for (const eye of await panel.locator('.manager-eye').all())
            await expect(eye).toBeDisabled()
        await panel.getByRole('button', { name: `More Actions for ${other}`, exact: true }).click()
        await expect(
            page.getByRole('menuitem', { name: 'Show Only This', exact: true }),
        ).toBeDisabled()
        await page.keyboard.press('Escape')
        await nameButton(panel, other).click({ modifiers: ['Control'] })
        await expect(panel.locator('.manager-bulk-visibility')).toBeDisabled()
        await panel.locator('.manager-bulk-more').click()
        await expect(
            page.getByRole('menuitem', { name: 'Hide Selected', exact: true }),
        ).toBeDisabled()
        await expect(
            page.getByRole('menuitem', { name: 'Show Only Selected', exact: true }),
        ).toBeDisabled()
        await page.keyboard.press('Escape')
        expect((await scope(page, kind)).focus).toBe(chosen)
        await panel.locator('.manager-selection-done').click()
        await panel.locator('.manager-all .manager-name').click()
        for (const eye of await panel.locator('.manager-eye').all()) await expect(eye).toBeEnabled()
    })

    test(`${kind} folder, All and bulk eyes toggle saved visibility while the selected entry stays visible`, async ({
        page,
    }) => {
        await page.evaluate(async (kind) => {
            const { history, settings, appImport } = window.editorTest
            const current = history.state.value
            const key = kind === 'groups' ? 'groups' : 'stages'
            const folderKey = kind === 'groups' ? 'groupFolders' : 'stageFolders'
            history.replaceState({
                ...current,
                [key]: new Map(
                    [...current[key]].map(([id, entry]) => [
                        id,
                        { ...entry, folderId: 9000 as never },
                    ]),
                ),
                [folderKey]: new Map([[9000 as never, { name: 'Collection', index: 0 }]]),
            })
            if (kind === 'groups') settings.showOtherGroups = true
            else settings.showOtherStages = true
            const { groupScope, stageScope } =
                await appImport<typeof import('../../src/editor/scope')>('/src/editor/scope.ts')
            const scope = (kind === 'groups' ? groupScope : stageScope) as typeof groupScope
            scope.setAllShown(false)
            scope.focus(2 as never)
        }, kind)
        const panel = await openManager(page, kind)
        const selected = kind === 'groups' ? 'Other group' : 'Side stage'
        const third = kind === 'groups' ? 'Third' : 'Back'
        const all = kind === 'groups' ? 'All Groups' : 'All Stages'
        const saved = () =>
            page.evaluate(async (kind) => {
                const { groupScope, stageScope } =
                    await window.editorTest.appImport<typeof import('../../src/editor/scope')>(
                        '/src/editor/scope.ts',
                    )
                const scope = (kind === 'groups' ? groupScope : stageScope) as typeof groupScope
                return [1, 2, 3].map((id) => scope.isShownInAll(id as never))
            }, kind)
        await expect(
            panel.getByRole('button', { name: `Hide ${selected}`, exact: true }),
        ).toBeDisabled()
        await panel.getByRole('button', { name: 'Show Collection', exact: true }).click()
        expect(await saved()).toEqual([true, true, true])
        await panel.getByRole('button', { name: 'Hide Collection', exact: true }).click()
        expect(await saved()).toEqual([false, false, false])
        await panel.getByRole('button', { name: `Show ${all}`, exact: true }).click()
        expect(await saved()).toEqual([true, true, true])
        await panel.getByRole('button', { name: `Hide ${all}`, exact: true }).click()
        expect(await saved()).toEqual([false, false, false])
        await nameButton(panel, selected).click({ modifiers: ['Control'] })
        const bar = panel.locator('.manager-selection-bar')
        await bar.getByRole('button', { name: 'Show Selected', exact: true }).click()
        expect(await saved()).toEqual([false, true, false])
        await bar.getByRole('button', { name: 'Hide Selected', exact: true }).click()
        expect(await saved()).toEqual([false, false, false])
        expect((await scope(page, kind)).visibility[selected]).toBe('full')
        await panel.locator('.manager-selection-done').click()
        await panel
            .getByRole('button', { name: `Show ${third}`, exact: true })
            .click({ modifiers: ['Alt'] })
        expect(await saved()).toEqual([false, false, true])
        expect((await scope(page, kind)).visibility).toEqual(
            kind === 'groups'
                ? { Default: 'hidden', 'Other group': 'full', Third: 'dimmed' }
                : { Center: 'hidden', 'Side stage': 'full', Back: 'dimmed' },
        )
        await panel.locator('.manager-all .manager-name').click()
        expect((await scope(page, kind)).visibility[selected]).toBe('hidden')
        expect((await scope(page, kind)).visibility[third]).toBe('full')
    })

    test(`${kind} isolation guards all visibility APIs and deleting its target restores saved masks through undo`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (kind) => {
            const { appImport, history, view, nextTick } = window.editorTest
            const { groupScope, stageScope } =
                await appImport<typeof import('../../src/editor/scope')>('/src/editor/scope.ts')
            const scope = (kind === 'groups' ? groupScope : stageScope) as typeof groupScope
            const id = 2 as never
            const first = 1 as never
            const map = () => (kind === 'groups' ? view.groupVisibility : view.stageVisibility)
            scope.setShown(id, false)
            scope.focus(id)
            const original = map()
            scope.setShown(first, false)
            scope.setSomeShown([id], true)
            scope.setAllShown(true)
            scope.showOnly([first])
            scope.reveal(first)
            const guarded = map() === original
            const isolated = [scope.visibility(first), scope.visibility(id)]
            if (kind === 'groups') {
                const { deleteGroup } = await appImport<
                    typeof import('../../src/editor/workspace/manager/groups')
                >('/src/editor/workspace/manager/groups.ts')
                deleteGroup(id)
            } else {
                const { deleteStage } = await appImport<
                    typeof import('../../src/editor/workspace/manager/stages')
                >('/src/editor/workspace/manager/stages.ts')
                deleteStage(id)
            }
            await nextTick()
            const deletedFocus = kind === 'groups' ? view.groupId : view.stageId
            const saved = [...map()]
            history.undoState()
            await nextTick()
            const restored = [scope.visibility(first), scope.visibility(id)]
            return { guarded, isolated, deletedFocus, saved, restored }
        }, kind)
        expect(result).toEqual({
            guarded: true,
            isolated: ['hidden', 'full'],
            deletedFocus: undefined,
            saved: [[2, 'hidden']],
            restored: ['full', 'hidden'],
        })
    })
}

for (const showOtherGroups of [false, true]) {
    for (const showOtherStages of [false, true]) {
        test(`mixed Show Other settings (${showOtherGroups}, ${showOtherStages}) apply independently without resetting All masks`, async ({
            page,
        }) => {
            const result = await page.evaluate(
                async ({ showOtherGroups, showOtherStages }) => {
                    const { appImport, settings, view } = window.editorTest
                    const { groupScope, stageScope } =
                        await appImport<typeof import('../../src/editor/scope')>(
                            '/src/editor/scope.ts',
                        )
                    settings.showOtherGroups = showOtherGroups
                    settings.showOtherStages = showOtherStages
                    groupScope.setShown(3 as never, false)
                    stageScope.setShown(3 as never, false)
                    const saved = [view.groupVisibility, view.stageVisibility]
                    groupScope.focus(2 as never)
                    stageScope.focus(2 as never)
                    const focused = {
                        groups: [1, 2, 3].map((id) => groupScope.visibility(id as never)),
                        stages: [1, 2, 3].map((id) => stageScope.visibility(id as never)),
                        controls: [
                            groupScope.canSetVisibility.value,
                            stageScope.canSetVisibility.value,
                        ],
                    }
                    // Changing either setting must never wipe saved eyes.
                    settings.showOtherGroups = !showOtherGroups
                    settings.showOtherStages = !showOtherStages
                    const switched = [
                        groupScope.visibility(1 as never),
                        stageScope.visibility(1 as never),
                    ]
                    groupScope.focusAll()
                    stageScope.focusAll()
                    return {
                        focused,
                        switched,
                        sameMasks:
                            saved[0] === view.groupVisibility && saved[1] === view.stageVisibility,
                        restored: [
                            groupScope.visibility(3 as never),
                            stageScope.visibility(3 as never),
                        ],
                        controls: [
                            groupScope.canSetVisibility.value,
                            stageScope.canSetVisibility.value,
                        ],
                    }
                },
                { showOtherGroups, showOtherStages },
            )
            expect(result).toEqual({
                focused: {
                    groups: [showOtherGroups ? 'dimmed' : 'hidden', 'full', 'hidden'],
                    stages: [showOtherStages ? 'dimmed' : 'hidden', 'full', 'hidden'],
                    controls: [showOtherGroups, showOtherStages],
                },
                switched: [
                    showOtherGroups ? 'hidden' : 'dimmed',
                    showOtherStages ? 'hidden' : 'dimmed',
                ],
                sameMasks: true,
                restored: ['hidden', 'hidden'],
                controls: [true, true],
            })
        })
    }
}
