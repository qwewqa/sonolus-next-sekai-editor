import { expect, test, type Page } from '@playwright/test'
import type { GroupId } from '../../src/chart/groups'
import type { StageId } from '../../src/chart/stages'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

declare global {
    interface Window {
        scopeTest: typeof import('../../src/editor/scope')
        scopeScene: typeof import('../../src/editor/elevation/scene')
    }
}

const runtimeErrors = new WeakMap<Page, string[]>()

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(({ lane, beat }) => window.editorTest.point(lane, beat), { lane, beat })

const snapshot = (page: Page) => page.evaluate(() => window.editorTest.snapshot())

const notes = (page: Page) =>
    page.evaluate(() =>
        window.editorTest
            .snapshot()
            .notes.map(({ beat, left }) => ({ beat, left }))
            .sort((a, b) => a.beat - b.beat),
    )

const setGroupShown = (page: Page, id: number, shown: boolean) =>
    page.evaluate(({ id, shown }) => window.scopeTest.groupScope.setShown(id as GroupId, shown), {
        id,
        shown,
    })

const setStageShown = (page: Page, id: number, shown: boolean) =>
    page.evaluate(({ id, shown }) => window.scopeTest.stageScope.setShown(id as StageId, shown), {
        id,
        shown,
    })

const hoverAt = async (page: Page, lane: number, beat: number) => {
    const { x, y } = await point(page, lane, beat)
    await page.mouse.move(x, y)
    await settle(page)
    return (await snapshot(page)).hovered
}

// Group 1 / stage 1 at beat 3, group 2 / stage 1 at beat 5, group 1 / stage 2 at beat 7.
const seed = (page: Page) =>
    page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        const [[a], [b], [c]] = fixtures.interaction.slides as [
            [(typeof fixtures.interaction.slides)[number][number]],
            [(typeof fixtures.interaction.slides)[number][number]],
            [(typeof fixtures.interaction.slides)[number][number]],
        ]
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [{ ...a }],
                    [{ ...b, groupId: 2 as GroupId }],
                    [{ ...c, stageId: 2 as StageId }],
                ],
            },
            3,
        )
    })

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        // Reuse the live module instance that owns the editor's reactive state.
        window.scopeTest = (await import(
            urls.get('/src/editor/scope.ts') ?? '/src/editor/scope.ts'
        )) as typeof import('../../src/editor/scope')
        window.editorTest.settings.mouseSecondaryTool = 'selectContextMenu'
    })
    await seed(page)
    await settle(page)
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

