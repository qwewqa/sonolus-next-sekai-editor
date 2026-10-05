import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Ease } from '../../src/ease'
import { easeGlyphPathD } from '../../src/easeGlyph'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const field = (page: Page, label: string) =>
    panel(page)
        .locator('label')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('select')
const selected = (select: Locator) =>
    select.evaluate((element: HTMLSelectElement) => element.selectedOptions[0]?.textContent?.trim())

const showSlides = (page: Page, eases: Ease[]) =>
    page.evaluate(async (eases) => {
        const { fixtures, show, history, store, nextTick } = window.editorTest

        const template = fixtures.interaction.slides.flat()[0]!
        const note = (beat: number, left: number, connectorEase: Ease = 'linear') => ({
            ...template,
            beat,
            left,
            size: 2,
            isAttached: false,
            isConnectorSeparator: false,
            noteType: 'default' as const,
            connectorType: 'active' as const,
            connectorEase,
        })
        show(
            {
                ...fixtures.interaction,
                slides: eases.map((ease, index) => [
                    note(index * 2, -4 + index * 3, ease),
                    note(index * 2 + 1, -3 + index * 3),
                ]),
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' && entity.beat % 2 === 0,
            ),
        })
        await nextTick()
    }, eases)

const heads = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .flatMap((entity) =>
                entity.type === 'note' && entity.beat % 2 === 0
                    ? [[entity.beat, entity.connectorEase] as const]
                    : [],
            )
            .sort((a, b) => a[0] - b[0])
            .map(([, ease]) => ease),
    )

test.describe('ease fields', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(installCanvasCounters)
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.evaluate(() => {
            window.editorTest.settings.showSidebar = true
            window.editorTest.settings.propertiesConnectorExpanded = true
        })
        await expect(panel(page)).toBeVisible()
    })

    test('easing and mode change independently, and linear has no mode', async ({ page }) => {
        await showSlides(page, ['outSine'])
        const family = field(page, 'Connector Ease')
        const mode = field(page, 'Connector Ease Mode')
        await expect.poll(() => selected(family)).toBe('Sine')
        await expect.poll(() => selected(mode)).toBe('Out')

        await family.selectOption({ label: 'Cubic' })
        expect(await heads(page)).toEqual(['outCubic'])
        await mode.selectOption({ label: 'In-Out' })
        expect(await heads(page)).toEqual(['inOutCubic'])

        await family.selectOption({ label: 'Linear' })
        expect(await heads(page)).toEqual(['linear'])
        await expect(mode).toBeDisabled()
        await expect.poll(() => selected(mode)).toBe('—')

        await family.selectOption({ label: 'Step' })
        expect(await heads(page)).toEqual(['inStep'])
        await expect(mode).toBeEnabled()
    })

    test('multiple selections keep each mode or family when only the other changes', async ({
        page,
    }) => {
        await showSlides(page, ['outSine', 'inQuad', 'outInQuad'])
        const family = field(page, 'Connector Ease')
        const mode = field(page, 'Connector Ease Mode')
        await expect.poll(() => selected(family)).toBe('Mixed')
        await expect.poll(() => selected(mode)).toBe('Mixed')

        // Mixed options carry counts, so they are chosen by value.
        await family.selectOption('elastic')
        expect(await heads(page)).toEqual(['outElastic', 'inElastic', 'outInElastic'])
        await expect.poll(() => selected(family)).toBe('Elastic')
        await expect.poll(() => selected(mode)).toBe('Mixed')

        await mode.selectOption('out')
        expect(await heads(page)).toEqual(['outElastic', 'outElastic', 'outElastic'])
    })

    test('a shared mode survives a family change across linear connectors', async ({ page }) => {
        await showSlides(page, ['outSine', 'linear', 'outQuad'])
        const family = field(page, 'Connector Ease')
        const mode = field(page, 'Connector Ease Mode')
        await expect.poll(() => selected(family)).toBe('Mixed')
        await expect.poll(() => selected(mode)).toBe('Out')
        await mode.selectOption({ label: 'Out-In' })
        expect(await heads(page)).toEqual(['outInSine', 'linear', 'outInQuad'])
        await family.selectOption('circ')
        expect(await heads(page)).toEqual(['outInCirc', 'outInCirc', 'outInCirc'])
    })

    test('the easing selector shows the curve of a complete ease', async ({ page }) => {
        const icon = panel(page)
            .locator('label')
            .filter({ has: page.getByText('Connector Ease', { exact: true }) })
            .locator('.form-field-select-lead path')
        await showSlides(page, ['outSine'])
        await expect(icon).toHaveAttribute('d', easeGlyphPathD('outSine', false, 2, 2, 12, 12))

        await field(page, 'Connector Ease Mode').selectOption({ label: 'In-Out' })
        await expect(icon).toHaveAttribute('d', easeGlyphPathD('inOutSine', false, 2, 2, 12, 12))
        await field(page, 'Connector Ease').selectOption({ label: 'Linear' })
        await expect(icon).toHaveAttribute('d', 'M 2 14 L 14 2')

        // A mixed half leaves no curve to show.
        await showSlides(page, ['outSine', 'inQuad'])
        await expect(icon).toHaveCount(0)
    })

    test('time scales offer step first and no overshooting eases', async ({ page }) => {
        await page.evaluate(async () => {
            const { fixtures, show, history, store, nextTick } = window.editorTest
            show(fixtures.events)
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...store.getAllEntities()].filter(
                    (entity) => entity.type === 'timeScale',
                ),
            })
            await nextTick()
        })
        const family = field(page, 'Ease')
        await expect(family).toBeVisible()
        const labels = await family.locator('option:not([hidden])').allTextContents()
        // Options in use while mixed end in their counts.
        expect(labels.map((label) => label.trim().replace(/ · \d+$/, ''))).toEqual([
            'Step',
            'Linear',
            'Sine',
            'Quad',
            'Cubic',
            'Quart',
            'Quint',
            'Expo',
            'Circ',
        ])
    })

    test('brushes can set only the easing or only the mode', async ({ page }) => {
        await showSlides(page, ['outSine', 'inQuad'])
        const result = await page.evaluate(async () => {
            // Live module URLs, so state-owning modules are not imported twice.
            const appImport = <T>(pathname: string): Promise<T> =>
                import(
                    performance
                        .getEntriesByType('resource')
                        .map((entry) => entry.name)
                        .find((name) => new URL(name).pathname === pathname) ?? pathname
                )
            const brush = await appImport<typeof import('../../src/editor/tools/brush')>(
                '/src/editor/tools/brush/index.ts',
            )
            const { history } = window.editorTest
            const heads = () =>
                history.state.value.selectedEntities.flatMap((entity) =>
                    entity.type === 'note' ? [entity.connectorEase] : [],
                )
            brush.brushProperties.value = { connectorEase: 'family:back' }
            brush.applyBrushToEntities(history.state.value.selectedEntities)
            const family = heads()
            brush.brushProperties.value = { connectorEase: 'mode:inOut' }
            brush.applyBrushToEntities(history.state.value.selectedEntities)
            return { family, mode: heads() }
        })
        expect(result.family.sort()).toEqual(['inBack', 'outBack'])
        expect(result.mode).toEqual(['inOutBack', 'inOutBack'])
    })
})

