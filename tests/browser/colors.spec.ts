import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('all note colors and connector families survive level data round trips and legacy imports', async ({
    page,
}) => {
    const result = await page.evaluate(async () => {
        const { serializeToLevelDataEntities } =
            await import('/src/levelData/entities/serialize/index.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const { createState } = await import('/src/state/index.ts')
        const { buildPreviewChart } = await import('/src/preview/engine/chart.ts')
        const styles = [
            'default',
            'neutral',
            'red',
            'green',
            'blue',
            'yellow',
            'purple',
            'cyan',
            'black',
        ] as const
        const source = window.editorTest.fixtures.interaction
        const base = source.slides[0]![0]!
        const slides = []
        const expected = []
        for (const connectorType of ['active', 'damage', 'guide'] as const) {
            for (const connectorActiveIsCritical of connectorType === 'active'
                ? [false, true]
                : [false]) {
                for (const connectorIsFake of connectorType === 'guide' ? [false] : [false, true]) {
                    for (const style of styles) {
                        const properties = {
                            noteStyle: style,
                            connectorStyle: style,
                            connectorType,
                            connectorActiveIsCritical,
                            connectorIsFake,
                        }
                        slides.push([
                            { ...base, ...properties, beat: 0 },
                            { ...base, ...properties, beat: 4 },
                        ])
                        expected.push({
                            ...properties,
                            connectorStyle:
                                connectorType === 'guide' && style === 'default' ? 'green' : style,
                        })
                    }
                }
            }
        }
        const serialize = (state: ReturnType<typeof createState>) =>
            serializeToLevelDataEntities(
                state.initialLife,
                state.isDynamicStages,
                state.store,
                state.groups,
                state.stages,
            )
        const first = serialize(createState({ ...source, slides }, 0))
        const imported = parseLevelDataChart(first)
        const actual = imported.slides.map(([head]: (typeof source.slides)[number]) => ({
            noteStyle: head!.noteStyle,
            connectorStyle: head!.connectorStyle,
            connectorType: head!.connectorType,
            connectorActiveIsCritical: head!.connectorActiveIsCritical,
            connectorIsFake: head!.connectorIsFake,
        }))
        const second = serialize(createState(imported, 0))
        const noteValues = (entities: typeof first) =>
            entities
                .filter(
                    (entity) =>
                        entity.archetype.endsWith('Note') &&
                        !entity.archetype.startsWith('Transient'),
                )
                .map((entity) =>
                    entity.data.filter((data) => ['style', 'segmentKind'].includes(data.name)),
                )
        const preview = buildPreviewChart(createState(imported, 0), 10)
        const legacy = parseLevelDataChart(
            first.map((entity) => ({
                ...entity,
                data: entity.data.filter((data) => data.name !== 'style'),
            })),
        )
        return {
            expected,
            actual,
            first: noteValues(first),
            second: noteValues(second),
            legacyDefault: legacy.slides.every((slide) =>
                slide.every((note) => note.noteStyle === 'default'),
            ),
            previewStyles: preview.connectors.map((connector) => connector.style),
        }
    })
    expect(result.actual).toEqual(result.expected)
    expect(result.second).toEqual(result.first)
    expect(result.legacyDefault).toBe(true)
    expect(result.previewStyles).toEqual(result.expected.map((note) => note.connectorStyle))
})

test('color controls commit, undo, and persist in creation presets', async ({ page }) => {
    await page.evaluate(async () => {
        const { history, settings } = window.editorTest
        const source = window.editorTest.fixtures.interaction
        const head = { ...source.slides[0]![0]!, beat: 1 }
        window.editorTest.show({ ...source, slides: [[head, { ...head, beat: 4 }]] })
        settings.showSidebar = true
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()][0]!.slice(0, 1),
        })
        await window.editorTest.nextTick()
    })
    await page.getByRole('combobox', { name: 'Note Color', exact: true }).selectOption('blue')
    await page
        .getByRole('combobox', { name: 'Connector Color', exact: true })
        .selectOption('purple')
    const colors = () =>
        page.evaluate(() => {
            const head = [
                ...window.editorTest.history.state.value.store.slides.note.values(),
            ][0]![0]!
            return [head.noteStyle, head.connectorStyle]
        })
    expect(await colors()).toEqual(['blue', 'purple'])
    await page.evaluate(() => window.editorTest.history.undoState())
    expect(await colors()).toEqual(['blue', 'default'])
    await page.evaluate(() => window.editorTest.history.redoState())
    expect(await colors()).toEqual(['blue', 'purple'])
    await page.evaluate(() => {
        const s = window.editorTest.settings
        s.defaultNotePropertiesPresets = s.defaultNotePropertiesPresets.map((preset, i) =>
            i === 0 ? { ...preset, noteStyle: 'cyan', connectorStyle: 'black' } : preset,
        )
    })
    await expect(
        page
            .getByRole('button', { name: 'Switch to Note tool', exact: true })
            .locator('svg rect')
            .first(),
    ).toHaveCSS('fill', 'rgb(223, 250, 255)')
    await page.reload()
    await page.evaluate(installEditorFixture)
    expect(
        await page.evaluate(() => window.editorTest.settings.defaultNotePropertiesPresets[0]),
    ).toMatchObject({ noteStyle: 'cyan', connectorStyle: 'black' })
})