test('hidden groups and stages are not drawn, hovered, selected or hit by the context menu', async ({
    page,
}) => {
    const hiddenPoint = await point(page, 1, 5)
    const clip = { x: hiddenPoint.x - 30, y: hiddenPoint.y - 12, width: 60, height: 24 }
    const drawn = await page.screenshot({ clip })

    expect(await hoverAt(page, 1, 5)).toEqual([{ type: 'note', beat: 5, left: 0, size: 2 }])
    await setGroupShown(page, 2, false)
    await settle(page)
    expect(await page.screenshot({ clip })).not.toEqual(drawn)

    await page.mouse.move(0, 0)
    expect(await hoverAt(page, 1, 5)).toEqual([])
    expect(await hoverAt(page, -3, 3)).toEqual([{ type: 'note', beat: 3, left: -4, size: 2 }])

    // Clicking the hidden note selects nothing; the visible note remains selectable.
    await page.mouse.click(hiddenPoint.x, hiddenPoint.y)
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([])

    // The context menu falls through the hidden note to an empty position.
    await page.mouse.click(hiddenPoint.x, hiddenPoint.y, { button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    expect((await snapshot(page)).selected).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)

    // Stage masks apply the same way.
    await setStageShown(page, 2, false)
    await settle(page)
    expect(await hoverAt(page, 4, 7)).toEqual([])
    const stagePoint = await point(page, 4, 7)
    await page.mouse.click(stagePoint.x, stagePoint.y, { button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    expect((await snapshot(page)).selected).toEqual([])
    await page.keyboard.press('Escape')

    // Revealing restores drawing and interaction; nothing was edited.
    await setGroupShown(page, 2, true)
    await setStageShown(page, 2, true)
    await page.mouse.move(0, 0)
    await settle(page)
    await expect.poll(() => page.screenshot({ clip })).toEqual(drawn)
    expect(await hoverAt(page, 4, 7)).toEqual([{ type: 'note', beat: 7, left: 3, size: 2 }])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('group and stage isolation combine independently and All restores each saved mask', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.settings.showOtherGroups = false
        window.editorTest.settings.showOtherStages = false
    })
    // Select entries hidden in All: isolation must still show the selected one.
    await setGroupShown(page, 2, false)
    await setStageShown(page, 2, false)
    await page.evaluate(() => window.scopeTest.groupScope.focus(2 as GroupId))
    expect(await hoverAt(page, 1, 5)).toHaveLength(1)
    expect(await hoverAt(page, -3, 3)).toEqual([])
    await page.evaluate(() => window.scopeTest.stageScope.focus(2 as StageId))
    expect(await hoverAt(page, 1, 5)).toEqual([])
    expect(await hoverAt(page, 4, 7)).toEqual([])
    // Clear only groups: group 1/stage 2 returns, group 2 stays hidden in All.
    await page.evaluate(() => window.scopeTest.groupScope.focusAll())
    expect(await hoverAt(page, 4, 7)).toHaveLength(1)
    expect(await hoverAt(page, 1, 5)).toEqual([])
    await page.evaluate(() => window.scopeTest.stageScope.focusAll())
    expect(await hoverAt(page, 4, 7)).toEqual([])
    expect(await hoverAt(page, 1, 5)).toEqual([])
    expect(await hoverAt(page, -3, 3)).toHaveLength(1)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

for (const showOthers of [false, true]) {
    test(`authoring in a selected hidden group and stage preserves their All visibility choices (Show Other: ${showOthers})`, async ({
        page,
    }) => {
        await page.evaluate((showOthers) => {
            window.editorTest.settings.showOtherGroups = showOthers
            window.editorTest.settings.showOtherStages = showOthers
            window.scopeTest.groupScope.setShown(2 as GroupId, false)
            window.scopeTest.stageScope.setShown(2 as StageId, false)
            window.scopeTest.groupScope.focus(2 as GroupId)
            window.scopeTest.stageScope.focus(2 as StageId)
        }, showOthers)
        await page.keyboard.press('a')
        const target = await point(page, -6, 9)
        await page.mouse.click(target.x, target.y)
        await settle(page)
        const result = await page.evaluate(() => {
            const { store, view } = window.editorTest
            const created = [...store.getAllEntities()].flatMap((entity) =>
                entity.type === 'note' && entity.beat === 9
                    ? [[entity.groupId, entity.stageId]]
                    : [],
            )
            const saved = [[...view.groupVisibility], [...view.stageVisibility]]
            window.scopeTest.groupScope.focusAll()
            window.scopeTest.stageScope.focusAll()
            return {
                created,
                saved,
                restored: [
                    window.scopeTest.groupScope.visibility(2 as GroupId),
                    window.scopeTest.stageScope.visibility(2 as StageId),
                ],
            }
        })
        expect(result).toEqual({
            created: [[2, 2]],
            saved: [[[2, 'hidden']], [[2, 'hidden']]],
            restored: ['hidden', 'hidden'],
        })
        await page
            .locator('[data-editor-toolbar]')
            .first()
            .getByRole('button', { name: 'Select', exact: true })
            .click()
        expect(await hoverAt(page, -6, 9)).toEqual([])
    })
}

test('hiding during a mouse drag cancels the edit and editing recovers', async ({ page }) => {
    const original = await notes(page)
    const start = await point(page, 1, 5)
    const end = await point(page, 3, 6)

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await settle(page)
    await setGroupShown(page, 2, false)
    await page.mouse.move(end.x + 4, end.y, { steps: 2 })
    await page.mouse.up()
    await settle(page)

    expect(await notes(page)).toEqual(original)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    expect((await snapshot(page)).creating).toEqual([])

    // Hiding an unrelated stage cancels a drag too: the scope changed under it.
    const other = await point(page, -3, 3)
    await page.mouse.move(other.x, other.y)
    await page.mouse.down()
    await page.mouse.move(other.x + 40, other.y - 40, { steps: 8 })
    await setStageShown(page, 2, false)
    await page.mouse.up()
    await settle(page)
    expect(await notes(page)).toEqual(original)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

    await setGroupShown(page, 2, true)
    await setStageShown(page, 2, true)
    await settle(page)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)
    expect(await notes(page)).toEqual([
        { beat: 3, left: -4 },
        { beat: 6, left: 2 },
        { beat: 7, left: 3 },
    ])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
})

test('visibility masks keep the authoring target, history and the status bar target', async ({
    page,
}) => {
    const status = page.locator('.bg-preview:has(> span.flex-grow)')
    await expect(status).toContainText('All Groups')
    await expect(status).not.toContainText('1/2')

    await page.evaluate(() => {
        window.scopeTest.groupScope.focus(1 as GroupId)
    })
    await setGroupShown(page, 2, true)
    await setStageShown(page, 2, false)
    await settle(page)
    expect(await page.evaluate(() => window.editorTest.view.groupId)).toBe(1)
    await expect(status).toContainText('Default')
    const stageCount = status.getByTitle('1/2 Stages Shown', { exact: true })
    await expect(stageCount).toBeVisible()
    await expect(stageCount).toContainText('1/2')
    await expect(status).toContainText(/All Stages\s*· 1\/2/)
    await expect(status.getByTitle(/Groups Shown/)).toHaveCount(0)

    // Hiding the default group does not move new notes elsewhere.
    await page.evaluate(() => {
        window.scopeTest.groupScope.focus(undefined)
    })
    await setGroupShown(page, 1, false)
    await settle(page)
    await expect(status).toContainText('All Groups')
    await expect(status.getByTitle('1/2 Groups Shown', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

    await page.keyboard.press('a')
    await expect(status.locator('span.flex-grow')).toHaveText(/^Note(?: |$)/)
    const target = await point(page, -6, 9)
    await page.mouse.click(target.x, target.y)
    await settle(page)
    const created = await page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .filter((entity) => entity.type === 'note' && entity.beat === 9)
            .map((entity) => (entity.type === 'note' ? [entity.groupId, entity.stageId] : [])),
    )
    expect(created).toEqual([[1, 1]])
    // Authoring revealed its hidden target instead of letting the note vanish.
    expect(await page.evaluate(() => window.scopeTest.groupScope.visibility(1 as GroupId))).toBe(
        'full',
    )
    await expect(status.getByTitle(/Groups Shown/)).toHaveCount(0)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
})

test('placing a time scale into a hidden group reveals it before replacing', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show({
            ...fixtures.interaction,
            timeScales: [
                {
                    groupId: 1 as GroupId,
                    beat: 6,
                    editorLane: 4,
                    timeScale: 3,
                    skip: 0,
                    timeScaleEase: 'inStep',
                    timeScaleTransition: 'timeScale',
                    hideNotes: false,
                },
            ],
        })
    })
    await setGroupShown(page, 1, false)
    await page.keyboard.press('w')
    const target = await point(page, -8, 6)
    await page.mouse.click(target.x, target.y)
    await settle(page)
    const result = await page.evaluate(() => ({
        visibility: window.scopeTest.groupScope.visibility(1 as GroupId),
        timeScales: [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
            entity.type === 'timeScale' ? [[entity.groupId, entity.beat]] : [],
        ),
    }))
    // The replaced time scale was revealed first; the group never holds two at one beat.
    expect(result).toEqual({ visibility: 'full', timeScales: [[1, 6]] })
})

test('removed groups keep their visibility entries until a reset', async ({ page }) => {
    await setGroupShown(page, 2, false)
    await setStageShown(page, 2, false)
    const sizes = () =>
        page.evaluate(() => [
            window.editorTest.view.groupVisibility.size,
            window.editorTest.view.stageVisibility.size,
        ])
    expect(await sizes()).toEqual([1, 1])

    // Removing group 2 and disabling dynamic stages keep the saved masks for undo.
    await page.evaluate(() => {
        const { history } = window.editorTest
        const current = history.state.value
        history.replaceState({
            ...current,
            isDynamicStages: false,
            groups: new Map([...current.groups].slice(0, 1)),
        })
    })
    await settle(page)
    expect(await sizes()).toEqual([1, 1])
    expect(await page.evaluate(() => window.scopeTest.stageScope.visibility(2 as StageId))).toBe(
        'full',
    )
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, isDynamicStages: true })
    })
    await settle(page)
    expect(await page.evaluate(() => window.scopeTest.stageScope.visibility(2 as StageId))).toBe(
        'hidden',
    )

    // A new chart starts clean.
    await page.evaluate(() => {
        const { show, fixtures } = window.editorTest
        show(fixtures.interaction, 3)
    })
    await settle(page)
    expect(await sizes()).toEqual([0, 0])
})

