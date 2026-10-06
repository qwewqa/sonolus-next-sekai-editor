import { expect, test } from '@playwright/test'
import { installCanvasCounters } from './editorFixture'

test('Help marks each tool section with its toolbar icon', async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const dialog = page.locator('dialog[open]')
    const headings = dialog.getByRole('heading', { level: 2 })
    await expect(headings.first()).toBeVisible()

    const icons = await headings.evaluateAll((elements) =>
        elements.map((heading) => [
            [...heading.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join('')
                .trim(),
            heading.querySelector(':scope > [aria-hidden="true"] > *') !== null,
        ]),
    )
    const iconed = icons.filter(([, icon]) => icon).map(([title]) => title)
    expect(iconed).toEqual([
        'Select Tool',
        'Eraser Tool',
        'Brush Tool',
        'Paste Tool',
        'Note Tool',
        'Slide Tool',
        'Split Slide',
        'Generate Slide Notes Tool',
        'BPM Tool',
        'Time Scale Tool',
        'Camera Event Tool',
        'Stage Mask Event Tool',
        'Stage Pivot Event Tool',
        'Stage Style Event Tool',
        'Stage Transform Event Tool',
    ])
    // Wide glyphs such as BPM fit the chip, so every iconed title starts at one edge.
    const starts = await headings.evaluateAll((elements) =>
        elements
            .filter((heading) => heading.querySelector(':scope > [aria-hidden="true"]'))
            .map((heading) => {
                const range = document.createRange()
                range.selectNodeContents(heading.lastChild!)
                return range.getBoundingClientRect().left
            }),
    )
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(0.5)
    // Input sections have no single tool.
    expect(icons.slice(0, 3).every(([, icon]) => !icon)).toBe(true)
    // The icon is decorative; the heading keeps its name.
    await expect(dialog.getByRole('heading', { name: 'BPM Tool', exact: true })).toBeVisible()
})
