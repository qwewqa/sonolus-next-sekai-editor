import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })
const selected = (page: Page) =>
    page.evaluate(() =>
        window.editorTest.history.state.value.selectedEntities
            .filter((entity) => entity.type === 'note')
            .map((note) => `${note.noteStyle}:${note.beat}`),
    )
const point = async (page: Page) => {
    const local = await page.evaluate(async () => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const row = elevationLayout.value.rows.find((row) => row.note.noteStyle === 'red')!
        return { x: row.x, y: row.y }
    })
    const box = (await page.locator('.elevation-canvas').boundingBox())!
    return { x: box.x + local.x, y: box.y + local.y }
}
const click = async (page: Page, modifier?: 'Control' | 'Shift' | 'Control+Shift') => {
    const at = await point(page)
    const keys = modifier?.split('+') ?? []
    for (const key of keys) await page.keyboard.down(key)
    await page.mouse.click(at.x, at.y)
    for (const key of keys.reverse()) await page.keyboard.up(key)
    await settle(page)
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, settings, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const group2 = 2 as typeof base.groupId
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                groups: new Map([
                    [base.groupId, { name: 'First' }],
                    [group2, { name: 'Second' }],
                ]),
                slides: [
                    ...(['red', 'green', 'blue'] as const).map((style) => [
                        {
                            ...base,
                            beat: 3,
                            left: 0,
                            size: 2,
                            elevation: 2,
                            noteStyle: style,
                            groupId: style === 'blue' ? group2 : base.groupId,
                        },
                        {
                            ...base,
                            beat: 5,
                            left: 2,
                            size: 2,
                            elevation: 4,
                            noteStyle: style,
                            groupId: style === 'blue' ? group2 : base.groupId,
                        },
                    ]),
                    [{ ...base, beat: 3, left: 6, size: 2, elevation: 5, noteStyle: 'purple' }],
                ],
            },
            3,
        )
        settings.showSidebar = false
        settings.showPreview = false
        settings.elevationEditorSideBySide = 'disallow'
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('select')
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await settle(page)
})

for (const tool of ['select', 'elevation'] as const) {
    test(`${tool} cycles three overlapping styles and wraps in stable geometry order`, async ({
        page,
    }) => {
        await page.evaluate(async (tool) => {
            const { switchToolTo } = await window.editorTest.appImport<
                typeof import('../../src/editor/tools')
            >('/src/editor/tools/index.ts')
            switchToolTo(tool)
        }, tool)
        for (const style of ['red', 'green', 'blue', 'red', 'green']) {
            await click(page)
            expect(await selected(page)).toEqual([`${style}:3`])
        }
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}

test('Ctrl toggles every overlap, completes partial selection, and preserves unrelated notes', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()]
                .flat()
                .filter((note) => note.beat === 3 && ['purple', 'green'].includes(note.noteStyle)),
        })
    })
    await click(page, 'Control')
    expect((await selected(page)).sort()).toEqual(['blue:3', 'green:3', 'purple:3', 'red:3'])
    await click(page, 'Control')
    expect(await selected(page)).toEqual(['purple:3'])
    await click(page, 'Control')
    expect((await selected(page)).sort()).toEqual(['blue:3', 'green:3', 'purple:3', 'red:3'])
})

test('Shift expands the cycled target slide and Ctrl+Shift toggles all expanded overlaps', async ({
    page,
}) => {
    await click(page, 'Shift')
    expect((await selected(page)).sort()).toEqual(['red:3', 'red:5'])
    await click(page, 'Shift')
    expect((await selected(page)).sort()).toEqual(['green:3', 'green:5'])
    await click(page, 'Control+Shift')
    expect((await selected(page)).sort()).toEqual([
        'blue:3',
        'blue:5',
        'green:3',
        'green:5',
        'red:3',
        'red:5',
    ])
    await click(page, 'Control+Shift')
    expect(await selected(page)).toEqual([])
})