test('the elevation editor follows the same filters and cancels drags when they change', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view, settings } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [{ ...base, beat: 6, left: -3, size: 2, elevation: 1 }],
                    [{ ...base, beat: 6, left: 3, size: 2, elevation: 1, groupId: 2 as GroupId }],
                ],
            },
            3,
        )
        view.cursorTime = 3
        settings.elevationEditorSideBySide = 'disallow'
    })
    await settle(page)
    await page.keyboard.press('t')
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        window.scopeScene = (await import(
            urls.get('/src/editor/elevation/scene.ts') ?? '/src/editor/elevation/scene.ts'
        )) as typeof import('../../src/editor/elevation/scene')
    })
    const rows = () =>
        page.evaluate(() =>
            window.scopeScene.elevationLayout.value.rows.map((row) => ({
                x: row.x,
                y: row.y,
                groupId: row.note.groupId,
            })),
        )
    const elevations = () =>
        page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()]
                .flatMap((entity) => (entity.type === 'note' ? [entity.elevation] : []))
                .sort(),
        )
    await settle(page)
    expect((await rows()).map(({ groupId }) => groupId).sort()).toEqual([1, 2])

    // Selection-only updates keep the filtered notes and their layout; masks rebuild them.
    const identity = await page.evaluate(async () => {
        const { history, nextTick, view } = window.editorTest
        const { elevationNotes, elevationLayout } = window.scopeScene
        const notes = elevationNotes.value
        const layout = elevationLayout.value
        history.replaceState({
            ...history.state.value,
            selectedEntities: [notes[0]!.note],
        })
        await nextTick()
        const selection = [elevationNotes.value === notes, elevationLayout.value === layout]
        view.groupVisibility = new Map([[2 as GroupId, 'hidden']])
        await nextTick()
        const masked = [elevationNotes.value === notes, elevationLayout.value === layout]
        view.groupVisibility = new Map()
        history.replaceState({ ...history.state.value, selectedEntities: [] })
        return { selection, masked }
    })
    expect(identity).toEqual({ selection: [true, true], masked: [false, false] })
    await settle(page)

    await setGroupShown(page, 2, false)
    await settle(page)
    expect((await rows()).map(({ groupId }) => groupId)).toEqual([1])

    await setGroupShown(page, 2, true)
    await settle(page)
    const box = (await page.locator('.elevation-canvas').boundingBox())!
    const row = (await rows()).find(({ groupId }) => groupId === 1)!
    const start = { x: box.x + row.x, y: box.y + row.y }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y - 80, { steps: 5 })
    await settle(page)
    await setGroupShown(page, 2, false)
    await page.mouse.move(start.x, start.y - 90, { steps: 2 })
    await page.mouse.up()
    await settle(page)
    expect(await elevations()).toEqual([1, 1])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

    // Editing recovers once the gesture is over.
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y - 80, { steps: 5 })
    await page.mouse.up()
    await settle(page)
    expect((await elevations())[1]).toBeGreaterThan(1)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
})

