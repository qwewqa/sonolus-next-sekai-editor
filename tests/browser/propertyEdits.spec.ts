import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

/** Shows slides of notes plus one stage transform joint at beat 20. */
const showSlides = (page: Page, slides: Partial<NoteObject>[][]) =>
    page.evaluate(async (slides) => {
        const { fixtures, show, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        show(
            {
                ...fixtures.events,
                cameraEvents: [],
                stageMaskEvents: [],
                stagePivotEvents: [],
                stageStyleEvents: [],
                timeScales: [],
                stageTransformEvents: [
                    {
                        stageId: template.stageId,
                        beat: 20,
                        rotation: 0,
                        xTranslation: 0,
                        yTranslation: 0,
                        elevation: 0,
                        anchor: 'default',
                        eventEase: 'linear',
                    },
                ],
                slides: slides.map((notes) =>
                    notes.map((note) => ({ ...template, left: 0, size: 2, ...note })),
                ),
            },
            2,
        )
        await nextTick()
    }, slides)

const selectAll = (page: Page) =>
    page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' || entity.type === 'stageTransformEventJoint',
            ),
        })
    })

const quickEdit = (page: Page, properties: Record<string, unknown>) =>
    page.evaluate(async (properties) => {
        const { quickEdit } = await window.editorTest.appImport<
            typeof import('../../src/editor/utils/quickEdit')
        >('/src/editor/utils/quickEdit.ts')
        quickEdit({ copyProperties: true, ...properties })
    }, properties)

const values = (page: Page, key: string) =>
    page.evaluate(
        (key) =>
            [...window.editorTest.store.getAllEntities()]
                .filter((entity) => key in entity)
                .sort((a, b) => a.beat - b.beat)
                .map((entity) => `${entity.type}:${String(entity[key as keyof typeof entity])}`),
        key,
    )

test.describe('quick edit', () => {
    test('a note preset leaves selected events alone', async ({ page }) => {
        await showSlides(page, [[{ beat: 0, elevation: 0 }]])
        await selectAll(page)
        await quickEdit(page, { elevation: 2 })
        expect(await values(page, 'elevation')).toEqual(['note:2', 'stageTransformEventJoint:0'])
    })

    test('a single Guide Alpha preset sets that alpha', async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, connectorType: 'guide', connectorGuideAlpha: 1 },
                { beat: 2, connectorType: 'guide', connectorGuideAlpha: 1 },
            ],
        ])
        await selectAll(page)
        await quickEdit(page, { connectorGuideAlpha: 0.5 })
        expect(await values(page, 'connectorGuideAlpha')).toEqual(['note:0.5', 'note:0.5'])
    })
})

