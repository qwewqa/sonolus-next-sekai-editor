import { expect, test, type Locator, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

// Selects open the shared list (customizable select) on fine pointers, kept to
// the rules of a system list.

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
})

test.afterEach(({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const field = (scope: Page | Locator, name: string) =>
    scope.getByRole('combobox', { name, exact: true }).first()
// The value the field draws over the select.
const valueOf = (select: Locator) => select.locator('xpath=..').locator('.select-value')
const isOpen = (select: Locator) => select.evaluate((element) => element.matches(':open'))
const appearance = (select: Locator) =>
    select.evaluate((element) => getComputedStyle(element).appearance)

const boot = async (page: Page, settings: Record<string, unknown> = {}) => {
    await page.addInitScript(installCanvasCounters)
    await page.addInitScript((values) => {
        for (const [key, value] of Object.entries(values))
            localStorage.setItem(`sonolus-next-sekai-editor.${key}`, JSON.stringify(value))
    }, settings)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { history, fixtures } = window.editorTest
        const chart = structuredClone(fixtures.interaction)
        const styles = ['purple', 'default', 'red', 'cyan'] as const
        chart.slides = chart.slides.map(([head], index) => [
            { ...head!, noteStyle: styles[index]! },
            { ...head!, beat: head!.beat + 1, noteStyle: styles[index]! },
        ])
        history.resetState(false, chart, 0, 'lists.json')
    })
}

const selectNotes = (page: Page, indices: number[]) =>
    page.evaluate(async (indices) => {
        const { history, store } = window.editorTest
        const notes = [...store.getAllEntities()]
            .filter((entity) => entity.type === 'note')
            .sort((a, b) => a.beat - b.beat)
        history.replaceState({
            ...history.state.value,
            selectedEntities: indices.map((index) => notes[index]!),
        })
        await window.editorTest.nextTick()
    }, indices)

const noteStyles = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities.map((entity) =>
            entity.type === 'note' ? entity.noteStyle : undefined,
        ),
    )

const toolName = (page: Page) =>
    page.evaluate(async () => {
        const { toolName } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools/state')
        >('/src/editor/tools/state.ts')
        return toolName.value
    })

const sidebar = { showSidebar: true, showPreview: false }

