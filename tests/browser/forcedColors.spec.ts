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

const expectSegments = async (group: Locator) => {
    const page = group.page()
    const checked = group.locator('label:has(input:checked)')
    const unchecked = group.locator('label:not(:has(input:checked))').first()
    await expect(checked).toHaveCount(1)
    expect(await outline(checked)).toMatchObject({ style: 'solid', width: '1px' })
    expect((await outline(unchecked)).style).toBe('none')
    // Focus outlines the segment itself, so a focused checked one shows both.
    const radio = checked.locator('input')
    await focus(radio)
    expect(await outline(radio.locator('+ span'))).toEqual({
        style: 'solid',
        width: '2px',
        color: await highlight(page),
    })
    expect(await outline(checked)).toMatchObject({ style: 'solid', width: '1px' })
}

test('segmented controls show the checked choice and keyboard focus', async ({ page }) => {
    await expectSegments(panel(page).getByRole('radiogroup', { name: 'Snapping', exact: true }))
    await page.locator('.panel-tab', { hasText: 'Preview' }).click()
    await expectSegments(page.getByRole('radiogroup', { name: 'Aspect ratio' }))
})

test('Preview Settings on/off fields show keyboard focus', async ({ page }) => {
    await page.locator('.panel-tab', { hasText: 'Preview' }).click()
    const input = page.getByRole('checkbox', { name: 'Show Hitboxes', exact: true })
    const field = input.locator('+ .preview-field')
    // The resting edge.
    expect(await outline(field)).toMatchObject({ style: 'solid', width: '2px' })
    const edge = (await outline(field)).color
    await focus(input)
    const focused = await outline(field)
    expect(focused).toEqual({ style: 'solid', width: '2px', color: await highlight(page) })
    expect(focused.color).not.toBe(edge)
})

test('status bar chips show keyboard focus', async ({ page }) => {
    const chip = page.locator('.status-chip').first()
    await focus(chip)
    expect(await outline(chip)).toEqual({
        style: 'solid',
        width: '2px',
        color: await highlight(page),
    })
})

test('rail and Properties tabs mark the selected tab', async ({ page }) => {
    const background = (locator: Locator, pseudo?: string) =>
        locator.evaluate(
            (element, pseudo) => getComputedStyle(element, pseudo).backgroundColor,
            pseudo,
        )
    const text = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'CanvasText'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })
    const marker = page.locator('[data-panel-tab="properties"] .panel-tab-marker')
    expect(await background(marker)).toBe(text)
    // Short panels show one section at a time behind tabs.
    await page.setViewportSize({ width: 1600, height: 480 })
    const active = panel(page).locator('.properties-tab-active .properties-tab-label')
    await expect(active).toBeVisible()
    expect(await background(active, '::after')).toBe(text)
})