test('hidden and dimmed overlap rows never enter the cycle or Ctrl target set', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { view } = window.editorTest
        view.groupVisibility = new Map([[2 as NonNullable<typeof view.groupId>, 'hidden']])
    })
    for (const style of ['red', 'green', 'red']) {
        await click(page)
        expect(await selected(page)).toEqual([`${style}:3`])
    }
    await page.evaluate(() => {
        const { view, settings } = window.editorTest
        view.groupVisibility = new Map()
        view.groupId = 1 as NonNullable<typeof view.groupId>
        settings.showOtherGroups = true
    })
    await click(page, 'Control')
    expect((await selected(page)).sort()).toEqual(['green:3', 'red:3'])
})

test('dragging after a cycle moves the selected overlap without cycling on press', async ({
    page,
}) => {
    await click(page)
    await click(page)
    expect(await selected(page)).toEqual(['green:3'])
    const before = await page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()]
            .flat()
            .map((note) => ({
                style: note.noteStyle,
                beat: note.beat,
                elevation: note.elevation,
                left: note.left,
            })),
    )
    const at = await point(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    expect(await selected(page)).toEqual(['green:3'])
    const delta = await page.evaluate(async () => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        return elevationLayout.value.yAt(3) - elevationLayout.value.yAt(2)
    })
    await page.mouse.move(at.x, at.y + delta, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    expect(await selected(page)).toEqual(['green:3'])
    const after = await page.evaluate(() =>
        [...window.editorTest.history.state.value.store.slides.note.values()]
            .flat()
            .map((note) => ({
                style: note.noteStyle,
                beat: note.beat,
                elevation: note.elevation,
                left: note.left,
            })),
    )
    const moved = after.find((note) => note.style === 'green' && note.beat === 3)!
    expect(moved.elevation).toBe(3)
    for (const note of before.filter((note) => note.style !== 'green' || note.beat !== 3))
        expect(after).toContainEqual(note)
})

test('a visible read-only attachment participates in cycling but cannot be dragged', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { fixtures, show, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [{ ...base, beat: 3, left: 0, size: 2, elevation: 2, noteStyle: 'red' }],
                    [
                        { ...base, beat: 2, left: 0, size: 2, elevation: 0, noteStyle: 'purple' },
                        {
                            ...base,
                            beat: 3,
                            left: 0,
                            size: 2,
                            elevation: 9,
                            noteStyle: 'purple',
                            isAttached: true,
                        },
                        { ...base, beat: 4, left: 0, size: 2, elevation: 4, noteStyle: 'purple' },
                    ],
                ],
            },
            3,
        )
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
        const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
            '/src/editor/tools/index.ts',
        )
        switchToolTo('select')
    })
    await settle(page)
    await click(page)
    expect(await selected(page)).toEqual(['red:3'])
    await click(page)
    expect(await selected(page)).toEqual(['purple:3'])
    const before = await page.evaluate(() => window.editorTest.snapshot().notes)
    const at = await point(page)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 50, at.y - 40, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.snapshot().notes)).toEqual(before)
    expect(await selected(page)).toEqual(['purple:3'])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('Note Shift click expands its target before preserving selected-target quick edit', async ({
    page,
}) => {
    await page.evaluate(async () => {
        const { switchToolTo } = await window.editorTest.appImport<
            typeof import('../../src/editor/tools')
        >('/src/editor/tools/index.ts')
        switchToolTo('note')
    })
    await click(page)
    expect(await selected(page)).toEqual(['red:3'])
    await click(page, 'Shift')
    expect((await selected(page)).sort()).toEqual(['red:3', 'red:5'])
    await expect(page.locator('[data-tool-dialog]')).toHaveCount(0)
    await click(page, 'Shift')
    await expect(page.locator('[data-tool-dialog]')).toBeVisible()
    expect((await selected(page)).sort()).toEqual(['red:3', 'red:5'])
})
