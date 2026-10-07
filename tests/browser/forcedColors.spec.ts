import { expect, test, type Locator, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// High contrast drops box shadows and backgrounds; states must show as outlines.

const panel = (page: Page) => page.locator('#workspace-panel-properties')

const outline = (locator: Locator) =>
    locator.evaluate((element) => {
        const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(element)
        return { style: outlineStyle, width: outlineWidth, color: outlineColor }
    })

// Keyboard focus, as Tab gives it.
const focus = async (locator: Locator) => {
    await locator.page().keyboard.press('Shift')
    await locator.focus()
    expect(await locator.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
}

const highlight = (page: Page) =>
    page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'Highlight'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })

test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { history, store, nextTick, fixtures, settings } = window.editorTest
        const chart = structuredClone(fixtures.interaction)
        // Each head gets a tail, so connector fields show; Critical is mixed.
        chart.slides = chart.slides.map(([head], index) => [
            { ...head!, isCritical: index === 0 },
            { ...head!, beat: head!.beat + 1 },
        ])
        history.resetState(false, chart, 0, 'forced.json')
        Object.assign(settings, { showSidebar: true, propertiesConnectorExpanded: true })
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()]
                .filter((entity) => entity.type === 'note')
                .slice(0, 3),
        })
        await nextTick()
    })
    await expect(panel(page).locator('.form-field').first()).toBeVisible()
})

test('Selection chips show keyboard focus', async ({ page }) => {
    const chip = panel(page).getByRole('button', { name: /^Select only Disabled/ })
    await focus(chip)
    expect(await outline(chip)).toEqual({
        style: 'solid',
        width: '2px',
        color: await highlight(page),
    })
})
