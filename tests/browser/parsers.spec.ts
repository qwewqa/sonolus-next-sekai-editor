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