const edit = (page: Page, object: Record<string, unknown>) =>
    page.evaluate(async (object) => {
        const { editSelectedEditableEntities } = await window.editorTest.appImport<
            typeof import('../../src/editor/sidebars/default')
        >('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities(object)
    }, object)

const undoLabel = (page: Page) =>
    page.evaluate(async () => {
        const history = window.editorTest.history
        const before = history.state.value
        const name = history.undoState() as string | (() => string) | undefined
        if (name !== undefined) history.redoState()
        return {
            name: typeof name === 'function' ? name() : name,
            same: history.state.value === before,
        }
    })

test.describe('edit labels', () => {
    test('name the property and count only the objects that changed', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, isCritical: true, connectorActiveIsCritical: true }],
            [{ beat: 2 }],
            [{ beat: 4 }],
        ])
        await page.evaluate(() => {
            const { history, store } = window.editorTest
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
            })
        })
        await edit(page, { isCritical: true })
        await expect(page.locator('.notification')).toHaveText('Set Critical on 2 notes')
        expect((await undoLabel(page)).name).toBe('Set Critical on 2 notes')
    })

    test('say objects when other kinds changed too', async ({ page }) => {
        await showSlides(page, [[{ beat: 0, elevation: 0 }]])
        await selectAll(page)
        await edit(page, { elevation: 3 })
        await expect(page.locator('.notification')).toHaveText('Set Elevation on 2 objects')
    })

    test('name the one kind of event or change that changed', async ({ page }) => {
        const select = (type: string) =>
            page.evaluate((type) => {
                const { history, store } = window.editorTest
                history.replaceState({
                    ...history.state.value,
                    selectedEntities: [...store.getAllEntities()].filter((e) => e.type === type),
                })
            }, type)
        await page.evaluate(() => {
            const { fixtures, show } = window.editorTest
            show(fixtures.events)
        })
        await select('timeScale')
        await edit(page, { hideNotes: true })
        await expect(page.locator('.notification')).toHaveText('Set Hide Notes on 3 time scales')
        await select('cameraEventJoint')
        await edit(page, { cameraZoom: 2 })
        await expect(page.locator('.notification')).toHaveText('Set Camera Zoom on 4 camera events')
        await select('bpm')
        await edit(page, { bpm: 200, meter: 3 })
        await expect(page.locator('.notification')).toHaveText('Edited 2 BPM changes')
    })

    test('add no history entry when nothing changes', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, isCritical: true, connectorActiveIsCritical: true }],
            [{ beat: 2, isCritical: true, connectorActiveIsCritical: true }],
        ])
        await selectAll(page)
        const count = () =>
            page.evaluate(async () => {
                const { history } = window.editorTest
                const state = history.state.value
                let steps = 0
                while (history.undoState() !== undefined) steps++
                for (let i = 0; i < steps; i++) history.redoState()
                return { steps, same: history.state.value.store === state.store }
            })
        const start = await count()
        await edit(page, { isCritical: true })
        await expect(page.locator('.notification')).toHaveText('No change')
        expect(await count()).toEqual(start)
    })

    test('the brush counts what it changed and selects untouched targets', async ({ page }) => {
        await showSlides(page, [
            [{ beat: 0, isCritical: true, connectorActiveIsCritical: true }],
            [{ beat: 2 }],
        ])
        const brush = (properties: Record<string, unknown>) =>
            page.evaluate(async (properties) => {
                const { store, appImport } = window.editorTest
                const brush = await appImport<typeof import('../../src/editor/tools/brush')>(
                    '/src/editor/tools/brush/index.ts',
                )
                brush.brushProperties.value = properties
                brush.applyBrushToEntities(
                    [...store.getAllEntities()].filter((e) => e.type === 'note'),
                )
            }, properties)
        await brush({ isCritical: true })
        await expect(page.locator('.notification')).toHaveText('Brushed 1 object')
        await brush({ isCritical: true })
        await expect(page.locator('.notification')).toHaveText('No change')
        expect(
            await page.evaluate(
                () => window.editorTest.history.state.value.selectedEntities.length,
            ),
        ).toBe(2)
    })

    test("an attached tick's lane and width count as no change", async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, left: -4 },
                { beat: 1, isAttached: true, flickDirection: 'none' },
                { beat: 2, left: 4 },
            ],
        ])
        const run = (properties: Record<string, unknown> | 'flip', ticksOnly: boolean) =>
            page.evaluate(
                async ({ properties, ticksOnly }) => {
                    const { history, store, appImport } = window.editorTest
                    const notes = [...store.getAllEntities()].filter(
                        (e) => e.type === 'note' && (!ticksOnly || e.isAttached),
                    )
                    if (properties === 'flip') {
                        history.replaceState({ ...history.state.value, selectedEntities: notes })
                        const { commands } = await appImport<
                            typeof import('../../src/editor/commands')
                        >('/src/editor/commands/index.ts')
                        void commands.flip.execute()
                        return
                    }
                    const brush = await appImport<typeof import('../../src/editor/tools/brush')>(
                        '/src/editor/tools/brush/index.ts',
                    )
                    brush.brushProperties.value = properties
                    brush.applyBrushToEntities(notes)
                },
                { properties, ticksOnly },
            )
        const notification = page.locator('.notification')
        await run({ size: 5 }, true)
        await expect(notification).toHaveText('No change')
        await run('flip', true)
        await expect(notification).toHaveText('No change')
        await run({ size: 5 }, false)
        await expect(notification).toHaveText('Brushed 2 objects')
        // A stored hidden value still counts.
        await run({ elevation: 3 }, true)
        await expect(notification).toHaveText('Brushed 1 object')
    })
})

