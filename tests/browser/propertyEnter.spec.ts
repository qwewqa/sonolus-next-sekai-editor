import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { show, fixtures, settings, history, store, appImport } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        settings.showSidebar = true
        settings.showPreview = false
        settings.propertiesSection = 'selection'
        settings.propertiesCollapsed = ['tool', 'view']
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

const state = (page: Page) =>
    page.evaluate(async () => {
        const { history, appImport } = window.editorTest
        const { toolName } = await appImport<typeof import('../../src/editor/tools/state')>(
            '/src/editor/tools/state.ts',
        )
        return {
            tool: toolName.value,
            selected: history.state.value.selectedEntities.length,
            undo: history.canUndo.value,
        }
    })

const run = (page: Page, name: 'elevation' | 'properties' | 'scaleWidth') =>
    page.evaluate(async (name) => {
        const { commands } = await window.editorTest.appImport<
            typeof import('../../src/editor/commands')
        >('/src/editor/commands/index.ts')
        void commands[name].execute()
    }, name)

for (const layout of ['basic', 'composed'] as const) {
    for (const switches of [false, true]) {
        test(`${layout}: Enter commits and releases focus; Escape deselects then ${switches ? 'selects' : 'keeps the tool'}`, async ({
            page,
        }) => {
            await page.evaluate(
                ({ layout, switches }) => {
                    window.editorTest.view.layout = layout
                    window.editorTest.settings.deselectSwitchesToSelect = switches
                },
                { layout, switches },
            )
            const lane = page.getByRole('spinbutton', { name: 'Lane', exact: true })
            await lane.fill('-2')
            await page.keyboard.press('Enter')
            await expect(lane).not.toBeFocused()
            expect(await state(page)).toEqual({ tool: 'note', selected: 1, undo: true })
            await page.keyboard.press('Escape')
            expect(await state(page)).toEqual({ tool: 'note', selected: 0, undo: true })
            await page.keyboard.press('Escape')
            expect(await state(page)).toEqual({
                tool: switches ? 'select' : 'note',
                selected: 0,
                undo: true,
            })
        })
    }
}

for (const text of ['-4', '', '-', '1e']) {
    test(`Enter releases a selection field with ${JSON.stringify(text)} and keeps the committed value`, async ({
        page,
    }) => {
        const lane = page.getByRole('spinbutton', { name: 'Lane', exact: true })
        await lane.focus()
        await page.keyboard.press('ControlOrMeta+A')
        await page.keyboard.press('Backspace')
        await page.keyboard.type(text)
        if (text === '-' || text === '1e')
            expect(await lane.evaluate((input: HTMLInputElement) => input.validity.badInput)).toBe(
                true,
            )
        await page.keyboard.press('Enter')
        await expect(lane).not.toBeFocused()
        await expect(lane).toHaveValue('-4')
        expect(await state(page)).toEqual({ tool: 'note', selected: 1, undo: false })
        await page.keyboard.press('Escape')
        expect((await state(page)).selected).toBe(0)
    })
}

test('out-of-range selection input is reverted before Enter releases it', async ({ page }) => {
    const size = page.getByRole('spinbutton', { name: 'Size', exact: true }).first()
    await size.fill('-1')
    await page.keyboard.press('Enter')
    await expect(size).not.toBeFocused()
    await expect(size).toHaveValue('2')
    expect((await state(page)).undo).toBe(false)
    await page.keyboard.press('Escape')
    expect((await state(page)).selected).toBe(0)
})

for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
    test(`IME Enter ${JSON.stringify(composing)} neither commits nor releases the field`, async ({
        page,
    }) => {
        const lane = page.getByRole('spinbutton', { name: 'Lane', exact: true })
        await lane.fill('-2')
        await lane.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ...composing })
        await expect(lane).toBeFocused()
        expect((await state(page)).undo).toBe(false)
        await page.keyboard.press('Enter')
        await expect(lane).not.toBeFocused()
        expect((await state(page)).undo).toBe(true)
    })
}