test.describe('touch', () => {
    test.use({ hasTouch: true })

    const touch = (page: Page, type: string, point: { x: number; y: number }) =>
        page.evaluate(
            ({ type, point }) => {
                const target = document.querySelector('.editor')!
                const changedTouches = [
                    new Touch({ identifier: 1, target, clientX: point.x, clientY: point.y }),
                ]
                target.dispatchEvent(
                    new TouchEvent(type, { changedTouches, bubbles: true, cancelable: true }),
                )
            },
            { type, point },
        )

    test('hiding during a touch drag cancels the edit and editing recovers', async ({ page }) => {
        const original = await notes(page)
        const start = await point(page, 1, 5)
        const end = await point(page, 3, 6)

        await touch(page, 'touchstart', start)
        await touch(page, 'touchmove', end)
        await settle(page)
        await setGroupShown(page, 2, false)
        await touch(page, 'touchmove', { x: end.x + 4, y: end.y })
        await touch(page, 'touchend', end)
        await settle(page)
        expect(await notes(page)).toEqual(original)
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

        await setGroupShown(page, 2, true)
        await settle(page)
        await touch(page, 'touchstart', start)
        await touch(page, 'touchmove', end)
        await settle(page)
        await touch(page, 'touchend', end)
        await settle(page)
        expect(await notes(page)).toContainEqual({ beat: 6, left: 2 })
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(true)
    })
})