test.describe('on a fine pointer', () => {
    test.beforeEach(async ({ page }) => {
        await boot(page, sidebar)
        await selectNotes(page, [0])
    })

    test('a select opens the shared list, with menu rows and a check on the current value', async ({
        page,
    }) => {
        const select = field(panel(page), 'Note Color')
        expect(await appearance(select)).toBe('base-select')
        await select.click()
        expect(await isOpen(select)).toBe(true)
        // Rows as menus have them, above the panel and the chart.
        const row = select.getByRole('option', { name: 'Red', exact: true })
        expect((await row.boundingBox())!.height).toBe(36)
        const box = (await row.boundingBox())!
        expect(
            await page.evaluate(
                ({ x, y }) => document.elementFromPoint(x, y)?.closest('option')?.textContent,
                { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            ),
        ).toContain('Red')
        const check = (name: string) =>
            select
                .getByRole('option', { name, exact: true })
                .evaluate((option) => getComputedStyle(option, '::checkmark').visibility)
        expect(await check('Purple')).toBe('visible')
        expect(await check('Red')).toBe('hidden')
        // The surface's edge is an outline, as menus' are.
        expect(
            await select.evaluate((element) => {
                const { outlineStyle, outlineWidth } = getComputedStyle(element, '::picker(select)')
                return { outlineStyle, outlineWidth }
            }),
        ).toEqual({ outlineStyle: 'solid', outlineWidth: '1px' })
        await page.keyboard.press('Escape')
        expect(await isOpen(select)).toBe(false)
        await expect(select).toBeFocused()
    })

    test('Mixed and Unknown are never rows', async ({ page }) => {
        await selectNotes(page, [0, 2])
        const select = field(panel(page), 'Note Color')
        await select.click()
        const rows = await select.evaluate((element) =>
            [...element.querySelectorAll('option')]
                .filter((option) => option.getBoundingClientRect().height > 0)
                .map((option) => option.textContent.trim()),
        )
        expect(rows).not.toContain('Mixed')
        expect(rows).toContain('Purple · 1')
        expect(rows.every((row) => row !== '')).toBe(true)
    })

    test('the field draws its value, truncating as a system select does', async ({ page }) => {
        const select = field(panel(page), 'Note Color')
        const value = valueOf(select)
        await expect(value).toHaveText('Purple')
        await expect(value).toBeVisible()
        expect(await select.evaluate((element) => getComputedStyle(element).color)).toBe(
            'rgba(0, 0, 0, 0)',
        )
        expect(
            await value
                .locator('span')
                .evaluate((element) => getComputedStyle(element).textOverflow),
        ).toBe('ellipsis')
        // The select keeps its hover title.
        await expect(select).toHaveAttribute('title', 'Purple')
    })

    test('the data-native-lists switch turns the shared list off', async ({ page }) => {
        const select = field(panel(page), 'Note Color')
        await page.evaluate(() => document.documentElement.setAttribute('data-native-lists', ''))
        expect(await appearance(select)).toBe('none')
        await expect(valueOf(select)).toBeHidden()
        await expect
            .poll(() => select.evaluate((element) => getComputedStyle(element).color))
            .toBe('rgb(68, 68, 102)')
    })

    test('closed arrows step the value, one change and one undo each', async ({ page }) => {
        const select = field(panel(page), 'Note Color')
        await select.focus()
        await page.keyboard.press('ArrowDown')
        expect(await isOpen(select)).toBe(false)
        await expect.poll(() => noteStyles(page)).toEqual(['cyan'])
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => noteStyles(page)).toEqual(['black'])
        // The last stays.
        await page.keyboard.press('ArrowDown')
        await expect.poll(() => noteStyles(page)).toEqual(['black'])
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowUp')
        await expect.poll(() => noteStyles(page)).toEqual(['purple'])
        await page.keyboard.press('Home')
        await expect.poll(() => noteStyles(page)).toEqual(['default'])
        await page.keyboard.press('End')
        await expect.poll(() => noteStyles(page)).toEqual(['black'])
        expect(await isOpen(select)).toBe(false)
        // Each step is its own undo.
        const undo = () =>
            page.evaluate(async () => {
                window.editorTest.history.undoState()
                await window.editorTest.nextTick()
            })
        for (const style of ['default', 'purple', 'cyan', 'black', 'cyan', 'purple']) {
            await undo()
            await selectNotes(page, [0])
            expect(await noteStyles(page)).toEqual([style])
        }
        // Alt+Down still opens the list.
        await select.focus()
        await page.keyboard.press('Alt+ArrowDown')
        expect(await isOpen(select)).toBe(true)
    })

    test('stepping from Mixed starts at the first value', async ({ page }) => {
        await selectNotes(page, [0, 2])
        const select = field(panel(page), 'Note Color')
        await select.focus()
        const mixed = await noteStyles(page)
        expect(new Set(mixed).size).toBe(2)
        // Nothing comes before Mixed, as in a system select.
        await page.keyboard.press('ArrowUp')
        expect(await noteStyles(page)).toEqual(mixed)
        await page.keyboard.press('ArrowDown')
        await expect.poll(() => noteStyles(page)).toEqual(['default', 'default'])
    })

    test('an open list holds editor shortcuts, chords included', async ({ page }) => {
        // An edit to undo.
        const select = field(panel(page), 'Note Color')
        await select.selectOption({ label: 'Red' })
        const before = await toolName(page)
        await select.click()
        expect(await isOpen(select)).toBe(true)
        await page.keyboard.press('g')
        await page.keyboard.press('ControlOrMeta+z')
        expect(await toolName(page)).toBe(before)
        expect(await noteStyles(page)).toEqual(['red'])
        expect(await isOpen(select)).toBe(true)
        // Closed again, the field takes the chord as before.
        await page.keyboard.press('Escape')
        await page.keyboard.press('ControlOrMeta+z')
        await selectNotes(page, [0])
        expect(await noteStyles(page)).toEqual(['purple'])
    })

    test('a press outside an open list only closes it', async ({ page }) => {
        const select = field(panel(page), 'Note Color')
        await select.click()
        expect(await isOpen(select)).toBe(true)
        // Empty chart space would otherwise clear the selection.
        const point = await page.evaluate(() => window.editorTest.point(5.5, 1))
        await page.mouse.click(point.x, point.y)
        expect(await isOpen(select)).toBe(false)
        expect(await noteStyles(page)).toEqual(['purple'])
        // The next press is the user's own.
        await page.mouse.click(point.x, point.y)
        expect(await noteStyles(page)).toEqual([])
    })
})

