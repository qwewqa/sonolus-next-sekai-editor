import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { settings, show, fixtures } = window.editorTest
        show(fixtures.events, 3)
        settings.showPreview = false
        settings.showSidebar = true
        settings.propertiesSection = 'view'
        settings.propertiesCollapsed = ['selection', 'tool']
        settings.rightDockWidth = 400
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, editorLayout: 'l' }
    })
})

const layout = (page: Page) => page.evaluate(() => window.editorTest.view.layout)
const choice = (page: Page, name: string) => page.getByRole('radio', { name, exact: true })

test('View choice, toolbar toggle, and configurable shortcut share layout without editing chart', async ({
    page,
}) => {
    expect(await layout(page)).toBe('basic')
    await expect(choice(page, 'Basic')).toBeChecked()
    expect(
        await page.evaluate(() => {
            const { settings } = window.editorTest
            return settings.toolbar.find((group) => group.includes('elevation'))
        }),
    ).toContain('editorLayout')

    // The mode is an action, like Elevation: changing it must keep the group's face.
    const shown = page.locator('[data-editor-toolbar] > div > div > button')
    const faces = await shown.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('title')),
    )
    await choice(page, 'Composed').check()
    expect(await layout(page)).toBe('composed')
    expect(
        await shown.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title'))),
    ).toEqual(faces)
    await expect(shown.and(page.getByTitle('Editor Layout', { exact: true }))).toHaveCount(0)
    await shown.and(page.getByTitle('Flip Horizontally', { exact: true })).hover()
    const action = page
        .locator('[data-editor-toolbar]')
        .getByTitle('Editor Layout', { exact: true })
    await expect(action).not.toHaveAttribute('aria-pressed')
    await action.click()
    expect(await layout(page)).toBe('basic')
    await expect(choice(page, 'Basic')).toBeChecked()
    await expect(action).not.toHaveAttribute('aria-pressed')

    const bounds = (await page.locator('canvas.editor-chart').boundingBox())!
    await page.mouse.click(bounds.x + 10, bounds.y + 10)
    await page.keyboard.press('l')
    expect(await layout(page)).toBe('composed')
    await expect(choice(page, 'Composed')).toBeChecked()
    await expect(action).not.toHaveAttribute('aria-pressed')
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('Composed does not displace a chosen group action or highlight its own button', async ({
    page,
}, testInfo) => {
    await page.evaluate(() => {
        window.editorTest.settings.toolbar = [['editorLayout', 'flip'], ['select']]
    })
    const toolbar = page.locator('[data-editor-toolbar]')
    const shown = toolbar.locator(':scope > div > div > button')
    const flip = shown.and(page.getByTitle('Flip Horizontally', { exact: true }))
    await choice(page, 'Composed').check()
    await expect(flip).toBeVisible()
    await flip.hover()
    const action = toolbar.getByTitle('Editor Layout', { exact: true })
    await expect(action).not.toHaveAttribute('aria-pressed')
    await expect(action).not.toHaveClass(/(?:^|\s)bg-accent(?:\s|$)/)
    await action.click()
    await action.click()
    expect(await layout(page)).toBe('composed')
    await expect(action).not.toHaveAttribute('aria-pressed')
    await expect(action).not.toHaveClass(/(?:^|\s)bg-accent(?:\s|$)/)
    await action.screenshot({ path: testInfo.outputPath('layout-tool.png') })
    // Choosing another action while Composed is active must leave it on the face.
    await action.hover()
    await toolbar.getByTitle('Flip Horizontally', { exact: true }).click()
    await expect(flip).toBeVisible()
    await choice(page, 'Basic').check()
    await choice(page, 'Composed').check()
    await expect(flip).toBeVisible()
    await expect(shown.and(page.getByTitle('Editor Layout', { exact: true }))).toHaveCount(0)
})