test('every ease round trips through level data, and legacy NONE reads as a step in', async ({
    page,
}) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    const result = await page.evaluate(async () => {
        // Live module URLs, so state-owning modules are not imported twice.
        const appImport = <T>(pathname: string): Promise<T> =>
            import(
                performance
                    .getEntriesByType('resource')
                    .map((entry) => entry.name)
                    .find((name) => new URL(name).pathname === pathname) ?? pathname
            )
        const { eases } = await appImport<typeof import('../../src/ease')>('/src/ease.ts')
        const { parseLevelDataChart } = await appImport<
            typeof import('../../src/chart/parse/levelData')
        >('/src/chart/parse/levelData/index.ts')
        const { serializeToLevelData } = await appImport<
            typeof import('../../src/levelData/serialize')
        >('/src/levelData/serialize.ts')
        const { createState } =
            await appImport<typeof import('../../src/state')>('/src/state/index.ts')
        const timeScaleEases = eases.filter(
            (ease) => !ease.endsWith('Back') && !ease.endsWith('Elastic'),
        ) as import('../../src/ease').TimeScaleEase[]
        const note = (beat: number, connectorEase: Ease = 'linear') => ({
            groupId: 1 as never,
            stageId: 1 as never,
            beat,
            noteType: 'default' as const,
            isAttached: false,
            left: -1,
            size: 2,
            isCritical: false,
            flickDirection: 'none' as const,
            isFake: false,
            noteStyle: 'default' as const,
            connectorStyle: 'default' as const,
            sfx: 'default' as const,
            isConnectorSeparator: false,
            connectorType: 'active' as const,
            connectorEase,
            connectorIsFake: false,
            connectorActiveIsCritical: false,
            connectorGuideAlpha: 1,
            connectorLayer: 'top' as const,
            connectorIsPassThrough: false,
            connectorPresentation: 'default' as const,
        })
        const state = createState(
            {
                initialLife: 1000,
                isDynamicStages: true,
                bpms: [{ beat: 0, bpm: 120 }],
                groups: new Map([[1 as never, { name: 'A' }]]),
                stages: new Map([
                    [
                        1 as never,
                        {
                            name: 'S',
                            isFromStart: true,
                            isUntilEnd: true,
                            generateSimLines: 'global' as const,
                        },
                    ],
                ]),
                cameraEvents: eases.map((eventEase, index) => ({
                    beat: index,
                    cameraLeft: -6,
                    cameraSize: 12,
                    cameraZoom: 1,
                    cameraZoomTargetLane: 0,
                    cameraZoomTargetY: 0,
                    cameraZoomVerticalAlign: 'center' as const,
                    cameraRotation: 0,
                    cameraStageTilt: 1,
                    eventEase,
                })),
                stageMaskEvents: [],
                stagePivotEvents: [],
                stageStyleEvents: [],
                stageTransformEvents: [],
                timeScales: timeScaleEases.map((timeScaleEase, index) => ({
                    groupId: 1 as never,
                    beat: index,
                    editorLane: -6,
                    timeScale: 1,
                    skip: 0,
                    timeScaleEase,
                    timeScaleTransition: 'timeScale' as const,
                    hideNotes: false,
                })),
                slides: eases.map((ease, index) => [note(index * 2, ease), note(index * 2 + 1)]),
            },
            0,
        )
        const serialize = (source: typeof state) =>
            serializeToLevelData(
                source.initialLife,
                source.isDynamicStages,
                0,
                source.store,
                source.groups,
                source.stages,
            ).entities
        const values = (entities: ReturnType<typeof serialize>, name: string) =>
            entities.flatMap((entity) =>
                entity.data.flatMap((data) =>
                    data.name === name && 'value' in data ? [data] : [],
                ),
            )
        const entities = serialize(state)
        const parsed = parseLevelDataChart(entities)
        const written = {
            connector: [...new Set(values(entities, 'connectorEase').map((d) => d.value))],
            event: [...new Set(values(entities, 'ease').map((d) => d.value))],
            timeScale: [...new Set(values(entities, '#TIMESCALE_EASE').map((d) => d.value))],
        }
        const read = {
            connector: parsed.slides.map((slide) => slide[0]?.connectorEase),
            event: parsed.cameraEvents.map((event) => event.eventEase),
            timeScale: parsed.timeScales.map((timeScale) => timeScale.timeScaleEase),
        }
        for (const name of ['connectorEase', 'ease', '#TIMESCALE_EASE'])
            for (const data of values(entities, name)) if (data.value === 38) data.value = 0
        const legacy = parseLevelDataChart(entities)
        const rejected = [30, 37, 42].map((value) => {
            const copy = structuredClone(entities)

            values(copy, '#TIMESCALE_EASE')[0]!.value = value
            try {
                parseLevelDataChart(copy)
                return false
            } catch {
                return true
            }
        })
        return {
            eases,
            timeScaleEases,
            written,
            read,
            legacy: {
                connector: legacy.slides.map((slide) => slide[0]?.connectorEase),
                event: legacy.cameraEvents.map((event) => event.eventEase),
                timeScale: legacy.timeScales.map((timeScale) => timeScale.timeScaleEase),
            },
            rejected,
        }
    })

    const sorted = <T>(values: T[]) => [...values].sort()
    const range = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, index) => from + index)
    expect(sorted(result.written.connector)).toEqual(sorted(range(1, 41)))
    expect(sorted(result.written.event)).toEqual(sorted(range(1, 41)))
    expect(sorted(result.written.timeScale)).toEqual(sorted([...range(1, 29), ...range(38, 41)]))
    expect(sorted(result.read.connector)).toEqual(sorted(result.eases))
    expect(sorted(result.read.event)).toEqual(sorted(result.eases))
    expect(sorted(result.read.timeScale)).toEqual(sorted(result.timeScaleEases))
    expect(result.legacy).toEqual(result.read)
    expect(result.rejected).toEqual([true, true, true])
})