test('dragging a selection leaves its hidden members untouched', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const selected = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' && entity.beat !== 7,
        )
        history.replaceState({ ...history.state.value, selectedEntities: selected })
    })
    await setGroupShown(page, 2, false)
    await settle(page)
    const start = await point(page, -3, 3)
    const end = await point(page, -1, 4)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)
    expect(await notes(page)).toEqual([
        { beat: 4, left: -2 },
        { beat: 5, left: 0 },
        { beat: 7, left: 3 },
    ])
})

test('a context paste is abandoned when visibility changes while the clipboard is read', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const appImport = <T>(pathname: string): Promise<T> =>
            import(urls.get(pathname) ?? pathname)
        const { pasteAtContextPosition } = await appImport<
            typeof import('../../src/editor/contextMenuPaste')
        >('/src/editor/contextMenuPaste.ts')
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const clipboard =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const { history, store, point } = window.editorTest
        const [first] = [...store.getAllEntities()].filter((entity) => entity.type === 'note')
        history.replaceState({ ...history.state.value, selectedEntities: [first!] })
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        copy.execute()
        const text = clipboard.clipboardEntry.value?.text ?? ''
        let hide = true
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => {
                await new Promise((resolve) => setTimeout(resolve, 20))
                if (hide) window.scopeTest.groupScope.setShown(2 as GroupId, false)
                return text
            },
        })
        const target = point(2, 10)
        const count = () => [...store.getAllEntities()].filter((e) => e.type === 'note').length
        const abandoned = await pasteAtContextPosition(target.x, target.y)
        const afterAbandon = { count: count(), canUndo: history.canUndo.value }
        hide = false
        const pasted = await pasteAtContextPosition(target.x, target.y)
        return { abandoned, afterAbandon, pasted, count: count() }
    })
    expect(result).toEqual({
        abandoned: false,
        afterAbandon: { count: 3, canUndo: false },
        pasted: true,
        count: 4,
    })
})

test('changing visibility cancels a pending scaling session', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const selected = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' && entity.beat !== 5,
        )
        history.replaceState({ ...history.state.value, selectedEntities: selected })
    })
    const original = await notes(page)
    const target = await point(page, -3, 3)
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Scale Beats', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('spinbutton', { name: 'Scale Factor', exact: true }).fill('2')
    await setGroupShown(page, 2, false)
    await expect(dialog).toHaveCount(0)
    await settle(page)
    expect(await notes(page)).toEqual(original)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('hiding a selected object deselects it so selection commands cannot reach it', async ({
    page,
}) => {
    const original = await notes(page)
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const selected = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' && entity.beat === 5,
        )
        history.replaceState({ ...history.state.value, selectedEntities: selected })
    })
    await setGroupShown(page, 2, false)
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

    await page.keyboard.press('Delete')
    await page.evaluate(async () => {
        const urls = new Map(
            performance
                .getEntriesByType('resource')
                .map((entry) => [new URL(entry.name).pathname, entry.name]),
        )
        const { openSelectionContextMenu } = (await import(
            urls.get('/src/editor/contextMenu.ts') ?? '/src/editor/contextMenu.ts'
        )) as typeof import('../../src/editor/contextMenu')
        openSelectionContextMenu()
    })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await notes(page)).toEqual(original)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)

    // Undo cannot bring a hidden object back into the selection either.
    await setGroupShown(page, 2, true)
    const start = await point(page, 1, 5)
    const end = await point(page, 3, 6)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 6, left: 2, size: 2 }])
    await setGroupShown(page, 2, false)
    await page.evaluate(() => window.editorTest.history.undoState())
    await settle(page)
    expect(await notes(page)).toEqual(original)
    expect((await snapshot(page)).selected).toEqual([])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('loading a chart clears visibility overrides and focus', async ({ page }) => {
    await page.evaluate(() => {
        window.scopeTest.groupScope.setShown(1 as GroupId, false)
        window.scopeTest.stageScope.setShown(2 as StageId, false)
        window.scopeTest.groupScope.focus(2 as GroupId)
    })
    // Load through history only: the fixture's `show` is not used, so nothing
    // else resets the view. Group and stage ids are reused across charts.
    await page.evaluate(() => {
        const { history, fixtures } = window.editorTest
        history.resetState(false, fixtures.notes)
    })
    await settle(page)
    expect(
        await page.evaluate(() => {
            const { view } = window.editorTest
            return {
                groupId: view.groupId,
                stageId: view.stageId,
                groups: view.groupVisibility.size,
                stages: view.stageVisibility.size,
                visible: window.scopeTest.groupScope.visibility(1 as GroupId),
            }
        }),
    ).toEqual({ groupId: undefined, stageId: undefined, groups: 0, stages: 0, visible: 'full' })
})