// Hidden values are kept and written on purpose; these results must not change.
test.describe('kept writes', () => {
    const labels = {
        isCritical: 'Critical',
        isFake: 'Fake',
        isConnectorSeparator: 'Separator',
        isAttached: 'Attached',
        size: 'Size',
        left: 'Lane',
    }
    /** Selects the notes at these beats (all by default) and sets one field in the Properties panel. */
    const panel = async (
        page: Page,
        key: keyof typeof labels,
        value: boolean | number,
        beats?: number[],
    ) => {
        await page.evaluate(async (beats) => {
            const { history, store, settings, nextTick } = window.editorTest
            settings.showSidebar = true
            settings.propertiesConnectorExpanded = true
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (e) => e.type === 'note' && (!beats || beats.includes(e.beat)),
                ),
            })
            await nextTick()
        }, beats)
        const control = page
            .locator('#workspace-panel-properties #properties-section-selection label')
            .filter({ has: page.getByText(labels[key], { exact: true }) })
            .locator('input')
        if (typeof value === 'number') {
            await control.fill(`${value}`)
            await control.press('Enter')
        } else {
            // A Mixed toggle turns on first.
            const shown = value ? 'Enabled' : 'Disabled'
            for (let i = 0; i < 2 && (await control.inputValue()) !== shown; i++)
                await control.click()
            await expect(control).toHaveValue(shown)
        }
    }
    const notes = (page: Page, keys: string[]) =>
        page.evaluate(
            (keys) =>
                [...window.editorTest.store.getAllEntities()]
                    .filter((e) => e.type === 'note')
                    .sort((a, b) => a.beat - b.beat)
                    .map((e) => keys.map((key) => e[key as keyof typeof e])),
            keys,
        )

    test('Critical on anchors also makes their slide critical', async ({ page }) => {
        await showSlides(page, [[{ beat: 0, noteType: 'anchor' }, { beat: 2 }], [{ beat: 4 }]])
        await panel(page, 'isCritical', true, [0, 4])
        expect(await notes(page, ['isCritical', 'connectorActiveIsCritical'])).toEqual([
            [true, true],
            [false, false],
            [true, true],
        ])
    })

    test('Fake also sets Slide Fake, hidden ones included', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 2 }]])
        await panel(page, 'isFake', true)
        expect(await notes(page, ['isFake', 'connectorIsFake'])).toEqual([
            [true, true],
            [true, true],
        ])
    })

    test('a separator reveals the connector values a note already holds', async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0 },
                { beat: 1, isAttached: true, connectorType: 'guide', connectorLayer: 'over' },
                { beat: 2 },
            ],
        ])
        await panel(page, 'isConnectorSeparator', true, [1])
        expect(await notes(page, ['connectorType', 'connectorLayer'])).toEqual([
            ['active', 'top'],
            ['guide', 'over'],
            ['active', 'top'],
        ])
    })

    test('the brush pre-sets hidden values', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 1, isAttached: true }, { beat: 2 }]])
        await page.evaluate(async () => {
            const { store, appImport } = window.editorTest
            const brush = await appImport<typeof import('../../src/editor/tools/brush')>(
                '/src/editor/tools/brush/index.ts',
            )
            brush.brushProperties.value = { connectorType: 'guide' }
            brush.applyBrushToEntities(
                [...store.getAllEntities()].filter((e) => e.type === 'note' && e.beat === 1),
            )
        })
        expect(await notes(page, ['connectorType'])).toEqual([['active'], ['guide'], ['active']])
    })

    test('detaching keeps the stored elevation and the panel writes exact sizes', async ({
        page,
    }) => {
        await showSlides(page, [
            [
                { beat: 0, elevation: 0, left: 0 },
                { beat: 1, isAttached: true, elevation: 0 },
                { beat: 2, elevation: 4, left: 4 },
            ],
        ])
        await panel(page, 'isAttached', false, [1])
        expect(await notes(page, ['left', 'elevation'])).toEqual([
            [0, 0],
            [2, 0],
            [4, 4],
        ])
        await page.evaluate(() => {
            window.editorTest.settings.zeroWidthNotes = 'off'
            window.editorTest.settings.maxLane = 6
        })
        await panel(page, 'size', 0, [0])
        await panel(page, 'left', 20, [0])
        expect((await notes(page, ['left', 'size']))[0]).toEqual([20, 0])
    })
})

test('a flip that changes nothing adds no history entry', async ({ page }) => {
    const steps = () =>
        page.evaluate(() => {
            const { history } = window.editorTest
            let steps = 0
            while (history.undoState() !== undefined) steps++
            for (let i = 0; i < steps; i++) history.redoState()
            return steps
        })
    const flip = (type: string, command: 'flip' | 'flipVertical' = 'flip', count = Infinity) =>
        page.evaluate(
            async ({ type, command, count }) => {
                const { history, store, appImport } = window.editorTest
                history.replaceState({
                    ...history.state.value,
                    selectedEntities: [...store.getAllEntities()]
                        .filter((e) => e.type === type)
                        .slice(0, count),
                })
                const { commands } = await appImport<typeof import('../../src/editor/commands')>(
                    '/src/editor/commands/index.ts',
                )
                void commands[command].execute()
            },
            { type, command, count },
        )
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        show(fixtures.events)
    })
    const start = await steps()
    await flip('bpm')
    await expect(page.locator('.notification')).toHaveText('No change')
    expect(await steps()).toBe(start)
    // Flipping one object vertically moves nothing either.
    await flip('cameraEventJoint', 'flipVertical', 1)
    await expect(page.locator('.notification')).toHaveText('No change')
    expect(await steps()).toBe(start)
    await flip('cameraEventJoint')
    await expect(page.locator('.notification')).not.toHaveText('No change')
    expect(await steps()).toBe(start + 1)
})

