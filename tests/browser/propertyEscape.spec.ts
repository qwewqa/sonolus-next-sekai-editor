import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { settings, show, fixtures, history, store, appImport } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        settings.showSidebar = true
        settings.showPreview = false
        settings.propertiesSection = 'selection'
        settings.propertiesCollapsed = ['tool', 'view']
        settings.rightDockWidth = 400
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('note')
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && entity.beat === 3,
            ),
        })
    })
})

const panel = (page: Page) => page.locator('.properties-panel')
const selected = (page: Page) =>
    page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)
const tool = (page: Page) =>
    page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        return toolName.value
    })
const showView = (page: Page) =>
    page.evaluate(() => {
        const { settings } = window.editorTest
        settings.propertiesSection = 'view'
        settings.propertiesCollapsed = ['tool', 'selection']
    })

test('a clicked property checkbox gives Escape back to Deselect without changing chart data', async ({
    page,
}) => {
    const critical = panel(page).getByRole('checkbox', { name: 'Critical', exact: true })
    await critical.click()
    await expect(critical).toBeFocused()
    await expect(critical).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
    expect(await tool(page)).toBe('note')
    // Deselect adds no undo entry: the next undo is the checkbox edit itself.
    await page.keyboard.press('ControlOrMeta+z')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    expect(
        await page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()]
                .filter((entity) => entity.type === 'note')
                .every((note) => !note.isCritical),
        ),
    ).toBe(true)
})

for (const switches of [false, true]) {
    test(`a retained radio focus permits distinct Escapes and ${switches ? 'switches' : 'keeps'} the tool`, async ({
        page,
    }) => {
        await showView(page)
        await page.evaluate((switches) => {
            window.editorTest.settings.deselectSwitchesToSelect = switches
        }, switches)
        const composed = panel(page).getByRole('radio', { name: 'Composed', exact: true })
        await composed.check()
        await expect(composed).toBeFocused()
        await page.keyboard.down('Escape')
        expect(await selected(page)).toBe(0)
        await expect(composed).toBeFocused()
        await page.keyboard.down('Escape')
        expect(await tool(page)).toBe('note')
        await page.keyboard.up('Escape')
        await page.keyboard.press('Escape')
        expect(await tool(page)).toBe(switches ? 'select' : 'note')
        await expect(composed).toBeFocused()
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

test('a keyboard-focused property section button forwards only Escape', async ({ page }) => {
    const view = panel(page).getByRole('button', { name: 'View', exact: true })
    await view.focus()
    await page.keyboard.press('Enter')
    await expect(view).toBeFocused()
    await page.keyboard.press('g')
    expect(await tool(page)).toBe('note')
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
    await expect(view).toBeFocused()
})

for (const native of [false, true]) {
    test(`${native ? 'system' : 'shared'} select owns its open Escape; closed field forwards the next one`, async ({
        page,
    }) => {
        const color = panel(page).getByRole('combobox', { name: 'Note Color', exact: true })
        if (native)
            await color.evaluate((element) => {
                element.style.appearance = 'auto'
            })
        await color.focus()
        await page.keyboard.press('Alt+ArrowDown')
        if (!native)
            await expect
                .poll(() => color.evaluate((element) => element.matches(':open')))
                .toBe(true)
        await page.keyboard.press('Escape')
        expect(await selected(page)).toBe(1)
        await expect(color).toBeFocused()
        await page.keyboard.press('Escape')
        expect(await selected(page)).toBe(0)
    })
}

test('typing, unparseable input and committed text retain their existing Escape ownership', async ({
    page,
}) => {
    const lane = panel(page).getByRole('spinbutton', { name: 'Lane', exact: true })
    await lane.fill('-2')
    await page.keyboard.press('Escape')
    await expect(lane).toHaveValue('-4')
    expect(await selected(page)).toBe(1)
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    await lane.fill('')
    await page.keyboard.type('1e')
    await page.keyboard.press('Escape')
    await expect(lane).toHaveValue('-4')
    expect(await selected(page)).toBe(1)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
})

test('claimed, composing and modified Escape never pass through a property control', async ({
    page,
}) => {
    await showView(page)
    const basic = panel(page).getByRole('radio', { name: 'Basic', exact: true })
    await basic.focus()
    for (const init of [
        { isComposing: true },
        { keyCode: 229 },
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
    ]) {
        await basic.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', ...init })
        expect(await selected(page)).toBe(1)
    }
    await basic.evaluate((input) =>
        input.addEventListener('keydown', (event) => event.preventDefault(), { once: true }),
    )
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
})

test('property Escape honors its Deselect binding without enabling other commands bound to Escape', async ({
    page,
}) => {
    await showView(page)
    const basic = panel(page).getByRole('radio', { name: 'Basic', exact: true })
    await basic.focus()
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.keyboardShortcuts = {
            ...settings.keyboardShortcuts,
            deselect: '',
            select: 'Escape',
            editorLayout: 'Escape',
        }
    })
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    expect(await tool(page)).toBe('note')
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, deselect: 'Escape' }
    })
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
    expect(await tool(page)).toBe('note')
    expect(await page.evaluate(() => window.editorTest.view.layout)).toBe('basic')
    await expect(basic).toBeFocused()
})