test('an open list keeps chords from the browser too, as a system one does', async ({ page }) => {
    // Registered before the app, so it sees each key first.
    await page.addInitScript(() => {
        const seen: boolean[] = []
        ;(window as unknown as { seen: boolean[] }).seen = seen
        window.addEventListener(
            'keydown',
            (event) => setTimeout(() => seen.push(event.defaultPrevented)),
            true,
        )
    })
    await boot(page, sidebar)
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.click()
    await page.evaluate(() => ((window as unknown as { seen: boolean[] }).seen.length = 0))
    // A chord no shortcut takes, so only the hold keeps it from the browser.
    await page.keyboard.press('ControlOrMeta+l')
    await expect
        .poll(() => page.evaluate(() => (window as unknown as { seen: boolean[] }).seen))
        // Control alone, then the chord.
        .toEqual([false, true])
})

test('in a tool dialog, an open list holds keys and its own Escape', async ({ page }) => {
    await boot(page, { showSidebar: false, showPreview: false })
    await page.keyboard.press('a')
    await page.keyboard.press('a')
    const dialog = page.locator('.editor-tool-modal')
    await expect(dialog).toHaveCount(1)
    const select = field(dialog, 'Note Color')
    await select.click()
    expect(await isOpen(select)).toBe(true)
    const before = await toolName(page)
    await page.keyboard.press('g')
    expect(await toolName(page)).toBe(before)
    await expect(dialog).toHaveCount(1)
    // Escape closes the list alone, then the dialog.
    await page.keyboard.press('Escape')
    expect(await isOpen(select)).toBe(false)
    await expect(dialog).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('Escape in an open list leaves the elevation editor open', async ({ page }) => {
    await boot(page, sidebar)
    await page.evaluate(async () => {
        const { commands } = await window.editorTest.appImport<
            typeof import('../../src/editor/commands')
        >('/src/editor/commands/index.ts')
        void commands.elevation.execute()
    })
    const snap = page.getByRole('combobox', { name: 'Elevation Snapping', exact: true })
    await expect(snap).toBeVisible()
    await snap.click()
    expect(await isOpen(snap)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isOpen(snap)).toBe(false)
    await expect(snap).toBeVisible()
    // The header's own select draws its value too.
    await expect(page.locator('.elevation-select .select-value')).toHaveText(
        await snap.evaluate((element: HTMLSelectElement) =>
            element.selectedOptions[0]!.textContent.trim(),
        ),
    )
})

test('Escape in an open list leaves the Settings dialog open', async ({ page }) => {
    await boot(page, sidebar)
    await page.evaluate(async () => {
        const { commands } = await window.editorTest.appImport<
            typeof import('../../src/editor/commands')
        >('/src/editor/commands/index.ts')
        void commands.settings.execute()
    })
    const dialog = page.locator('dialog[open]')
    const select = dialog.getByRole('combobox').first()
    await select.click()
    expect(await isOpen(select)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isOpen(select)).toBe(false)
    await expect(dialog).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('Escape in an open list leaves a phone drawer open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await boot(page, {
        ...sidebar,
        propertiesPosition: 'right',
        panelRecency: ['properties', 'groups', 'preview', 'stages'],
    })
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.scrollIntoViewIfNeeded()
    await select.click()
    expect(await isOpen(select)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isOpen(select)).toBe(false)
    await expect(select).toBeVisible()
})

test('a closed step reaches the page after its key, as a system one does', async ({ page }) => {
    await boot(page, { showSidebar: false, showPreview: true, previewPosition: 'top' })
    await page
        .locator('.preview')
        .getByRole('button', { name: 'Show Preview Settings', exact: true })
        .click()
    const select = page.getByRole('combobox', { name: 'Playback Controls', exact: true })
    // A pointer opens the list; Escape closes it, held from the page like any key.
    await select.click()
    expect(await isOpen(select)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await isOpen(select)).toBe(false)
    // The panel takes the arrow as a key before the step, so the step keeps focus
    // for the next, as after a pointer it would not.
    const before = await select.inputValue()
    await page.keyboard.press('ArrowDown')
    await expect(select).not.toHaveValue(before)
    await expect(select).toBeFocused()
})

// A bare select counting its changes; it can hide an option without disabling it.
const addSelect = (page: Page, options: string) =>
    page.evaluate((options) => {
        const select = document.createElement('select')
        select.id = 'probe'
        select.innerHTML = options
        ;(window as unknown as { changes: number }).changes = 0
        select.addEventListener(
            'change',
            () => (window as unknown as { changes: number }).changes++,
        )
        document.body.append(select)
        select.focus()
    }, options)
const changes = (page: Page) =>
    page.evaluate(() => (window as unknown as { changes: number }).changes)

test('a closed step skips hidden options, as a system one does', async ({ page }) => {
    await boot(page, sidebar)
    await addSelect(page, '<option hidden>x</option><option selected>a</option><option>b</option>')
    const select = page.locator('#probe')
    expect(await appearance(select)).toBe('base-select')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    await expect(select).toHaveValue('b')
    await page.keyboard.press('Home')
    await expect(select).toHaveValue('a')
    // Nothing before the first shown option.
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    await expect(select).toHaveValue('b')
})

test('Home and End on the end value fire no change', async ({ page }) => {
    await boot(page, sidebar)
    await addSelect(page, '<option selected>a</option><option>b</option>')
    const select = page.locator('#probe')
    await page.keyboard.press('Home')
    await page.keyboard.press('End')
    await expect(select).toHaveValue('b')
    await page.keyboard.press('End')
    await page.keyboard.press('Home')
    await expect(select).toHaveValue('a')
    // A later step settles the earlier ones.
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await expect(select).toHaveValue('b')
    expect(await changes(page)).toBe(3)
})

test('a double click whose first press only closed a list never resets a dock', async ({
    page,
}) => {
    await boot(page, { ...sidebar, rightDockWidth: 420 })
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.click()
    expect(await isOpen(select)).toBe(true)
    const handle = page.getByRole('separator', { name: 'Resize Right Panels' })
    const box = (await handle.boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    expect(await isOpen(select)).toBe(false)
    await page.evaluate(() => window.editorTest.nextTick())
    expect(await page.evaluate(() => window.editorTest.settings.rightDockWidth)).toBe(420)
})

test('a key click right after a press that closed a list still lands', async ({ page }) => {
    await boot(page, sidebar)
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.click()
    expect(await isOpen(select)).toBe(true)
    const point = await page.evaluate(() => window.editorTest.point(5.5, 1))
    await page.mouse.click(point.x, point.y)
    expect(await isOpen(select)).toBe(false)
    // Within the swallowed press's trail.
    await page.evaluate(() => {
        const button = document.createElement('button')
        button.id = 'probe'
        ;(window as unknown as { clicks: number }).clicks = 0
        button.addEventListener('click', () => (window as unknown as { clicks: number }).clicks++)
        document.body.append(button)
        button.focus()
    })
    await page.keyboard.press('Space')
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(1)
})

test('Apple platforms open the list on arrows, as their system selects do', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
        Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
    })
    await boot(page, sidebar)
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.focus()
    await page.keyboard.press('ArrowDown')
    expect(await isOpen(select)).toBe(true)
    expect(await noteStyles(page)).toEqual(['purple'])
})