for (const tick of [false, true])
    test(`a Beat edit of the initial BPM with ${tick ? 'an attached note' : 'a note'} keeps a BPM at 0`, async ({
        page,
    }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        const result = await page.evaluate(async (tick) => {
            const { fixtures, show, history, appImport } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            const note = (beat: number, left: number, isAttached = false) => ({
                ...base,
                beat,
                left,
                size: 2,
                isAttached,
            })
            show(
                {
                    ...fixtures.interaction,
                    bpms: [{ beat: 0, bpm: 120 }],
                    slides: [tick ? [note(0, -4), note(2, 0, true), note(6, 4)] : [note(6, 0)]],
                },
                1,
            )
            const state = history.state.value
            const bpm = [...state.store.grid.bpm.get(0)!].find((entity) => entity.beat === 0)!
            const last = [...state.store.slides.note.values()].flat().at(-1)!
            history.replaceState({ ...state, selectedEntities: [bpm, last] })
            const { planEdit } = await appImport<
                typeof import('../../src/state/operations/properties/plan')
            >('/src/state/operations/properties/plan.ts')
            const { editSelectedEditableEntities } = await appImport<
                typeof import('../../src/editor/sidebars/default')
            >('/src/editor/sidebars/default/index.ts')
            // The live preview runs the same plan with preview options.
            const preview = planEdit(
                history.state.value,
                [bpm, last],
                { beat: 4 },
                {
                    autoAddGroup: false,
                },
            ).state
            editSelectedEditableEntities({ beat: 4 })
            const beats = (bpms: { x: number }[]) => bpms.map((integral) => integral.x)
            return { preview: beats(preview.bpms), commit: beats(history.state.value.bpms) }
        }, tick)
        expect(result).toEqual({ preview: [0, 4], commit: [0, 4] })
        expect(errors).toEqual([])
    })

test('an edit looks up the changed objects in linear time', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { fixtures, show, history, appImport } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const count = 2000
        show(
            {
                ...fixtures.interaction,
                slides: Array.from({ length: count }, (_, beat) => [
                    { ...base, beat, isAttached: false, isCritical: false },
                ]),
            },
            1,
        )
        const { planEdit } = await appImport<
            typeof import('../../src/state/operations/properties/plan')
        >('/src/state/operations/properties/plan.ts')
        const state = history.state.value
        const selected = [...state.store.slides.note.values()].flat()
        // Counts the elements every Array#includes scans.
        const includes = Array.prototype.includes
        let scanned = 0
        Array.prototype.includes = function (this: unknown[], ...args) {
            scanned += this.length
            return includes.apply(this, args as never)
        }
        try {
            const { changed } = planEdit(state, selected, { isCritical: true })
            return { changed: changed.length, linear: scanned < count * 20, scanned }
        } finally {
            Array.prototype.includes = includes
        }
    })
    expect(result).toMatchObject({ changed: 2000, linear: true })
})

test('a beat past the range Scale Selection keeps to is refused like an out-of-range value', async ({
    page,
}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await showSlides(page, [[{ beat: 2 }, { beat: 4 }]])
    await page.evaluate(() => {
        const { history, settings } = window.editorTest
        settings.showSidebar = true
        const state = history.state.value
        const tail = [...state.store.slides.note.values()].flat().find((note) => note.beat === 4)!
        history.replaceState({ ...state, selectedEntities: [tail] })
    })
    const tailBeats = () =>
        page.evaluate(() =>
            window.editorTest
                .snapshot()
                .notes.map((note) => note.beat)
                .sort((a, b) => a - b),
        )
    const beat = page.getByLabel('Beat', { exact: true })
    await expect(beat).toHaveValue('5')
    // About 1.5 million grid cells for the slide, past the million Scale Selection allows.
    await beat.fill('1500002')
    await beat.press('Enter')
    await expect(beat).toHaveValue('5')
    expect(await tailBeats()).toEqual([2, 4])
    // Edits made without the field are refused too.
    await page.evaluate(async () => {
        const { editSelectedEditableEntities } = await window.editorTest.appImport<
            typeof import('../../src/editor/sidebars/default')
        >('/src/editor/sidebars/default/index.ts')
        editSelectedEditableEntities({ beat: 1500001 })
    })
    expect(await tailBeats()).toEqual([2, 4])
    await beat.fill('9')
    await beat.press('Enter')
    expect(await tailBeats()).toEqual([2, 8])
    expect(errors).toEqual([])
})