test('standalone View number confirms then gives Escape back to the editor', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.propertiesSection = 'view'
        window.editorTest.settings.propertiesCollapsed = ['tool', 'selection']
    })
    const size = page
        .locator('[data-properties-section="view"]')
        .getByRole('spinbutton', { name: 'Size', exact: true })
    await size.fill('5')
    await page.keyboard.press('Enter')
    await expect(size).not.toBeFocused()
    expect(await page.evaluate(() => window.editorTest.view.noteSize)).toBe(5)
    await size.fill('-1')
    await page.keyboard.press('Enter')
    await expect(size).not.toBeFocused()
    await expect(size).toHaveValue('5')
    await page.keyboard.press('Escape')
    expect((await state(page)).selected).toBe(0)
})

test('name and optional-number property fields finish on Enter and reject invalid entries', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        const { showModal } =
            await appImport<typeof import('../../src/modals')>('/src/modals/index.ts')
        const { default: GroupPropertiesModal } = await appImport<
            typeof import('../../src/editor/commands/manageGroups/manageGroups/groupProperties/GroupPropertiesModal.vue')
        >('/src/editor/commands/manageGroups/manageGroups/groupProperties/GroupPropertiesModal.vue')
        void showModal(GroupPropertiesModal, {
            groupId: [...history.state.value.groups.keys()][0]!,
        })
    })
    const dialog = page.locator('dialog[open]')
    const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
    await name.fill('Renamed')
    await page.keyboard.press('Enter')
    await expect(name).not.toBeFocused()
    await expect(name).toHaveValue('Renamed')
    await name.fill('')
    await page.keyboard.press('Enter')
    await expect(name).not.toBeFocused()
    await expect(name).toHaveValue('Renamed')
    const speed = dialog.getByRole('spinbutton')
    await speed.fill('9')
    await page.keyboard.press('Enter')
    await expect(speed).not.toBeFocused()
    await expect(speed).toHaveValue('9')
    await speed.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('1e')
    await page.keyboard.press('Enter')
    await expect(speed).not.toBeFocused()
    await expect(speed).toHaveValue('9')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('elevation Beat commits on Enter, while scaling and validating dialogs still submit', async ({
    page,
}) => {
    await run(page, 'elevation')
    const beat = page
        .locator('.elevation-editor')
        .getByRole('spinbutton', { name: 'Beat', exact: true })
    await beat.fill('7')
    await page.keyboard.press('Enter')
    await expect(beat).not.toBeFocused()
    await expect(beat).toHaveValue('7')
    await run(page, 'elevation')
    await run(page, 'scaleWidth')
    const factor = page.locator('.scaling-panel').getByRole('spinbutton')
    await factor.fill('2')
    await page.keyboard.press('Enter')
    await expect(page.locator('.scaling-panel')).toHaveCount(0)
    expect((await state(page)).undo).toBe(true)
    await run(page, 'properties')
    const dialog = page.locator('dialog[open]')
    const life = dialog.getByRole('spinbutton')
    await life.fill('0')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(life).toBeFocused()
    await life.fill('777')
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => window.editorTest.history.state.value.initialLife)).toBe(777)
})

test('Enter retains native dropdown selection and multiline newline behavior', async ({ page }) => {
    await page.evaluate(() => {
        window.editorTest.settings.propertiesSection = 'view'
        window.editorTest.settings.propertiesCollapsed = ['tool', 'selection']
    })
    const select = page.locator('[data-properties-section="view"]').getByRole('combobox').first()
    await select.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(select).toBeFocused()
    expect((await state(page)).selected).toBe(1)
    // The editor has no multiline property today; ensure shared Enter handling remains single-line.
    await page.evaluate(async () => {
        const { confirmOnEnter } = await window.editorTest.appImport<
            typeof import('../../src/modals/form/resync')
        >('/src/modals/form/resync.ts')
        const textarea = document.createElement('textarea')
        textarea.setAttribute('aria-label', 'Multiline regression field')
        textarea.style.cssText = 'position:fixed;top:0;left:0;z-index:9999'
        textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') confirmOnEnter(event)
        })
        document.body.append(textarea)
        textarea.focus()
    })
    const multiline = page.getByRole('textbox', { name: 'Multiline regression field' })
    await page.keyboard.type('one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await expect(multiline).toBeFocused()
    await expect(multiline).toHaveValue('one\ntwo')
})