test('non-dynamic charts omit the layout field and composed pressed state', async ({ page }) => {
    await choice(page, 'Composed').check()
    await page.evaluate(() => {
        const { show, fixtures } = window.editorTest
        show(fixtures.interaction, 3)
    })
    await expect(choice(page, 'Composed')).toHaveCount(0)
    const pressed = await page.evaluate(async () => {
        const { commandState } = await window.editorTest.appImport<
            typeof import('../../src/editor/toolbar/pressed')
        >('/src/editor/toolbar/pressed.ts')
        return commandState('editorLayout', ['editorLayout'])?.current
    })
    expect(pressed).toBeUndefined()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('switching layout cancels an active gesture and clears transient editing state', async ({
    page,
}) => {
    const point = await page.evaluate(() => {
        const { show, fixtures, point } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        return point(-3, 3)
    })
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 40, point.y - 20, { steps: 4 })
    expect(
        await page.evaluate(async () => {
            const { isDragging } = await window.editorTest.appImport<
                typeof import('../../src/editor/controls/gestures/recognizers/drag')
            >('/src/editor/controls/gestures/recognizers/drag.ts')
            return !!isDragging.value
        }),
    ).toBe(true)
    await page.evaluate(async () => {
        const { commands } = await window.editorTest.appImport<
            typeof import('../../src/editor/commands')
        >('/src/editor/commands/index.ts')
        await commands.editorLayout.execute()
    })
    expect(
        await page.evaluate(async () => {
            const { isDragging } = await window.editorTest.appImport<
                typeof import('../../src/editor/controls/gestures/recognizers/drag')
            >('/src/editor/controls/gestures/recognizers/drag.ts')
            const { view } = window.editorTest
            return {
                dragging: !!isDragging.value,
                selection: view.selection,
                hovered: view.entities.hovered.length,
                creating: view.entities.creating.length,
            }
        }),
    ).toEqual({ dragging: false, selection: undefined, hovered: 0, creating: 0 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('layout preference does not interrupt an ordinary chart drag', async ({ page }) => {
    const start = await page.evaluate(() => {
        const { show, fixtures, point } = window.editorTest
        show(fixtures.interaction, 3)
        return point(-3, 3)
    })
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 40, start.y, { steps: 4 })
    const active = await page.evaluate(async () => {
        const { appImport, view } = window.editorTest
        const { isDragging } = await appImport<
            typeof import('../../src/editor/controls/gestures/recognizers/drag')
        >('/src/editor/controls/gestures/recognizers/drag.ts')
        const before = view.entities.creating
        view.layout = 'composed'
        return { dragging: !!isDragging.value, preserved: view.entities.creating === before }
    })
    expect(active).toEqual({ dragging: true, preserved: true })
    await page.mouse.up()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
    const moved = await page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map(({ left }) => left),
    )
    expect(moved).toEqual([-3])
})

for (const dynamic of [false, true]) {
    test(`layout transition ${dynamic ? 'cancels dynamic' : 'preserves ordinary'} scaling preview`, async ({
        page,
    }) => {
        const result = await page.evaluate(async (dynamic) => {
            const { appImport, show, fixtures, history, store, view } = window.editorTest
            show({ ...fixtures.interaction, isDynamicStages: dynamic }, 3)
            const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
            history.replaceState({ ...history.state.value, selectedEntities: [note] })
            const session = await appImport<
                typeof import('../../src/editor/commands/scaleSelection/session')
            >('/src/editor/commands/scaleSelection/session.ts')
            const edit =
                await appImport<typeof import('../../src/preview/edit')>('/src/preview/edit.ts')
            const started = !!session.beginScalingSession('width')
            const changed = session.setScalingFactor(2)
            const before = edit.previewEdit.value
            view.layout = 'composed'
            const result = {
                started,
                changed,
                active: !!session.scalingSession.value,
                hasPreview: !!edit.previewEdit.value,
                samePreview: !!before && edit.previewEdit.value === before,
                undo: history.canUndo.value,
                selected: history.state.value.selectedEntities.length,
            }
            session.cancelScalingSession()
            return result
        }, dynamic)
        expect(result).toEqual({
            started: true,
            changed: true,
            active: !dynamic,
            hasPreview: !dynamic,
            samePreview: !dynamic,
            undo: false,
            selected: 1,
        })
    })
}

test('changing dynamic layout closes an old context menu and preserves its selection', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, show, fixtures, history, store, view, point } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        const { contextMenu, openSelectionContextMenu } = await appImport<
            typeof import('../../src/editor/contextMenu')
        >('/src/editor/contextMenu.ts')
        view.pointer = { ...view.pointer, ...point(-3, 3) }
        openSelectionContextMenu()
        const opened = !!contextMenu.value
        view.layout = 'composed'
        return {
            opened,
            closed: !contextMenu.value,
            selected: history.state.value.selectedEntities[0] === note,
            undo: history.canUndo.value,
        }
    })
    expect(result).toEqual({ opened: true, closed: true, selected: true, undo: false })
})