test('saved presets with legacy eases migrate without losing other properties', async ({
    page,
}) => {
    await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return
        sessionStorage.setItem('seeded', '1')
        localStorage.setItem(
            'sonolus-next-sekai-editor.defaultSlidePropertiesPresets',
            JSON.stringify([
                { connectorEase: 'in', isCritical: true, copyProperties: false },
                { connectorEase: 'none', noteType: 'trace', copyProperties: true },
                { connectorEase: 'outIn', flickDirection: 'up', copyProperties: true },
                { connectorEase: 'out', copyProperties: true },
                { connectorEase: 'inOut', noteType: 'anchor', copyProperties: true },
            ]),
        )
        localStorage.setItem(
            'sonolus-next-sekai-editor.defaultNotePropertiesPresets',
            JSON.stringify([
                { connectorEase: 'linear', copyProperties: true },
                { connectorEase: 'family:sine', isCritical: true, copyProperties: true },
                { connectorEase: 'mode:out', copyProperties: true },
                { connectorEase: 'inOutElastic', noteType: 'trace', copyProperties: true },
            ]),
        )
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const presets = await page.evaluate(() => ({
        slide: window.editorTest.settings.defaultSlidePropertiesPresets,
        note: window.editorTest.settings.defaultNotePropertiesPresets,
    }))
    expect(presets.slide).toEqual([
        { connectorEase: 'inQuad', isCritical: true, copyProperties: false },
        { connectorEase: 'inStep', noteType: 'trace', copyProperties: true },
        { connectorEase: 'outInQuad', flickDirection: 'up', copyProperties: true },
        { connectorEase: 'outQuad', copyProperties: true },
        { connectorEase: 'inOutQuad', noteType: 'anchor', copyProperties: true },
    ])
    expect(presets.note).toEqual([
        { connectorEase: 'linear', copyProperties: true },
        { connectorEase: 'family:sine', isCritical: true, copyProperties: true },
        { connectorEase: 'mode:out', copyProperties: true },
        { connectorEase: 'inOutElastic', noteType: 'trace', copyProperties: true },
    ])
})
