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
