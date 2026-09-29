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
        ]
        const source = window.editorTest.fixtures.interaction
        const base = source.slides[0]![0]!
        const slides = []
        const expected = []
        for (const connectorType of ['active', 'damage']) {
            for (const connectorActiveIsCritical of connectorType === 'active'
                ? [false, true]
                : [false]) {
                for (const connectorIsFake of [false, true]) {
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
                        expected.push(properties)
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
