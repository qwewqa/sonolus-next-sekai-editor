import { expect, test } from '@playwright/test'

for (const names of [['a'], ['a', 'b']]) {
    test(`event imports reject a ${names.length}-node cycle`, async ({ page }) => {
        await page.goto('/')
        const result = await page.evaluate(async (names) => {
            const { parseEvents } = await import('/src/chart/parse/levelData/events/index.ts')
            const refs = new Map(
                names.map((name, i) => [
                    name,
                    {
                        name,
                        archetype: 'CameraChange',
                        data: [{ name: 'next', ref: names[(i + 1) % names.length]! }],
                    },
                ]),
            )
            const objects: string[] = []
            let visits = 0
            try {
                parseEvents(refs, names[0]!, objects, (entity) => {
                    // Keep this regression bounded even if cycle detection breaks.
                    if (++visits > names.length) throw new Error('Repeated event traversal')
                    return entity.name!
                })
                return { visits, error: '' }
            } catch (error) {
                return { visits, error: String(error) }
            }
        }, names)

        expect(result.visits).toBe(names.length)
        expect(result.error).toContain('Invalid level: cyclic event ref "a"')
    })
}

test('acyclic event chains can be parsed repeatedly and preserve order', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async () => {
        const { parseEvents } = await import('/src/chart/parse/levelData/events/index.ts')
        const names = ['a', 'b', 'c']
        const refs = new Map(
            names.map((name, i) => [
                name,
                {
                    name,
                    archetype: 'CameraChange',
                    data: i < names.length - 1 ? [{ name: 'next', ref: names[i + 1]! }] : [],
                },
            ]),
        )
        const first: string[] = []
        const second: string[] = []
        parseEvents(refs, 'a', first, (entity) => entity.name!)
        parseEvents(refs, 'b', second, (entity) => entity.name!)
        return { first, second }
    })

    expect(result).toEqual({ first: ['a', 'b', 'c'], second: ['b', 'c'] })
})

for (const names of [['a'], ['a', 'b']]) {
    test(`slide imports reject a ${names.length}-node cycle`, async ({ page }) => {
        await page.goto('/')
        const result = await page.evaluate(async (names) => {
            const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
            const note = (name: string, beat: number, next: string) => ({
                name,
                archetype: 'NormalTapNote',
                data: [
                    { name: '#TIMESCALE_GROUP', ref: 'g' },
                    { name: '#BEAT', value: beat },
                    { name: 'lane', value: 0 },
                    { name: 'size', value: 1 },
                    { name: 'direction', value: 0 },
                    { name: 'isAttached', value: 0 },
                    { name: 'connectorEase', value: 1 },
                    { name: 'segmentKind', value: 1 },
                    { name: 'segmentAlpha', value: 1 },
                    { name: 'next', ref: next },
                ],
            })
            try {
                const chart = parseLevelDataChart([
                    { archetype: 'Initialization', data: [] },
                    {
                        archetype: '#BPM_CHANGE',
                        data: [
                            { name: '#BEAT', value: 0 },
                            { name: '#BPM', value: 120 },
                        ],
                    },
                    { name: 'g', archetype: '#TIMESCALE_GROUP', data: [] },
                    ...names.map((name, i) => note(name, i + 1, names[(i + 1) % names.length]!)),
                ])
                return `${chart.slides.flat().length} notes`
            } catch (error) {
                return String(error)
            }
        }, names)

        expect(result).toContain(`Invalid level: cyclic slide ref "a"`)
    })
}

test('anchors keep their critical pre-set through level data, from their connector', async ({
    page,
}) => {
    await page.goto('/')
    const result = await page.evaluate(async () => {
        const { createState } = await import('/src/state/index.ts')
        const { serializeToLevelData } = await import('/src/levelData/serialize.ts')
        const { parseLevelDataChart } = await import('/src/chart/parse/levelData/index.ts')
        const note = (beat: number, extra: Record<string, unknown>) => ({
            groupId: 1,
            stageId: 1,
            beat,
            noteType: 'default',
            isAttached: false,
            left: 0,
            size: 2,
            isCritical: false,
            flickDirection: 'none',
            isFake: false,
            noteStyle: 'default',
            connectorStyle: 'default',
            sfx: 'default',
            isConnectorSeparator: false,
            connectorType: 'active',
            connectorEase: 'linear',
            connectorIsFake: false,
            connectorActiveIsCritical: false,
            connectorGuideAlpha: 1,
            connectorLayer: 'top',
            connectorIsPassThrough: false,
            connectorPresentation: 'default',
            elevation: 0,
            ...extra,
        })
        const slide = (critical: boolean) =>
            [0, 1, 2].map((beat) =>
                note(beat + (critical ? 4 : 0), {
                    isCritical: critical,
                    connectorActiveIsCritical: critical,
                    ...(beat === 1 ? { noteType: 'anchor' } : {}),
                }),
            )
        const state = createState(
            {
                initialLife: 1000,
                isDynamicStages: false,
                bpms: [{ beat: 0, bpm: 120 }],
                groups: new Map([[1, { name: 'Group' }]]),
                stages: new Map([
                    [
                        1,
                        {
                            name: 'Stage',
                            isFromStart: true,
                            isUntilEnd: true,
                            generateSimLines: 'global',
                        },
                    ],
                ]),
                cameraEvents: [],
                stageMaskEvents: [],
                stagePivotEvents: [],
                stageStyleEvents: [],
                stageTransformEvents: [],
                timeScales: [],
                slides: [slide(false), slide(true)],
            } as never,
            0,
        )
        const { entities } = serializeToLevelData(
            state.initialLife,
            state.isDynamicStages,
            0,
            state.store,
            state.groups,
            state.stages,
        )
        return parseLevelDataChart(entities)
            .slides.flat()
            .filter((note) => note.noteType === 'anchor')
            .map(({ beat, isCritical }) => ({ beat, isCritical }))
            .sort((a, b) => a.beat - b.beat)
    })
    expect(result).toEqual([
        { beat: 1, isCritical: false },
        { beat: 5, isCritical: true },
    ])
})
