import { expect, test, type Locator, type Page } from '@playwright/test'
import type { StageId } from '../../src/chart/stages'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Group and stage commands keep a visible, predictable effect after the
// managers' eye and solo controls changed visibility.

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

const setShowOtherGroups = async (page: Page, value: boolean) => {
    await page.evaluate((value) => (window.editorTest.settings.showOtherGroups = value), value)
    await page.evaluate(() => window.editorTest.nextTick())
}

/** Runs a shortcut with the editor focused, as after a pointer click in a manager. */
const press = async (page: Page, key: string) => {
    await expect
        .poll(() =>
            page.evaluate(() => !document.activeElement?.closest('[id^="workspace-panel-"]')),
        )
        .toBe(true)
    await page.keyboard.press(key)
}

test('All Groups shows groups hidden in the manager', async ({ page }) => {
    const panel = await openManager(page, 'groups')
    await panel.getByRole('button', { name: 'Hide Third', exact: true }).click()
    expect((await scope(page, 'groups')).visibility.Third).toBe('hidden')

    await press(page, '3')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'full', 'Other group': 'full', Third: 'full' },
    })
    await expect(panel.getByRole('button', { name: 'Hide Third', exact: true })).toBeVisible()
    await expect(page.locator('.status-chip').filter({ hasText: 'Groups' })).not.toContainText('/3')
})

test('All Groups after a solo clears the focus and every hide', async ({ page }) => {
    const panel = await openManager(page, 'groups')
    await nameButton(panel, 'Other group').click()
    await panel
        .getByRole('button', { name: 'Hide Default', exact: true })
        .click({ modifiers: ['Alt'] })
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'dimmed',
        'Other group': 'hidden',
        Third: 'hidden',
    })

    await press(page, '3')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'full', 'Other group': 'full', Third: 'full' },
    })
})

test('Next and Previous Group reveal their target and end at all groups', async ({ page }) => {
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
        visibility: { Default: 'dimmed', 'Other group': 'full', Third: 'hidden' },
    })

    // Stepping past the ends reaches all groups, like All Groups.
    await press(page, '1')
    await press(page, '1')
    expect(await scope(page, 'groups')).toEqual({
        focus: undefined,
        visibility: { Default: 'full', 'Other group': 'full', Third: 'full' },
    })
})

test('turning Show Other Groups on or off overrides contradicting eyes', async ({ page }) => {
    const panel = await openManager(page, 'groups')
    await nameButton(panel, 'Default').click()
    await panel.getByRole('button', { name: 'Hide Third', exact: true }).click()
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'full',
        'Other group': 'dimmed',
        Third: 'hidden',
    })

    await setShowOtherGroups(page, false)
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'full',
        'Other group': 'hidden',
        Third: 'hidden',
    })
    await setShowOtherGroups(page, true)
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'full',
        'Other group': 'dimmed',
        Third: 'dimmed',
    })

    // An explicit show while others are hidden is likewise undone by turning it off.
    await setShowOtherGroups(page, false)
    await panel.getByRole('button', { name: 'Show Third', exact: true }).click()
    expect((await scope(page, 'groups')).visibility.Third).toBe('dimmed')
    await setShowOtherGroups(page, true)
    await setShowOtherGroups(page, false)
    expect((await scope(page, 'groups')).visibility).toEqual({
        Default: 'full',
        'Other group': 'hidden',
        Third: 'hidden',
    })
})

for (const [device, options] of Object.entries({
    desktop: {},
    phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
})) {
    test.describe(device, () => {
        test.use(options)

        test('the toolbar All Groups shows a group hidden in the manager', async ({ page }) => {
            const press = (locator: Locator) =>
                device === 'phone' ? locator.tap() : locator.click()
            const panel = await openManager(page, 'groups')
            await press(panel.getByRole('button', { name: 'Hide Third', exact: true }))
            const chip = page.locator('.status-chip').filter({ hasText: 'Groups' })
            await expect(chip).toContainText('2/3')

            const toolbar = page.locator('[data-editor-toolbar]').first()
            const tool = toolbar.locator('button[title="Manage Groups"]').first()
            if (device === 'phone') await tool.tap()
            else await tool.hover()
            await press(toolbar.locator('.overflow-y-auto button[title="All Groups"]'))

            expect((await scope(page, 'groups')).visibility).toEqual({
                Default: 'full',
                'Other group': 'full',
                Third: 'full',
            })
            await expect(chip).not.toContainText('/3')
            await expect(
                panel.getByRole('button', { name: 'Hide Third', exact: true }),
            ).toBeVisible()
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
        visibility: { Center: 'full', 'Side stage': 'full', Back: 'full' },
    })

    await panel.getByRole('button', { name: 'Hide All Stages', exact: true }).click()
    await press(page, '4')
    expect(await scope(page, 'stages')).toEqual({
        focus: 'Back',
        visibility: { Center: 'hidden', 'Side stage': 'hidden', Back: 'full' },
    })
    await press(page, '5')
    expect(await scope(page, 'stages')).toEqual({
        focus: undefined,
        visibility: { Center: 'full', 'Side stage': 'full', Back: 'full' },
    })
})

test('the status bar lists the group before the stage', async ({ page }) => {
    await expect(page.locator('.status-chip')).toHaveText([/^All Groups/, /^All Stages/])
})