test('Apple platforms step on arrows where a script cannot open the list', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
        Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
        // As in WebKit.
        delete (HTMLSelectElement.prototype as Partial<HTMLSelectElement>).showPicker
    })
    await boot(page, sidebar)
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    await select.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => noteStyles(page)).toEqual(['cyan'])
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => noteStyles(page)).toEqual(['black'])
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => noteStyles(page)).toEqual(['cyan'])
    expect(await isOpen(select)).toBe(false)
    // Other keys stay with the browser, as on a Mac system select.
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)))
    expect(await noteStyles(page)).toEqual(['cyan'])
    // Each step is its own undo.
    for (const style of ['black', 'cyan', 'purple']) {
        await page.evaluate(async () => {
            window.editorTest.history.undoState()
            await window.editorTest.nextTick()
        })
        await selectNotes(page, [0])
        expect(await noteStyles(page)).toEqual([style])
    }
})

test('high contrast keeps the list edge, the check and one copy of the value', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await boot(page, sidebar)
    await selectNotes(page, [0])
    const select = field(panel(page), 'Note Color')
    // The select's own value stays hidden under the field's.
    expect(
        await select.evaluate((element) => {
            const { color, forcedColorAdjust } = getComputedStyle(element)
            return { color, forcedColorAdjust }
        }),
    ).toEqual({ color: 'rgba(0, 0, 0, 0)', forcedColorAdjust: 'none' })
    await expect(valueOf(select)).toBeVisible()
    // Focused, it shows the outline other fields get.
    const focusOutline = () =>
        page.evaluate(() => {
            const { outlineStyle, outlineColor } = getComputedStyle(document.activeElement!)
            return { outlineStyle, outlineColor }
        })
    await panel(page).getByLabel('Lane', { exact: true }).focus()
    const input = await focusOutline()
    await select.focus()
    expect(await focusOutline()).toEqual(input)
    expect(input.outlineStyle).toBe('solid')
    await select.click()
    const picker = await select.evaluate((element) => {
        const style = getComputedStyle(element, '::picker(select)')
        return { outline: style.outlineStyle, background: style.backgroundColor }
    })
    expect(picker.outline).toBe('solid')
    const check = await select
        .getByRole('option', { name: 'Purple', exact: true })
        .evaluate((option) => {
            const style = getComputedStyle(option, '::checkmark')
            return { visibility: style.visibility, background: style.backgroundColor }
        })
    expect(check.visibility).toBe('visible')
    expect(check.background).not.toBe(picker.background)
    expect(check.background).not.toBe('rgba(0, 0, 0, 0)')
})

