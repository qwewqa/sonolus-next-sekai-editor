import { expect, test, type Page } from '@playwright/test'
import type { GroupId } from '../../src/chart/groups'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const runtimeErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    runtimeErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(installCanvasCounters)
    // A preference saved by an older editor must not restore automatic padding.
    await page.addInitScript(() => {
        localStorage.setItem('sonolus-next-sekai-editor.autoAddGroup', 'true')
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(async ({ page }) => {
    expect(runtimeErrors.get(page)).toEqual([])
})

test('placing notes and time scales repeatedly in the last group adds no group', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view } = window.editorTest
        show({ ...fixtures.interaction, slides: [fixtures.interaction.slides[0]!] }, 3)
        view.groupId = 2 as GroupId
    })
    let previousTool = ''
    for (const [tool, lane, beat] of [
        ['a', -6, 8],
        ['a', 5, 9],
        ['w', -8, 10],
    ] as const) {
        if (previousTool !== tool) await page.keyboard.press(tool)
        previousTool = tool
        const target = await page.evaluate(
            ({ lane, beat }) => window.editorTest.point(lane, beat),
            { lane, beat },
        )
        await page.mouse.click(target.x, target.y)
        expect(await page.evaluate(() => window.editorTest.history.state.value.groups.size)).toBe(2)
    }
    expect(
        await page.evaluate(() =>
            [...window.editorTest.store.getAllEntities()].flatMap((entity) =>
                entity.beat >= 8 && (entity.type === 'note' || entity.type === 'timeScale')
                    ? [[entity.type, entity.beat, entity.groupId]]
                    : [],
            ),
        ),
    ).toEqual([
        ['timeScale', 10, 2],
        ['note', 8, 2],
        ['note', 9, 2],
    ])
})

test('moves, reassignment and repeated transaction commits preserve the group map', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, show, history } = window.editorTest
        const { createTransaction } = await appImport<typeof import('../../src/state/transaction')>(
            '/src/state/transaction.ts',
        )
        const { createSlideId } = await appImport<typeof import('../../src/state/entities/slides')>(
            '/src/state/entities/slides/index.ts',
        )
        const { addNote } = await appImport<typeof import('../../src/state/mutations/slides/note')>(
            '/src/state/mutations/slides/note.ts',
        )
        const { addTimeScale } = await appImport<
            typeof import('../../src/state/mutations/timeScale')
        >('/src/state/mutations/timeScale.ts')
        const { planEdit } = await appImport<
            typeof import('../../src/state/operations/properties/plan')
        >('/src/state/operations/properties/plan.ts')
        const scale = {
            groupId: 1 as GroupId,
            beat: 1,
            editorLane: 4,
            timeScale: 1,
            skip: 0,
            timeScaleEase: 'none' as const,
            timeScaleTransition: 'timeScale' as const,
            hideNotes: false,
        }
        show({
            ...fixtures.interaction,
            slides: [[fixtures.interaction.slides[0]![0]!]],
            timeScales: [scale],
        })
        const source = history.state.value
        const tx = createTransaction(source)
        const base = fixtures.interaction.slides[0]![0]!
        const created = addNote(tx, createSlideId(), { ...base, groupId: 2 as GroupId, beat: 10 })
        const scales = addTimeScale(tx, { ...scale, groupId: 2 as GroupId, beat: 12 })
        const first = tx.commit([...created, ...scales])
        addNote(tx, createSlideId(), { ...base, groupId: 2 as GroupId, beat: 14 })
        const second = tx.commit([])
        const note = [...second.store.slides.note.values()]
            .flat()
            .find((note) => note.groupId === 1)!
        const timeScale = [...second.store.grid.timeScale.values()]
            .flatMap((bucket) => [...bucket])
            .find((entity) => entity.groupId === 1)!
        const moved = planEdit(second, [note, timeScale], { groupId: 2 as GroupId, beat: 16 }).state
        return {
            counts: [source, first, second, moved].map((state) => state.groups.size),
            identities: [first, second, moved].map((state) => state.groups === source.groups),
            selected: moved.selectedEntities.map((entity) =>
                'groupId' in entity ? [entity.type, entity.groupId, entity.beat] : [],
            ),
            sourceNotes: [...source.store.slides.note.values()].flat().length,
            committedNotes: [...second.store.slides.note.values()].flat().length,
        }
    })
    expect(result).toEqual({
        counts: [2, 2, 2, 2],
        identities: [true, true, true],
        selected: [
            ['note', 2, 16],
            ['timeScale', 2, 16],
        ],
        sourceNotes: 1,
        committedNotes: 3,
    })
})