test('guides share the connector color control across type changes and undo', async ({ page }) => {
    await page.evaluate(() => {
        const { history, settings, fixtures, show } = window.editorTest
        const head = {
            ...fixtures.interaction.slides[0]![0]!,
            beat: 1,
            connectorType: 'guide' as const,
        }
        show({ ...fixtures.interaction, slides: [[head, { ...head, beat: 4 }]] })
        settings.showSidebar = true
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...history.state.value.store.slides.note.values()][0]!.slice(0, 1),
        })
    })
    const color = page.getByRole('combobox', { name: 'Connector Color', exact: true })
    await expect(color).toHaveCount(1)
    await expect(color).toHaveValue('default')
    await expect(page.getByRole('combobox', { name: 'Guide Color', exact: true })).toHaveCount(0)
    const rendered = () =>
        page.evaluate(async () => {
            const { buildPreviewChart } = await import('/src/preview/engine/chart.ts')
            const { connectorKindValue } = await import('/src/chart/noteStyle.ts')
            const state = window.editorTest.history.state.value
            const head = [...state.store.slides.note.values()][0]![0]!
            const preview = buildPreviewChart(state, 10)
            return {
                style: head.connectorStyle,
                exportedKind: connectorKindValue(head),
                previewKind: preview.connectors[0]!.kind,
            }
        })
    expect(await rendered()).toMatchObject({ style: 'default', exportedKind: 103 })
    const defaultKind = (await rendered()).previewKind
    await color.selectOption('green')
    expect((await rendered()).previewKind).toBe(defaultKind)
    await color.selectOption('blue')
    expect(await rendered()).toMatchObject({ style: 'blue', exportedKind: 104 })
    expect((await rendered()).previewKind).not.toBe(defaultKind)
    await page.getByRole('combobox', { name: 'Connector Type', exact: true }).selectOption('active')
    await expect(color).toHaveValue('blue')
    expect((await rendered()).exportedKind).toBe(14)
    await page.getByRole('combobox', { name: 'Connector Type', exact: true }).selectOption('guide')
    await expect(color).toHaveValue('blue')
    expect((await rendered()).exportedKind).toBe(104)
    await page.evaluate(() => window.editorTest.history.undoState())
    expect((await rendered()).exportedKind).toBe(14)
    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(color).toHaveValue('blue')
    expect((await rendered()).exportedKind).toBe(104)
    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(color).toHaveValue('green')
    await page.evaluate(() => window.editorTest.history.undoState())
    await expect(color).toHaveValue('default')
})

test('legacy guide presets migrate into the shared color and retain their icons after reload', async ({
    page,
}) => {
    await page.evaluate(() => {
        const legacy = [
            { connectorType: 'guide', connectorGuideColor: 'purple', connectorStyle: 'blue' },
            { connectorType: 'active', connectorGuideColor: 'red', connectorStyle: 'cyan' },
            { connectorGuideColor: 'yellow' },
            { connectorGuideColor: 'yellow', connectorStyle: 'red' },
            { connectorType: 'guide', connectorGuideColor: 'invalid', connectorStyle: 'black' },
        ].map((properties) => ({ ...properties, copyProperties: true }))
        localStorage.setItem(
            'sonolus-next-sekai-editor.defaultSlidePropertiesPresets',
            JSON.stringify(legacy),
        )
        localStorage.setItem(
            'sonolus-next-sekai-editor.defaultNotePropertiesPresets',
            JSON.stringify(legacy.slice(0, 4)),
        )
    })
    await page.reload()
    await page.evaluate(installEditorFixture)
    const migrated = await page.evaluate(() => {
        const { settings } = window.editorTest
        const slides = settings.defaultSlidePropertiesPresets
        const notes = settings.defaultNotePropertiesPresets
        // Persist via the normal settings setter, then verify the next reload.
        settings.defaultSlidePropertiesPresets = [...slides]
        settings.defaultNotePropertiesPresets = [...notes]
        return { slides, notes }
    })
    expect(migrated.slides.map((preset) => preset.connectorStyle)).toEqual([
        'purple',
        'cyan',
        'yellow',
        'red',
        'black',
    ])
    expect(migrated.notes.map((preset) => preset.connectorStyle)).toEqual([
        'purple',
        'cyan',
        'yellow',
        'red',
    ])
    expect(JSON.stringify(migrated)).not.toContain('connectorGuideColor')
    await expect(
        page
            .getByRole('button', { name: 'Switch to Slide tool', exact: true })
            .locator('svg rect')
            .first(),
    ).toHaveCSS('fill', 'rgb(214, 115, 205)')
    await page.reload()
    await page.evaluate(installEditorFixture)
    expect(
        await page.evaluate(() => ({
            slides: window.editorTest.settings.defaultSlidePropertiesPresets,
            notes: window.editorTest.settings.defaultNotePropertiesPresets,
        })),
    ).toEqual(migrated)
})

