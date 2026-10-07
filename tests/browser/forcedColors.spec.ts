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
    const input = page.getByRole('switch', { name: 'Show Hitboxes', exact: true })
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

const expectEdges = async (fields: Locator) => {
    const page = fields.page()
    const text = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'CanvasText'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })
    // At rest: a dialog focuses its first field.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    // One round trip for every field.
    const edges = await fields.evaluateAll((elements) =>
        elements.map((element) => {
            const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(element)
            return {
                label: element.closest('.form-field')?.querySelector('.form-field-text')
                    ?.textContent,
                style: outlineStyle,
                width: outlineWidth,
                color: outlineColor,
            }
        }),
    )
    expect(edges.length).toBeGreaterThan(3)
    for (const { label, ...edge } of edges)
        expect({ label, ...edge }).toEqual({ label, style: 'solid', width: '2px', color: text })
}

test('Properties and Settings fields keep their edge, as Preview Settings fields do', async ({
    page,
}) => {
    const pills =
        '.form-field-row input:not([type="radio"]), .form-field-row select, .form-field-row button:not(.form-field-mixed-value)'
    await expectEdges(panel(page).locator(pills))
    await page.keyboard.press(',')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectEdges(page.getByRole('dialog').locator(pills))
})

test('on/off switches keep their track and knob, whose place shows the state', async ({ page }) => {
    const buttonText = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'ButtonText'
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    })
    const toggle = (label: string) =>
        panel(page)
            .locator('.form-field')
            .filter({
                has: page.locator('.form-field-text', { hasText: new RegExp(`^${label}$`) }),
            })
            .locator('.form-field-toggle-icon > span')
    const switches = await Promise.all(
        ['Critical', 'Fake'].map((label) =>
            toggle(label).evaluate((track) => {
                const knob = track.firstElementChild as HTMLElement
                const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(track)
                return {
                    track: { style: outlineStyle, width: outlineWidth, color: outlineColor },
                    knob: getComputedStyle(knob).backgroundColor,
                    left: knob.offsetLeft,
                }
            }),
        ),
    )
    for (const { track, knob } of switches) {
        expect(track).toEqual({ style: 'solid', width: '1px', color: buttonText })
        expect(knob).toBe(buttonText)
    }
    // Critical is mixed, its knob centered; Fake is off.
    expect(switches[0]!.left).toBeGreaterThan(switches[1]!.left)
})