test.describe('on a touch screen', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('selects keep the system picker and draw their own value', async ({ page }) => {
        await boot(page, {
            ...sidebar,
            propertiesPosition: 'right',
            panelRecency: ['properties', 'groups', 'preview', 'stages'],
        })
        await selectNotes(page, [0])
        const select = field(panel(page), 'Note Color')
        expect(await appearance(select)).toBe('none')
        await expect(valueOf(select)).toBeHidden()
        await expect
            .poll(() => select.evaluate((element) => getComputedStyle(element).color))
            .toBe('rgb(68, 68, 102)')
    })
})

// Pixels that differ between two screenshots of the same size.
const changedPixels = (page: Page, a: Buffer, b: Buffer) =>
    page.evaluate(
        async ([a, b]) => {
            const load = async (data: string) => {
                const image = new Image()
                image.src = `data:image/png;base64,${data}`
                await image.decode()
                const canvas = document.createElement('canvas')
                canvas.width = image.width
                canvas.height = image.height
                const context = canvas.getContext('2d')!
                context.drawImage(image, 0, 0)
                return context.getImageData(0, 0, image.width, image.height)
            }
            const [x, y] = await Promise.all([load(a), load(b)])
            if (x.width !== y.width || x.height !== y.height) return Infinity
            let count = 0
            for (let i = 0; i < x.data.length; i += 4) {
                const difference =
                    Math.abs(x.data[i]! - y.data[i]!) +
                    Math.abs(x.data[i + 1]! - y.data[i + 1]!) +
                    Math.abs(x.data[i + 2]! - y.data[i + 2]!)
                if (difference > 24) count++
            }
            return count
        },
        [a.toString('base64'), b.toString('base64')] as const,
    )

// Shoots with the shared list on, then off.
const bothWays = async (page: Page, shoot: () => Promise<Buffer>) => {
    await page.mouse.move(0, 0)
    // Past fitting and fades.
    await page.waitForTimeout(300)
    const shared = await shoot()
    await page.evaluate(() => document.documentElement.setAttribute('data-native-lists', ''))
    // Past the selects' colour transition.
    await page.waitForTimeout(300)
    const native = await shoot()
    return changedPixels(page, shared, native)
}

for (const [name, settings] of [
    ['the default dock', {}],
    ['a 260 dock in French', { rightDockWidth: 260, locale: 'fr' }],
    ['Japanese', { locale: 'ja' }],
] as const)
    test(`closed fields look the same with either list, at ${name}`, async ({ page }) => {
        await boot(page, { ...sidebar, propertiesConnectorExpanded: true, ...settings })
        await selectNotes(page, [0, 1, 2])
        // A glyph edge may land a subpixel apart; a shifted value would change hundreds.
        expect(await bothWays(page, () => panel(page).screenshot())).toBeLessThanOrEqual(8)
    })

test('the elevation header select looks the same with either list', async ({ page }) => {
    await boot(page, sidebar)
    await page.evaluate(async () => {
        const { commands } = await window.editorTest.appImport<
            typeof import('../../src/editor/commands')
        >('/src/editor/commands/index.ts')
        void commands.elevation.execute()
    })
    const header = page.locator('.elevation-select')
    await expect(header).toBeVisible()
    expect(await bothWays(page, () => header.screenshot())).toBe(0)
})