test('dimmed selections stay selected while hidden ones are dropped', async ({ page }) => {
    await page.evaluate(() => {
        const { history, store, settings } = window.editorTest
        settings.showOtherGroups = true
        const selected = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' && entity.beat === 5,
        )
        history.replaceState({ ...history.state.value, selectedEntities: selected })
        window.scopeTest.groupScope.focus(1 as GroupId)
    })
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([{ type: 'note', beat: 5, left: 0, size: 2 }])
    // Enabled Show Other Groups keeps selection through dimmed focus transitions.
    await page.evaluate(() => {
        window.scopeTest.groupScope.focus(undefined)
        window.scopeTest.groupScope.focus(2 as GroupId)
        window.scopeTest.groupScope.focus(1 as GroupId)
    })
    expect((await snapshot(page)).selected).toHaveLength(1)
    await setGroupShown(page, 2, false)
    expect((await snapshot(page)).selected).toEqual([])
})

test('isolating another group drops hidden selections and returning to All does not reselect them', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        window.editorTest.settings.showOtherGroups = false
        const selected = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note' && entity.beat === 5,
        )
        history.replaceState({ ...history.state.value, selectedEntities: selected })
        window.scopeTest.groupScope.focus(1 as GroupId)
    })
    await settle(page)
    expect((await snapshot(page)).selected).toEqual([])

    // Moving through groups and All never resurrects a dropped selection.
    await page.evaluate(() => {
        window.scopeTest.groupScope.focus(undefined)
        window.scopeTest.groupScope.focus(2 as GroupId)
        window.scopeTest.groupScope.focus(1 as GroupId)
    })
    expect((await snapshot(page)).selected).toEqual([])
})

test('Select Slide Notes is not offered when the rest of the slide is hidden', async ({ page }) => {
    await page.evaluate(() => {
        const { fixtures, show, history, store } = window.editorTest
        const [[a]] = fixtures.interaction.slides as [
            [(typeof fixtures.interaction.slides)[number][number]],
        ]
        show({
            ...fixtures.interaction,
            slides: [[{ ...a }, { ...a, beat: 5, groupId: 2 as GroupId }]],
        })
        const first = [...store.getAllEntities()].find(
            (entity) => entity.type === 'note' && entity.beat === 3,
        )!
        history.replaceState({ ...history.state.value, selectedEntities: [first] })
    })
    const target = await point(page, -3, 3)
    const menu = page.getByRole('menu')
    const option = menu.getByRole('menuitem', { name: 'Select Slide Notes', exact: true })
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await expect(option).toHaveCount(1)
    await page.keyboard.press('Escape')

    await setGroupShown(page, 2, false)
    await page.mouse.click(target.x, target.y, { button: 'right' })
    await expect(menu).toBeVisible()
    await expect(option).toHaveCount(0)
})