test('USC and SUS imports retain explicit guide colors in the unified field', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { parseUscChart } = await import('/src/chart/parse/usc/index.ts')
        const { parseSusChart } = await import('/src/chart/parse/sus/index.ts')
        const { noteStyles, connectorKindValue } = await import('/src/chart/noteStyle.ts')
        const usc = parseUscChart(
            noteStyles
                .filter((color) => color !== 'default')
                .map((color) => ({
                    type: 'guide',
                    color,
                    fade: 'none',
                    midpoints: [0, 4].map((beat) => ({
                        beat,
                        timeScaleGroup: 0,
                        lane: 0,
                        size: 1,
                        ease: 'linear',
                    })),
                })),
        )
        const sus = parseSusChart({
            offset: 0,
            ticksPerBeat: 480,
            bpmChanges: [{ tick: 0, bpm: 120 }],
            timeScaleChanges: [],
            directionalNotes: [],
            tapNotes: [{ tick: 0, lane: 4, width: 2, type: 2 }],
            slides: [2, 4, 6].map((lane, index) => ({
                type: index === 2 ? 3 : 9,
                notes: [
                    { tick: 0, lane, width: 2, type: 1 },
                    { tick: 1920, lane, width: 2, type: 2 },
                ],
            })),
        })
        return {
            usc: usc.slides.map(([head]) => ({
                style: head!.connectorStyle,
                kind: connectorKindValue(head!),
            })),
            sus: sus.slides
                .filter((slide) => slide.length > 1)
                .map(([head]) => ({
                    style: head!.connectorStyle,
                    kind: connectorKindValue(head!),
                })),
        }
    })
    expect(result.usc.map(({ style }) => style)).toEqual([
        'neutral',
        'red',
        'green',
        'blue',
        'yellow',
        'purple',
        'cyan',
        'black',
    ])
    expect(result.usc.map(({ kind }) => kind)).toEqual([101, 102, 103, 104, 105, 106, 107, 108])
    expect(result.sus).toEqual([
        { style: 'green', kind: 103 },
        { style: 'yellow', kind: 105 },
        { style: 'default', kind: 1 },
    ])
})

for (const command of ['copy', 'cut'] as const) {
    test(`${command} and paste preserve Default separately from explicit guide colors`, async ({
        page,
        context,
    }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.evaluate(() => {
            const { history, fixtures, show } = window.editorTest
            const base = fixtures.interaction.slides[0]![0]!
            show(
                {
                    ...fixtures.interaction,
                    slides: (['default', 'green', 'blue'] as const).map((connectorStyle, index) =>
                        [1, 2].map((beat) => ({
                            ...base,
                            connectorType: 'guide',
                            connectorStyle,
                            left: index * 4 - 4,
                            beat,
                        })),
                    ),
                },
                2,
            )
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...history.state.value.store.slides.note.values()].flat(),
            })
        })
        // Cut anchors to the pointer, so start at the first beat before moving
        // to the paste destination.
        const source = await page.evaluate(() => window.editorTest.point(0, 1))
        await page.mouse.move(source.x, source.y)
        await page.keyboard.press(command === 'copy' ? 'c' : 'x')
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const { clipboardEntry } = await import('/src/clipboard/index.ts')
                    return clipboardEntry.value?.data?.chart.slides
                        .flat()
                        .map((note) => note.connectorStyle)
                }),
            )
            .toEqual(['default', 'default', 'green', 'green', 'blue', 'blue'])
        const clipboard = await page.evaluate(
            async () =>
                JSON.parse(await navigator.clipboard.readText()) as {
                    defaultGuideColors: number[]
                },
        )
        expect(clipboard.defaultGuideColors).toHaveLength(2)
        await page.keyboard.press('v')
        const target = await page.evaluate(() => window.editorTest.point(0, 10))
        await page.mouse.click(target.x, target.y)
        await expect
            .poll(() =>
                page.evaluate(() =>
                    window.editorTest.history.state.value.selectedEntities
                        .filter((entity) => entity.type === 'note')
                        .sort((a, b) => a.left - b.left || a.beat - b.beat)
                        .map((note) => note.connectorStyle),
                ),
            )
            .toEqual(['default', 'default', 'green', 'green', 'blue', 'blue'])
        expect(
            await page.evaluate(
                () =>
                    [...window.editorTest.history.state.value.store.slides.note.values()].flat()
                        .length,
            ),
        ).toBe(command === 'copy' ? 12 : 6)
    })
}
