import { expect, test, type Page } from '@playwright/test'
import type { ToolName } from '../../src/editor/tools'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, view, settings, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const otherGroup = (base.groupId + 100) as typeof base.groupId
        show({
            ...fixtures.interaction,
            groups: new Map([
                ...fixtures.interaction.groups,
                [otherGroup, { name: 'Outside focused group' }],
            ]),
            slides: [
                [
                    { ...base, beat: 6, left: -5, size: 2, elevation: 0 },
                    { ...base, beat: 8, left: -5, size: 2, elevation: 0 },
                ],
                [
                    { ...base, beat: 6, left: 0, size: 2, elevation: 0 },
                    { ...base, beat: 6, left: 3, size: 2, elevation: 3 },
                    {
                        ...base,
                        beat: 6,
                        left: 5,
                        size: 2,
                        elevation: 5,
                        groupId: otherGroup,
                    },
                    { ...base, beat: 8, left: 3, size: 2, elevation: 3 },
                ],
            ],
        })
        view.groupId = base.groupId
        view.division = 1
        settings.elevationEditorSideBySide = 'disallow'
        settings.maxLane = 0
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(6)
    })
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await settle(page)
})

const configure = async (page: Page, tool: ToolName, selectedLeft?: number) => {
    await page.evaluate(
        async ({ tool, selectedLeft }) => {
            const { appImport, history } = window.editorTest
            const { switchToolTo } = await appImport<typeof import('../../src/editor/tools')>(
                '/src/editor/tools/index.ts',
            )
            switchToolTo(tool)
            const notes = [...history.state.value.store.slides.note.values()].flat()
            history.replaceState({
                ...history.state.value,
                selectedEntities: notes.filter(
                    (note) => note.left === selectedLeft && note.beat === 6,
                ),
            })
            const { brushProperties } = await appImport<
                typeof import('../../src/editor/tools/brush')
            >('/src/editor/tools/brush/index.ts')
            brushProperties.value = { isCritical: true }
        },
        { tool, selectedLeft },
    )
    await settle(page)
}

const snapshot = (page: Page) =>
    page.evaluate(() => {
        const { history } = window.editorTest
        const summary = (note: (typeof history.state.value.selectedEntities)[number]) => {
            if (note.type !== 'note') throw new Error('Expected note')
            return {
                beat: note.beat,
                left: note.left,
                elevation: note.elevation,
                critical: note.isCritical,
                attached: note.isAttached,
            }
        }
        return {
            slides: [...history.state.value.store.slides.note.values()].map((notes) =>
                notes.map(summary),
            ),
            selected: history.state.value.selectedEntities.map(summary),
            undo: history.canUndo.value,
        }
    })

const target = async (page: Page) => {
    const row = await page.evaluate(async () => {
        const scene = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const row = scene.elevationLayout.value.rows.find((row) => row.note.left === 0)
        if (!row) throw new Error('Missing target')
        return { x: row.x, y: row.y, w: row.w }
    })
    const box = await page.locator('.elevation-canvas').boundingBox()
    if (!box) throw new Error('Missing canvas')
    return { x: box.x + row.x, y: box.y + row.y, w: row.w }
}

const gesture = async (page: Page, kind: 'tap' | 'box', modifier: 'Control' | 'Shift') => {
    const row = await target(page)
    await page.keyboard.down(modifier)
    if (kind === 'tap') await page.mouse.click(row.x, row.y)
    else {
        await page.mouse.move(row.x - row.w / 2 - 10, row.y - 30)
        await page.mouse.down()
        await page.mouse.move(row.x + row.w / 2 + 10, row.y + 30, { steps: 5 })
        await page.mouse.up()
    }
    await page.keyboard.up(modifier)
    await settle(page)
}

const undoOne = async (page: Page, slides: Awaited<ReturnType<typeof snapshot>>['slides']) => {
    await page.evaluate(() => window.editorTest.history.undoState())
    const restored = await snapshot(page)
    expect(restored.slides).toEqual(slides)
    expect(restored.undo).toBe(false)
}

