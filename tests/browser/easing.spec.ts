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

    test('type and function change independently, and None and Linear have no function', async ({
        page,
    }) => {
        await showSlides(page, ['outSine'])
        const type = field(page, 'Ease Type')
        const name = field(page, 'Ease Function')
        await expect.poll(() => selected(type)).toBe('Out')
        await expect.poll(() => selected(name)).toBe('Sine')

        await name.selectOption({ label: 'Cubic' })
        expect(await heads(page)).toEqual(['outCubic'])
        await type.selectOption({ label: 'In-Out' })
        expect(await heads(page)).toEqual(['inOutCubic'])

        await type.selectOption({ label: 'Linear' })
        expect(await heads(page)).toEqual(['linear'])
        await expect(name).toBeDisabled()
        await expect.poll(() => selected(name)).toBe('—')

        // A mode after Linear or None starts from Quad.
        await type.selectOption({ label: 'Out' })
        expect(await heads(page)).toEqual(['outQuad'])
        await expect(name).toBeEnabled()

        await type.selectOption({ label: 'None' })
        expect(await heads(page)).toEqual(['none'])
        await expect(name).toBeDisabled()
        await expect.poll(() => selected(name)).toBe('—')

        // In Step stays apart from None.
        await type.selectOption({ label: 'In' })
        await name.selectOption({ label: 'Step' })
        expect(await heads(page)).toEqual(['inStep'])
        await expect.poll(() => selected(type)).toBe('In')
        await expect.poll(() => selected(name)).toBe('Step')
    })

    test('multiple selections keep each type or function when only the other changes', async ({
        page,
    }) => {
        await showSlides(page, ['outSine', 'inQuad', 'outInQuad'])
        const type = field(page, 'Ease Type')
        const name = field(page, 'Ease Function')
        await expect.poll(() => selected(type)).toBe('Mixed')
        await expect.poll(() => selected(name)).toBe('Mixed')

        // Mixed options carry counts, so they are chosen by value.
        await name.selectOption('elastic')
        expect(await heads(page)).toEqual(['outElastic', 'inElastic', 'outInElastic'])
        await expect.poll(() => selected(name)).toBe('Elastic')
        await expect.poll(() => selected(type)).toBe('Mixed')

        await type.selectOption('out')
        expect(await heads(page)).toEqual(['outElastic', 'outElastic', 'outElastic'])
    })

    test('a type alone gives None and Linear Quad, a function alone skips them', async ({
        page,
    }) => {
        await showSlides(page, ['outSine', 'linear', 'none', 'inCubic'])
        const type = field(page, 'Ease Type')
        const name = field(page, 'Ease Function')
        await expect.poll(() => selected(type)).toBe('Mixed')
        await expect.poll(() => selected(name)).toBe('Mixed')
        await name.selectOption('circ')
        expect(await heads(page)).toEqual(['outCirc', 'linear', 'none', 'inCirc'])
        await expect.poll(() => selected(name)).toBe('Circ')

        await showSlides(page, ['outSine', 'linear', 'none', 'inCubic'])
        await type.selectOption('outIn')
        expect(await heads(page)).toEqual(['outInSine', 'outInQuad', 'outInQuad', 'outInCubic'])
    })

    test('a shared function survives a type change across None and Linear', async ({ page }) => {
        await showSlides(page, ['outSine', 'linear', 'none', 'inSine'])
        const type = field(page, 'Ease Type')
        const name = field(page, 'Ease Function')
        await expect.poll(() => selected(type)).toBe('Mixed')
        await expect.poll(() => selected(name)).toBe('Sine')
        await type.selectOption('outIn')
        expect(await heads(page)).toEqual(['outInSine', 'outInSine', 'outInSine', 'outInSine'])
    })

    test('the function is off while every selected ease is None or Linear', async ({ page }) => {
        await showSlides(page, ['none', 'linear', 'none'])
        const type = field(page, 'Ease Type')
        const name = field(page, 'Ease Function')
        await expect.poll(() => selected(type)).toBe('Mixed')
        await expect(name).toBeDisabled()
        await expect.poll(() => selected(name)).toBe('—')
    })

    test('the type selector shows the curve of a complete ease', async ({ page }) => {
        const icon = panel(page)
            .locator('label')
            .filter({ has: page.getByText('Ease Type', { exact: true }) })
            .locator('.form-field-select-lead path')
        await showSlides(page, ['outSine'])
        await expect(icon).toHaveAttribute('d', easeGlyphPathD('outSine', false, 2, 2, 12, 12))
        // Only the type select carries the glyph.
        await expect(
            panel(page)
                .locator('label')
                .filter({ has: page.getByText('Ease Function', { exact: true }) })
                .locator('.form-field-select-lead path'),
        ).toHaveCount(0)

        await field(page, 'Ease Type').selectOption({ label: 'In-Out' })
        await expect(icon).toHaveAttribute('d', easeGlyphPathD('inOutSine', false, 2, 2, 12, 12))
        await field(page, 'Ease Type').selectOption({ label: 'Linear' })
        await expect(icon).toHaveAttribute('d', 'M 2 14 L 14 2')
        await field(page, 'Ease Type').selectOption({ label: 'None' })
        await expect(icon).toHaveAttribute('d', easeGlyphPathD('inStep', false, 2, 2, 12, 12))

        // A mixed half leaves no curve to show.
        await showSlides(page, ['outSine', 'inQuad'])
        await expect(icon).toHaveCount(0)
    })

    test('time scales list Step last and no overshooting functions', async ({ page }) => {
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
        const labels = async (label: string) => {
            const select = field(page, label)
            await expect(select).toBeVisible()
            // Options in use while mixed end in their counts.
            return (await select.locator('option:not([hidden])').allTextContents()).map((text) =>
                text.trim().replace(/ · \d+$/, ''),
            )
        }
        expect(await labels('Ease Type')).toEqual([
            'None',
            'Linear',
            'In',
            'Out',
            'In-Out',
            'Out-In',
        ])
        expect(await labels('Ease Function')).toEqual([
            'Sine',
            'Quad',
            'Cubic',
            'Quart',
            'Quint',
            'Expo',
            'Circ',
            'Step',
        ])
    })

    test('brushes can set only the type or only the function', async ({ page }) => {
        await showSlides(page, ['outSine', 'inQuad', 'none', 'linear'])
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
                history.state.value.selectedEntities
                    .flatMap((entity) =>
                        entity.type === 'note'
                            ? [[entity.beat, entity.connectorEase] as const]
                            : [],
                    )
                    .sort((a, b) => a[0] - b[0])
                    .map(([, ease]) => ease)
            brush.brushProperties.value = { connectorEase: 'function:back' }
            brush.applyBrushToEntities(history.state.value.selectedEntities)
            const name = heads()
            brush.brushProperties.value = { connectorEase: 'type:inOut' }
            brush.applyBrushToEntities(history.state.value.selectedEntities)
            return { name, type: heads() }
        })
        expect(result.name).toEqual(['outBack', 'inBack', 'none', 'linear'])
        expect(result.type).toEqual(['inOutBack', 'inOutBack', 'inOutQuad', 'inOutQuad'])
    })
})