test('toolbar tools keep their edge, and the tool in use is selected', async ({ page }) => {
    const text = await systemColor(page, 'CanvasText')
    const selected = await systemColor(page, 'Highlight')
    const selectedText = await systemColor(page, 'HighlightText')
    const looks = (locator: Locator) =>
        locator.evaluateAll((elements) =>
            elements.map((element) => {
                const style = getComputedStyle(element)
                return {
                    title: element.getAttribute('title'),
                    pressed: element.getAttribute('aria-pressed') === 'true',
                    edge: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
                    background: style.backgroundColor,
                    color: style.color,
                    fill: style.fill,
                }
            }),
        )
    // Values in use are pressed too, but keep the resting look.
    const isValue = (title: string | null) => /Division|Lane Limit/.test(title ?? '')
    const expectTools = async (locator: Locator, pressedCount: number) => {
        const tools = (await looks(locator)).map((tool) => ({
            ...tool,
            pressed: tool.pressed && !isValue(tool.title),
        }))
        expect(tools.length).toBeGreaterThan(1)
        for (const { title, pressed, edge, background, color, fill } of tools) {
            // The edge takes the text colour.
            expect({ title, edge }).toEqual({
                title,
                edge: `solid 2px ${pressed ? selectedText : text}`,
            })
            if (pressed)
                expect({ title, background, color, fill }).toEqual({
                    title,
                    background: selected,
                    color: selectedText,
                    fill: selectedText,
                })
            else expect({ title, background }).not.toEqual({ title, background: selected })
        }
        expect(tools.filter(({ pressed }) => pressed)).toHaveLength(pressedCount)
    }
    const toolbar = page.locator('[data-editor-toolbar]')
    // Select is in use; the division and lane groups show their current values, unselected.
    const faces = toolbar.locator(':scope > div > div > button')
    await expect(faces.and(page.locator('[aria-pressed="true"]'))).toHaveCount(4)
    await expectTools(faces, 1)
    const select = toolbar.getByTitle('Select', { exact: true })
    await expect.poll(() => fills(select, 'path')).toEqual([selectedText])

    // Focus keeps the edge and adds an inner ring, distinct from the resting look.
    await focus(select)
    expect(await outline(select)).toEqual({ style: 'solid', width: '2px', color: selectedText })
    expect(await innerRing(select)).toBe(selectedText)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    // Pressing it keeps the selected colours, as other buttons keep theirs.
    const box = (await select.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(300)
    expect(
        await select.first().evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(selected)
    await page.mouse.up()
    await page.keyboard.press('Escape')

    await select.hover()
    await expect(toolbar.getByTitle('Eraser', { exact: true })).toBeVisible()
    await expectTools(toolbar.locator(':scope > div > div > div button'), 1)
    await page.keyboard.press('Escape')

    // A value's flyout checks the one in use in the text colour, with no fill.
    await toolbar.getByTitle('1/4 Division', { exact: true }).hover()
    const rows = toolbar.locator(':scope > div > div > div button')
    await expect(rows.first()).toBeVisible()
    await expectTools(rows, 0)
    const checks = rows.locator('[data-value-check]')
    await expect(checks).toHaveCount(1)
    await expect(rows.filter({ has: page.locator('[data-value-check]') })).toHaveAttribute(
        'title',
        '1/4 Division',
    )
    expect(await checks.evaluate((check) => getComputedStyle(check).fill)).toBe(
        await systemColor(page, 'ButtonText'),
    )
    await page.keyboard.press('Escape')

    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const list = dialog.locator('section', { has: page.getByRole('heading', { name: 'Toolbar' }) })
    await expectTools(list.locator('button:not([aria-label])'), 0)
    await dialog.getByRole('button', { name: 'Add Tool' }).first().click()
    const picker = page.getByRole('dialog', { name: 'Select Tool' })
    await expect(picker).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expectTools(picker.locator('button[title]:not([aria-label])'), 0)
})

// The colour of a focused tool's innermost inset ring, if any.
const innerRing = (locator: Locator) =>
    locator.evaluate((element) => {
        const shadow = getComputedStyle(element).boxShadow
        const rings = shadow === 'none' ? [] : shadow.split(/,(?![^(]*\))/)
        return rings.at(-1)?.match(/rgba?\([^)]*\)/)?.[0]
    })

for (const colorScheme of ['light', 'dark'] as const)
    test(`focus on the tool in use is an inner ring on its fill (${colorScheme})`, async ({
        page,
    }) => {
        await page.emulateMedia({ forcedColors: 'active', colorScheme })
        const selectedText = await systemColor(page, 'HighlightText')
        const toolbar = page.locator('[data-editor-toolbar]')
        const select = toolbar
            .locator(':scope > div > div > button')
            .and(page.getByTitle('Select', { exact: true }))
        await focus(select)
        await expect.poll(() => innerRing(select)).toBe(selectedText)
        // Not in use: no inner ring.
        const undo = toolbar
            .locator(':scope > div > div > button')
            .and(page.getByTitle('Undo', { exact: true }))
        await focus(undo)
        expect(await innerRing(undo)).toBeUndefined()

        // The flyout row of the tool in use too.
        await page.keyboard.press('Escape')
        await focus(select)
        await page.keyboard.press('Enter')
        const row = toolbar
            .locator(':scope > div > div > div button')
            .and(page.getByTitle('Select', { exact: true }))
        await expect(row).toHaveAttribute('aria-pressed', 'true')
        await focus(row)
        await expect.poll(() => innerRing(row)).toBe(selectedText)
    })

const systemColor = (page: Page, name: string) =>
    page.evaluate((name) => {
        const probe = document.createElement('span')
        probe.style.color = name
        document.body.append(probe)
        const { color } = getComputedStyle(probe)
        probe.remove()
        return color
    }, name)

const fills = (locator: Locator, selector: string) =>
    locator.evaluate(
        (element, selector) =>
            [...element.querySelectorAll(selector)].map((shape) => getComputedStyle(shape).fill),
        selector,
    )

test('monochrome tool icons take the button text color', async ({ page }) => {
    // High contrast leaves SVG fills alone, so dark icons would vanish on black.
    // Fills transition, so they settle after the scheme changes.
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
    const text = await systemColor(page, 'ButtonText')
    const toolbar = page.locator('[data-editor-toolbar]')
    for (const title of ['Open', 'Undo', 'Help'])
        await expect
            .poll(() => fills(toolbar.getByTitle(title, { exact: true }), 'path'))
            .toEqual([text])

    // Note pictograms keep their colours, and the preset number stays dark on them.
    await toolbar.getByTitle('Note', { exact: true }).hover()
    const preset = toolbar.getByTitle('Note #1', { exact: true })
    await expect(preset).toBeVisible()
    expect(await fills(preset, 'rect')).not.toContain(text)
    expect(await fills(preset, 'text')).toEqual(['rgb(48, 51, 77)'])
    await page.mouse.move(0, 0)

    await page.keyboard.press(',')
    const add = page.getByRole('dialog').getByRole('button', { name: 'Add Tool' }).first()
    await expect.poll(() => fills(add, 'path')).toEqual([text])
})

for (const colorScheme of ['light', 'dark'] as const)
    test(`the generic Event icon is a ring in the button text colour (${colorScheme})`, async ({
        page,
    }) => {
        await page.emulateMedia({ forcedColors: 'active', colorScheme })
        const toolbar = page.locator('[data-editor-toolbar]')
        const event = toolbar.getByTitle('Event', { exact: true })
        const ring = () =>
            event.locator('circle').evaluate((circle) => {
                const { fill, stroke } = getComputedStyle(circle)
                return { fill, stroke }
            })
        const clear = 'rgba(0, 0, 0, 0)'
        await expect
            .poll(ring)
            .toEqual({ fill: clear, stroke: await systemColor(page, 'ButtonText') })

        // In use, it takes the selected text colour.
        await page.evaluate(async () => {
            const { switchToolTo } = await import('/src/editor/tools/index.ts')
            switchToolTo('cameraEvent')
            await window.editorTest.nextTick()
        })
        await expect(event).toHaveAttribute('aria-pressed', 'true')
        await expect
            .poll(ring)
            .toEqual({ fill: clear, stroke: await systemColor(page, 'HighlightText') })

        // Outside high contrast it stays a white disc.
        await page.emulateMedia({ forcedColors: 'none' })
        await expect.poll(async () => (await ring()).fill).toBe('rgb(255, 255, 255)')
    })

test('the BPM and Time Scale tools keep their chip colours', async ({ page }) => {
    // The colour names the tool, as on the chart.
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
    const toolbar = page.locator('[data-editor-toolbar]')
    const chip = (title: string) =>
        toolbar
            .getByTitle(title, { exact: true })
            .locator('.rounded-sm')
            .evaluate((element) => {
                const { backgroundColor, color } = getComputedStyle(element)
                return { backgroundColor, color }
            })
    expect(await chip('BPM')).toEqual({
        backgroundColor: 'rgb(255, 0, 255)',
        color: 'rgb(48, 51, 77)',
    })
    await toolbar.getByTitle('BPM', { exact: true }).hover()
    await expect(toolbar.getByTitle('Time Scale', { exact: true })).toBeVisible()
    expect(await chip('Time Scale')).toEqual({
        backgroundColor: 'rgb(255, 255, 0)',
        color: 'rgb(48, 51, 77)',
    })
})

for (const colorScheme of ['light', 'dark'] as const)
    test(`chart panes keep their dark background (${colorScheme})`, async ({ page }) => {
        // The canvases draw white grids, labels and selection boxes for it.
        await page.emulateMedia({ forcedColors: 'active', colorScheme })
        const backdrop = (selector: string) =>
            page
                .locator(selector)
                .evaluate((element) => getComputedStyle(element, '::before').backgroundColor)
        const bg = 'rgb(64, 68, 100)'
        expect(await backdrop('.chart-pane:has(canvas.editor-chart)')).toBe(bg)
        // The time and beat labels on it stay light.
        const label = page.locator('.chart-pane > div:first-of-type span').first()
        await expect(label).toBeVisible()
        expect(await label.evaluate((element) => getComputedStyle(element).color)).toBe(
            'rgba(255, 255, 255, 0.7)',
        )
        await page.evaluate(async () => {
            const { commands } = await import('/src/editor/commands/index.ts')
            await commands.elevation.execute()
        })
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        expect(await backdrop('.elevation-editor')).toBe(bg)
    })

test('raised buttons and segment tracks keep their edge, as fields do', async ({ page }) => {
    const text = await systemColor(page, 'CanvasText')
    const expectEdges = async (locator: Locator) => {
        await expect(locator.first()).toBeVisible()
        const edges = await locator.evaluateAll((elements) =>
            elements.map((element) => {
                const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(element)
                return { style: outlineStyle, width: outlineWidth, color: outlineColor }
            }),
        )
        for (const edge of edges)
            expect(edge).toEqual({ style: 'solid', width: '2px', color: text })
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expectEdges(panel(page).locator('.form-field-mixed-value'))
    await expectEdges(panel(page).getByRole('radiogroup', { name: 'Snapping', exact: true }))

    await page.locator('.panel-tab', { hasText: 'Preview' }).click()
    await expectEdges(page.locator('.transport-button'))
    await expectEdges(page.locator('.preview-settings-toggle'))
    await expectEdges(page.getByRole('radiogroup', { name: 'Aspect ratio' }))

    await page.locator('.panel-tab', { hasText: 'Groups' }).click()
    await expectEdges(page.locator('.manager-add, .manager-new-folder'))
    // The selection bar's pill and round buttons.
    const groups = page.locator('#workspace-panel-groups')
    await groups.getByRole('button', { name: 'Select Multiple' }).click()
    await groups.locator('.manager-check').first().click()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expectEdges(groups.locator('.manager-selection-done, .manager-round'))
    await page.keyboard.press('Escape')

    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expectEdges(dialog.getByRole('button', { name: /^(Reset Settings|Reset Shortcuts)$/ }))
})

test('side-by-side dialog buttons keep a gap between their edges', async ({ page }) => {
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The painted edge: the box grown by the outline's offset and width.
    const edge = (name: string) =>
        dialog.getByRole('button', { name, exact: true }).evaluate((button) => {
            const { left, right } = button.getBoundingClientRect()
            const { outlineWidth, outlineOffset } = getComputedStyle(button)
            const grow = parseFloat(outlineWidth) + parseFloat(outlineOffset)
            return { left: left - grow, right: right + grow }
        })
    const settings = await edge('Reset Settings')
    const shortcuts = await edge('Reset Shortcuts')
    expect(shortcuts.left - settings.right).toBeGreaterThanOrEqual(6)
})