for (const tool of ['eraser', 'brush', 'generateSlideNotes'] as const)
    test(`Ctrl+${tool} box acts only on its hits, excluding the old outside selection`, async ({
        page,
    }) => {
        await configure(page, tool, -5)
        const before = await snapshot(page)
        await gesture(page, 'box', 'Control')
        const after = await snapshot(page)
        expect(after.slides[0]).toEqual(before.slides[0])
        if (tool === 'eraser') expect(after.slides[1]).toEqual(before.slides[1]!.slice(1))
        if (tool === 'brush')
            expect(after.slides[1]).toEqual(
                before.slides[1]!.map((note, index) =>
                    index === 0 ? { ...note, critical: true } : note,
                ),
            )
        if (tool === 'generateSlideNotes') {
            expect(after.slides[1]!.filter((note) => note.beat !== 7)).toEqual(before.slides[1])
            expect(after.slides[1]!.filter((note) => note.beat === 7)).toHaveLength(1)
        }
        expect(after.undo).toBe(true)
        await undoOne(page, before.slides)
    })

for (const tool of ['eraser', 'generateSlideNotes'] as const)
    for (const kind of ['tap', 'box'] as const)
        test(`Shift+${tool} ${kind} ignores slide expansion`, async ({ page }) => {
            await configure(page, tool)
            const before = await snapshot(page)
            await gesture(page, kind, 'Shift')
            const after = await snapshot(page)
            expect(after.slides[0]).toEqual(before.slides[0])
            if (tool === 'eraser') expect(after.slides[1]).toEqual(before.slides[1]!.slice(1))
            else {
                expect(after.slides[1]!.filter((note) => note.beat !== 7)).toEqual(before.slides[1])
                expect(after.slides[1]!.filter((note) => note.beat === 7)).toHaveLength(1)
            }
            expect(after.undo).toBe(true)
            await undoOne(page, before.slides)
        })

test('Shift+Brush box expands to visible same-beat slide notes and excludes off-beat and unfocused notes', async ({
    page,
}) => {
    await configure(page, 'brush')
    const before = await snapshot(page)
    await gesture(page, 'box', 'Shift')
    const after = await snapshot(page)
    expect(after.slides[0]).toEqual(before.slides[0])
    expect(after.slides[1]).toEqual(
        before.slides[1]!.map((note, index) => (index < 2 ? { ...note, critical: true } : note)),
    )
    await undoOne(page, before.slides)
})

test('Shift+Select box expands across beats within scope without editing the chart', async ({
    page,
}) => {
    await configure(page, 'select')
    const before = await snapshot(page)
    await gesture(page, 'box', 'Shift')
    const after = await snapshot(page)
    expect(after.slides).toEqual(before.slides)
    expect(after.selected).toEqual(before.slides[1]!.filter((note) => note.left !== 5))
    expect(after.undo).toBe(false)
})

for (const tool of ['note', 'slide'] as const)
    test(`Shift+${tool} click first expands selection, then quick-edits on the next selected click`, async ({
        page,
    }) => {
        await configure(page, tool, 0)
        await page.evaluate(async (tool) => {
            const { appImport, settings } = window.editorTest
            settings.showSidebar = true
            settings.propertiesSection = 'selection'
            const note = await appImport<typeof import('../../src/editor/tools/note')>(
                '/src/editor/tools/note/index.ts',
            )
            const slide = await appImport<typeof import('../../src/editor/tools/slide')>(
                '/src/editor/tools/slide/index.ts',
            )
            // One explicit field exercises the single-property quick-edit toggle.
            const preset = { copyProperties: false, isCritical: true }
            if (tool === 'note') note.defaultNoteProperties.value = preset
            else slide.defaultSlideProperties.value = preset
        }, tool)
        await settle(page)
        const before = await snapshot(page)
        await gesture(page, 'tap', 'Shift')
        const selected = await snapshot(page)
        expect(selected.slides).toEqual(before.slides)
        expect(selected.selected).toEqual(before.slides[1]!.filter((note) => note.left !== 5))
        expect(selected.undo).toBe(false)
        await gesture(page, 'tap', 'Shift')
        const edited = await snapshot(page)
        expect(edited.slides[0]).toEqual(before.slides[0])
        expect(edited.slides[1]).toEqual(
            before.slides[1]!.map((note) => (note.left !== 5 ? { ...note, critical: true } : note)),
        )
        expect(edited.undo).toBe(true)
        await undoOne(page, before.slides)
    })