test('every ease round trips through level data, None as NONE and In Step as IN_STEP', async ({
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
            rejected,
        }
    })

    const sorted = <T>(values: T[]) => [...values].sort()
    const range = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, index) => from + index)
    // Every value is written, NONE for None and IN_STEP for In Step.
    expect(sorted(result.written.connector)).toEqual(sorted(range(0, 41)))
    expect(sorted(result.written.event)).toEqual(sorted(range(0, 41)))
    expect(sorted(result.written.timeScale)).toEqual(sorted([...range(0, 29), ...range(38, 41)]))
    expect(sorted(result.read.connector)).toEqual(sorted(result.eases))
    expect(sorted(result.read.event)).toEqual(sorted(result.eases))
    expect(sorted(result.read.timeScale)).toEqual(sorted(result.timeScaleEases))
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
                { connectorEase: 'inStep', copyProperties: true },
                { connectorEase: 'inOut', noteType: 'anchor', copyProperties: true },
            ]),
        )
        localStorage.setItem(
            'sonolus-next-sekai-editor.defaultNotePropertiesPresets',
            JSON.stringify([
                { connectorEase: 'family:sine', isCritical: true, copyProperties: true },
                { connectorEase: 'mode:out', copyProperties: true },
                { connectorEase: 'family:linear', copyProperties: true },
                { connectorEase: 'family:step', noteType: 'anchor', copyProperties: true },
            ]),
        )
    })
    // Presets from 757e7e9 saved quad modes and 'none'; later builds saved family and mode edits.
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const presets = await page.evaluate(() => ({
        slide: window.editorTest.settings.defaultSlidePropertiesPresets,
        note: window.editorTest.settings.defaultNotePropertiesPresets,
    }))
    expect(presets.slide).toEqual([
        { connectorEase: 'inQuad', isCritical: true, copyProperties: false },
        { connectorEase: 'none', noteType: 'trace', copyProperties: true },
        { connectorEase: 'outInQuad', flickDirection: 'up', copyProperties: true },
        { connectorEase: 'inStep', copyProperties: true },
        { connectorEase: 'inOutQuad', noteType: 'anchor', copyProperties: true },
    ])
    expect(presets.note).toEqual([
        { connectorEase: 'function:sine', isCritical: true, copyProperties: true },
        { connectorEase: 'type:out', copyProperties: true },
        { connectorEase: 'linear', copyProperties: true },
        { connectorEase: 'function:step', noteType: 'anchor', copyProperties: true },
    ])
})