test('layout change cancels touch contacts without committing on release or opening a delayed menu', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, show, fixtures, history, view, point, settings } = window.editorTest
        show({ ...fixtures.interaction, isDynamicStages: true }, 3)
        settings.touchLongPressContextMenu = true
        const { hasTouchControls } = await appImport<
            typeof import('../../src/editor/controls/touch')
        >('/src/editor/controls/touch.ts')
        const { contextMenu } = await appImport<typeof import('../../src/editor/contextMenu')>(
            '/src/editor/contextMenu.ts',
        )
        const { isDragging } = await appImport<
            typeof import('../../src/editor/controls/gestures/recognizers/drag')
        >('/src/editor/controls/gestures/recognizers/drag.ts')
        const target = document.querySelector('canvas.editor-chart')!.closest('.editor')!
        const start = point(-3, 3)
        const dispatch = (type: string, x = start.x) => {
            target.dispatchEvent(
                new TouchEvent(type, {
                    changedTouches: [
                        new Touch({ identifier: 1, target, clientX: x, clientY: start.y }),
                    ],
                    bubbles: true,
                    cancelable: true,
                }),
            )
        }
        dispatch('touchstart')
        dispatch('touchmove', start.x + 50)
        const dragged = !!isDragging.value
        view.layout = 'composed'
        const cleared = !hasTouchControls() && !isDragging.value
        dispatch('touchend', start.x + 50)
        dispatch('touchstart')
        const pressed = hasTouchControls()
        view.layout = 'basic'
        await new Promise((resolve) => setTimeout(resolve, 550))
        dispatch('touchend')
        return {
            dragged,
            cleared,
            pressed,
            contact: hasTouchControls(),
            menu: !!contextMenu.value,
            undo: history.canUndo.value,
        }
    })
    expect(result).toEqual({
        dragged: true,
        cleared: true,
        pressed: true,
        contact: false,
        menu: false,
        undo: false,
    })
})

test('toolbar upgrade runs once and intentional removal survives reload and settings reset', async ({
    page,
}) => {
    // Simulate a saved toolbar from before Composed, with the previous default group.
    await page.evaluate(() => {
        const { settings } = window.editorTest
        const groups = settings.toolbar.map((group) =>
            group.filter((name) => name !== 'editorLayout'),
        )
        localStorage.setItem('sonolus-next-sekai-editor.toolbar', JSON.stringify(groups))
        localStorage.removeItem('sonolus-next-sekai-editor.toolbarEditorLayoutMigrated')
    })
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    expect(
        await page.evaluate(() =>
            window.editorTest.settings.toolbar.find((group) => group.includes('elevation')),
        ),
    ).toContain('editorLayout')
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.toolbar = settings.toolbar.map((group) =>
            group.filter((name) => name !== 'editorLayout'),
        )
    })
    expect(
        await page.evaluate(() =>
            window.editorTest.settings.toolbar.flat().includes('editorLayout'),
        ),
    ).toBe(false)
    await page.reload()
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    expect(
        await page.evaluate(() =>
            window.editorTest.settings.toolbar.flat().includes('editorLayout'),
        ),
    ).toBe(false)
    await page.evaluate(async () => {
        const { resetSettings } =
            await window.editorTest.appImport<typeof import('../../src/settings')>(
                '/src/settings.ts',
            )
        resetSettings()
    })
    expect(
        await page.evaluate(() =>
            window.editorTest.settings.toolbar.find((group) => group.includes('elevation')),
        ),
    ).toContain('editorLayout')
})