test('combining, splitting and copying/pasting within a populated final group add no group', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, fixtures, show, history, store, point } = window.editorTest
        const { combineNotes } = await appImport<
            typeof import('../../src/editor/commands/combineNotes')
        >('/src/editor/commands/combineNotes/index.ts')
        const { splitHold } = await appImport<typeof import('../../src/editor/commands/splitHold')>(
            '/src/editor/commands/splitHold/index.ts',
        )
        const { copy } = await appImport<typeof import('../../src/editor/commands/copy')>(
            '/src/editor/commands/copy/index.ts',
        )
        const { clipboardEntry } =
            await appImport<typeof import('../../src/clipboard')>('/src/clipboard/index.ts')
        const { pasteAtContextPosition } = await appImport<
            typeof import('../../src/editor/contextMenuPaste')
        >('/src/editor/contextMenuPaste.ts')
        const base = fixtures.interaction.slides[0]![0]!
        show(
            {
                ...fixtures.interaction,
                groups: new Map([[base.groupId, { name: 'Only' }]]),
                slides: [[{ ...base }], [{ ...base, beat: 5, left: 1 }]],
            },
            3,
        )
        const groups = history.state.value.groups
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        combineNotes.execute()
        const combined = history.state.value.store.slides.note.size
        splitHold.execute()
        const split = history.state.value.store.slides.note.size
        Object.defineProperty(navigator.clipboard, 'writeText', {
            configurable: true,
            value: async () => undefined,
        })
        copy.execute()
        Object.defineProperty(navigator.clipboard, 'readText', {
            configurable: true,
            value: async () => clipboardEntry.value!.text,
        })
        const target = point(2, 10)
        const pasted = await pasteAtContextPosition(target.x, target.y)
        const noteCount = [...store.getAllEntities()].filter(
            (entity) => entity.type === 'note',
        ).length
        const counts: number[] = []
        const identities: boolean[] = []
        let checking = true
        while (checking) {
            counts.push(history.state.value.groups.size)
            identities.push(history.state.value.groups === groups)
            checking = history.canUndo.value
            if (checking) history.undoState()
        }
        return { combined, split, pasted, noteCount, counts, identities }
    })
    expect(result).toEqual({
        combined: 1,
        split: 2,
        pasted: true,
        noteCount: 4,
        counts: [1, 1, 1, 1],
        identities: [true, true, true, true],
    })
})

test('explicit Add Group remains undoable and deleting every group retains one usable group', async ({
    page,
}) => {
    await page.evaluate(() => {
        window.editorTest.history.resetState(false)
        window.editorTest.settings.showGroups = true
    })
    const count = () => page.evaluate(() => window.editorTest.history.state.value.groups.size)
    expect(await count()).toBe(1)
    const panel = page.locator('#workspace-panel-groups')
    await panel.getByRole('button', { name: 'Add Group', exact: true }).click()
    await page.keyboard.press('Enter')
    expect(await count()).toBe(2)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await count()).toBe(1)
    await page.evaluate(() => window.editorTest.history.redoState())
    expect(await count()).toBe(2)
    await panel.getByRole('button', { name: 'Select Multiple', exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Select All', exact: true }).click()
    await panel.locator('.manager-bulk-delete').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    expect(await count()).toBe(1)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await count()).toBe(2)
})

test('explicit Add Group preserves manually seeded groups when the allocator would reuse an existing ID', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history } = window.editorTest
        const { addGroup } = await appImport<
            typeof import('../../src/editor/workspace/manager/groups')
        >('/src/editor/workspace/manager/groups.ts')
        const before = history.state.value.groups
        const existing = before.get(2 as GroupId)
        const added = addGroup()
        return {
            before: [...before.keys()],
            after: [...history.state.value.groups.keys()],
            added,
            preserved: history.state.value.groups.get(2 as GroupId) === existing,
        }
    })
    expect(result).toEqual({ before: [1, 2], after: [1, 2, 3], added: 3, preserved: true })
})

test('new charts and SUS/USC/level data imports use only required or encoded groups despite a legacy saved preference', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { appImport, history, settings } = window.editorTest
        const { parseSus } =
            await appImport<typeof import('../../src/sus/parse')>('/src/sus/parse.ts')
        const { parseSusChart } = await appImport<typeof import('../../src/chart/parse/sus')>(
            '/src/chart/parse/sus/index.ts',
        )
        const { parseUscChart } = await appImport<typeof import('../../src/chart/parse/usc')>(
            '/src/chart/parse/usc/index.ts',
        )
        const { parseLevelDataChart } = await appImport<
            typeof import('../../src/chart/parse/levelData')
        >('/src/chart/parse/levelData/index.ts')
        history.resetState(false)
        const group = (name: string) => ({ archetype: '#TIMESCALE_GROUP', name, data: [] })
        return {
            legacyPreference: localStorage.getItem('sonolus-next-sekai-editor.autoAddGroup'),
            supportedPreference: 'autoAddGroup' in settings,
            newChart: history.state.value.groups.size,
            sus: parseSusChart(parseSus(['#BPM01:120', '#00002:4', '#00008:01', '#00011:11']))
                .groups.size,
            uscEmpty: parseUscChart([]).groups.size,
            uscEncoded: parseUscChart([
                { type: 'timeScaleGroup', changes: [] },
                { type: 'timeScaleGroup', changes: [] },
                { type: 'timeScaleGroup', changes: [] },
            ]).groups.size,
            levelEmpty: parseLevelDataChart([]).groups.size,
            levelEncoded: parseLevelDataChart([group('A'), group('B'), group('C')]).groups.size,
        }
    })
    expect(result).toEqual({
        legacyPreference: 'true',
        supportedPreference: false,
        newChart: 1,
        sus: 1,
        uscEmpty: 1,
        uscEncoded: 3,
        levelEmpty: 1,
        levelEncoded: 3,
    })
})