test('tapping a selected time scale toggles hiding notes and keeps its ease', async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, history, store, settings, appImport } = window.editorTest
        settings.showSidebar = true
        show(
            {
                ...fixtures.interaction,
                slides: [],
                timeScales: [
                    {
                        groupId: 1 as never,
                        beat: 4,
                        editorLane: 2,
                        timeScale: 2,
                        skip: 0,
                        timeScaleEase: 'outCubic',
                        timeScaleTransition: 'timeScale',
                        hideNotes: false,
                    },
                ],
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'timeScale',
            ),
        })
        const { commands } = await appImport<typeof import('../../src/editor/commands')>(
            '/src/editor/commands/index.ts',
        )
        await commands.timeScale.execute()
    })
    const timeScale = () =>
        page.evaluate(() => {
            const entity = [...window.editorTest.store.getAllEntities()].find(
                (entity) => entity.type === 'timeScale',
            )
            return entity?.type === 'timeScale'
                ? [entity.timeScaleEase, entity.hideNotes]
                : undefined
        })
    const tap = async () => {
        const point = await page.evaluate(() => window.editorTest.point(2, 4))
        await page.mouse.click(point.x, point.y)
        await page.evaluate(() => window.editorTest.nextTick())
    }
    await tap()
    expect(await timeScale()).toEqual(['outCubic', true])
    await tap()
    expect(await timeScale()).toEqual(['outCubic', false])
})

// Engines before v2.15 accept only NONE (0) among steps for time scales.
test('placed and imported time scales are None and write NONE', async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { fixtures, show, appImport } = window.editorTest
        show({ ...fixtures.interaction, slides: [], timeScales: [] }, 2)
        const { commands } = await appImport<typeof import('../../src/editor/commands')>(
            '/src/editor/commands/index.ts',
        )
        await commands.timeScale.execute()
    })
    const point = await page.evaluate(() => window.editorTest.point(2, 4))
    await page.mouse.click(point.x, point.y)
    const result = await page.evaluate(async () => {
        const { store, appImport } = window.editorTest
        const placed = [...store.getAllEntities()].flatMap((entity) =>
            entity.type === 'timeScale' ? [entity.timeScaleEase] : [],
        )
        const { parseUscChart } = await appImport<typeof import('../../src/chart/parse/usc')>(
            '/src/chart/parse/usc/index.ts',
        )
        const { parseSusChart } = await appImport<typeof import('../../src/chart/parse/sus')>(
            '/src/chart/parse/sus/index.ts',
        )
        const { serializeToLevelDataEntities } = await appImport<
            typeof import('../../src/levelData/entities/serialize')
        >('/src/levelData/entities/serialize/index.ts')
        const { createState } =
            await appImport<typeof import('../../src/state')>('/src/state/index.ts')
        const charts = [
            parseUscChart([
                { type: 'bpm', beat: 0, bpm: 120 },
                { type: 'timeScaleGroup', changes: [{ beat: 1, timeScale: 2 }] },
            ] as never),
            parseSusChart({
                offset: 0,
                ticksPerBeat: 480,
                timeScaleChanges: [{ tick: 480, timeScale: 2 }],
                bpmChanges: [{ tick: 0, bpm: 120 }],
                tapNotes: [],
                directionalNotes: [],
                slides: [],
            } as never),
        ]
        return {
            placed,
            imported: charts.map((chart) => {
                const state = createState(chart, 0)
                return {
                    eases: chart.timeScales.map((timeScale) => timeScale.timeScaleEase),
                    values: serializeToLevelDataEntities(
                        state.initialLife,
                        state.isDynamicStages,
                        state.store,
                        state.groups,
                        state.stages,
                    ).flatMap((entity) =>
                        entity.data.flatMap((data) =>
                            data.name === '#TIMESCALE_EASE' && 'value' in data ? [data.value] : [],
                        ),
                    ),
                }
            }),
        }
    })
    expect(result.placed).toEqual(['none'])
    expect(result.imported).toEqual([
        { eases: ['none'], values: [0] },
        { eases: ['none'], values: [0] },
    ])
})

test('an unchanged brush ease half fits its select at the default dock', async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => (window.editorTest.settings.showSidebar = true))
    await page.keyboard.press('b')
    await page.evaluate(async () => {
        const { settings, appImport } = window.editorTest
        settings.propertiesSection = 'tool'
        settings.propertiesCollapsed = ['selection', 'view']
        const brush = await appImport<typeof import('../../src/editor/tools/brush')>(
            '/src/editor/tools/brush/index.ts',
        )
        brush.brushProperties.value = { connectorEase: 'type:in' }
    })
    for (const locale of ['en', 'fr', 'ja']) {
        await page.evaluate(
            (locale) => (window.editorTest.settings.locale = locale as never),
            locale,
        )
        const select = page.locator('#properties-section-tool select').nth(2)
        await expect(select).toBeVisible()
        const fit = await select.evaluate((element: HTMLSelectElement) => {
            const style = getComputedStyle(element)
            const span = document.createElement('span')
            span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'
            span.style.font = style.font
            span.textContent = element.selectedOptions[0]?.textContent?.trim() ?? ''
            document.body.append(span)
            const width = span.getBoundingClientRect().width
            span.remove()
            const room =
                element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            return { text: span.textContent, width, room }
        })
        expect(fit.text).not.toBe('')
        expect(fit.width, `${locale} ${fit.text}`).toBeLessThanOrEqual(fit.room)
    }
})
