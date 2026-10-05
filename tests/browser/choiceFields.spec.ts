import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const transition = (page: Page) => panel(page).getByRole('radiogroup', { name: /^Transition/ })

const open = async (page: Page, values: Record<string, unknown> = {}) => {
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async (values) => {
        const { fixtures, show, history, store, settings, nextTick } = window.editorTest
        Object.assign(settings, { showSidebar: true, ...values })
        show(fixtures.events)
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale',
            ),
        })
        await nextTick()
    }, values)
    await expect(panel(page)).toBeVisible()
}

const transitions = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
            entity.type === 'timeScale' ? [entity.timeScaleTransition] : [],
        ),
    )

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
})

test.describe('roomy panel', () => {
    test('two named options show side by side, with none checked when mixed', async ({ page }) => {
        await open(page, { rightDockWidth: 560 })
        const group = transition(page)
        await expect(group).toHaveAccessibleName('Transition Mixed')
        await expect(group.getByRole('radio', { name: 'Time Scale', exact: true })).toBeVisible()
        await expect(group.getByRole('radio', { name: 'Scroll', exact: true })).toBeVisible()
        await expect(group.getByRole('radio', { checked: true })).toHaveCount(0)

        // The field label names the group without choosing an option.
        await panel(page).getByText('Transition', { exact: true }).click()
        expect(new Set(await transitions(page))).toEqual(new Set(['timeScale', 'scroll']))

        await group.getByRole('radio', { name: 'Scroll', exact: true }).click()
        expect(await transitions(page)).toEqual(['scroll', 'scroll', 'scroll', 'scroll'])
        await expect(group).toHaveAccessibleName('Transition')
        await expect(group.getByRole('radio', { name: 'Scroll' })).toBeChecked()

        // Arrow keys move within the group, one edit per press, without editor shortcuts.
        const view = () =>
            page.evaluate(() => {
                const { view, settings } = window.editorTest
                return { time: view.time, lane: view.lane, showGroups: settings.showGroups }
            })
        const before = await view()
        await group.getByRole('radio', { name: 'Scroll' }).focus()
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('Space')
        await page.keyboard.press('e')
        expect(await view()).toEqual(before)
        expect(await transitions(page)).toEqual([
            'timeScale',
            'timeScale',
            'timeScale',
            'timeScale',
        ])
        await page.evaluate(() => window.editorTest.history.undoState())
        expect(await transitions(page)).toEqual(['scroll', 'scroll', 'scroll', 'scroll'])
        await expect(group.getByRole('radio', { name: 'Scroll' })).toBeChecked()
    })

    test('view snapping shows both modes and only switches to the other one', async ({ page }) => {
        await open(page, { rightDockWidth: 560 })
        const group = panel(page).getByRole('radiogroup', { name: 'Snapping', exact: true })
        const snapping = () => page.evaluate(() => window.editorTest.view.snapping)
        await expect(group.getByRole('radio', { name: 'Absolute' })).toBeChecked()

        await group.getByRole('radio', { name: 'Relative', exact: true }).click()
        expect(await snapping()).toBe('relative')
        await group.getByRole('radio', { name: 'Relative', exact: true }).click()
        expect(await snapping()).toBe('relative')
        await expect(group.getByRole('radio', { name: 'Relative' })).toBeChecked()
    })

    test('brush fields can return to unchanged, leaving the brush', async ({ page }) => {
        await open(page, { rightDockWidth: 560 })
        await panel(page).getByRole('combobox', { name: 'Tool', exact: true }).selectOption({
            label: 'Brush',
        })
        const tool = panel(page).getByRole('region', { name: 'Tool' })
        await tool
            .getByRole('combobox', { name: 'Add Property' })
            .selectOption('timeScaleTransition')
        const group = tool.getByRole('radiogroup', { name: /^Transition/ })
        // The brush names its unset value "Unchanged".
        const unchanged = group.getByRole('radio', { name: 'Unchanged', exact: true })
        await expect(group.getByRole('radio', { name: 'Time Scale', exact: true })).toBeChecked()

        const brush = () =>
            page.evaluate(async () => {
                const pathname = '/src/editor/tools/brush/index.ts'
                // Live module URL, so the state-owning module is not imported twice.
                const url =
                    performance
                        .getEntriesByType('resource')
                        .map((entry) => entry.name)
                        .find((name) => new URL(name).pathname === pathname) ?? pathname
                const module = (await import(url)) as typeof import('../../src/editor/tools/brush')
                return module.brushProperties.value.timeScaleTransition ?? null
            })
        await group.getByRole('radio', { name: 'Scroll', exact: true }).click()
        expect(await brush()).toBe('scroll')
        await unchanged.click()
        expect(await brush()).toBeNull()
        await expect(group).toHaveCount(0)
    })
})

test('a narrow dock uses a select and hands focus over when it widens', async ({ page }) => {
    await open(page)
    await expect(transition(page)).toHaveCount(0)
    const select = panel(page).getByRole('combobox', { name: 'Transition', exact: true })
    // While mixed, options in use carry their object counts.
    await expect(select.locator('option')).toHaveText(['Mixed', 'Time Scale · 2', 'Scroll · 2'])
    await select.selectOption('timeScale')
    expect(await transitions(page)).toEqual(['timeScale', 'timeScale', 'timeScale', 'timeScale'])
    // Mixed is only ever the shown value, never a listed choice.
    await expect(select.locator('option')).toHaveText(['Time Scale', 'Scroll'])

    const selectHeight = await select.evaluate((element) => (element as HTMLElement).offsetHeight)
    await select.focus()
    await page.evaluate(() => (window.editorTest.settings.rightDockWidth = 560))
    await expect(transition(page)).toBeVisible()
    await expect(transition(page).getByRole('radio', { name: 'Time Scale' })).toBeFocused()
    // Both forms keep the row height.
    expect(
        await transition(page).evaluate((element) => (element as HTMLElement).offsetHeight),
    ).toBe(selectHeight)
})

test.describe('phone panel', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('two options fit beside the label and respond to taps', async ({ page }) => {
        await open(page)
        const group = transition(page)
        await group.scrollIntoViewIfNeeded()
        const bounds = (await panel(page).boundingBox())!
        const box = (await group.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        expect(box.height).toBeLessThanOrEqual(36)

        await group.getByRole('radio', { name: 'Scroll', exact: true }).tap()
        expect(await transitions(page)).toEqual(['scroll', 'scroll', 'scroll', 'scroll'])
    })
})