test('a property drawer retains its existing Escape priority', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(async () => {
        window.editorTest.settings.propertiesPosition = 'right'
        const workspace = await window.editorTest.appImport<
            typeof import('../../src/editor/workspace')
        >('/src/editor/workspace/index.ts')
        workspace.showPanel('properties')
    })
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const workspace = await window.editorTest.appImport<
                    typeof import('../../src/editor/workspace')
                >('/src/editor/workspace/index.ts')
                return workspace.drawerSide.value
            }),
        )
        .toBe('right')
    const critical = panel(page).getByRole('checkbox', { name: 'Critical', exact: true })
    await critical.click()
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    await expect(panel(page)).not.toBeVisible()
    await page.evaluate(async () => {
        const workspace = await window.editorTest.appImport<
            typeof import('../../src/editor/workspace')
        >('/src/editor/workspace/index.ts')
        workspace.showPanel('properties')
    })
    const color = panel(page).getByRole('combobox', { name: 'Note Color', exact: true })
    await color.focus()
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    await expect(panel(page)).toBeVisible()
})

test('keyboard-focused panel rail keeps arrows and Enter, while Escape returns to chart selection', async ({
    page,
}) => {
    const tab = page.locator('.panel-rail [data-panel-tab="properties"]')
    await tab.focus()
    await page.keyboard.press('ArrowUp')
    const focused = page.locator('.panel-rail [data-panel-tab]:focus')
    await expect(focused).toHaveCount(1)
    const name = await focused.getAttribute('data-panel-tab')
    await page.keyboard.press('Enter')
    await expect(focused).toHaveAttribute('data-panel-tab', name!)
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
    await expect(focused).toHaveCount(1)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('a select retains Escape when its native popup cannot be detected', async ({ page }) => {
    const color = panel(page).getByRole('combobox', { name: 'Note Color', exact: true })
    await color.focus()
    await page.evaluate(() => {
        const supports = CSS.supports.bind(CSS)
        CSS.supports = ((...args: [string] | [string, string]) =>
            args[0] === 'selector(:open)'
                ? false
                : supports(...(args as [string, string]))) as typeof CSS.supports
    })
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(1)
    await expect(color).toBeFocused()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('a keyboard-focused rail collapse button keeps its focus and forwards Deselect', async ({
    page,
}) => {
    const toggle = page.locator('.panel-rail .panel-rail-toggle').first()
    await toggle.focus()
    const expanded = await toggle.getAttribute('aria-expanded')
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Escape')
    expect(await selected(page)).toBe(0)
    await expect(toggle).toBeFocused()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
