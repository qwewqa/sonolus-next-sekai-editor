import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const openSlide = async (
    page: Page,
    options: { attached: boolean; selected: boolean; layer: 'top' | 'over' },
) => {
    await page.evaluate(async ({ attached, selected, layer }) => {
        const { fixtures, show, settings, history, appImport } = window.editorTest
        const base = {
            ...fixtures.interaction.slides[0]![0]!,
            beat: 3,
            left: -2,
            size: 4,
            noteType: 'forceNonTick' as const,
            connectorLayer: layer,
        }
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [
                        { ...base, elevation: 0 },
                        { ...base, elevation: 2, isAttached: attached },
                        { ...base, elevation: 4 },
                    ],
                ],
            },
            3,
        )
        settings.showPreview = false
        settings.showSidebar = false
        settings.showStageName = false
        settings.showGroupName = false
        settings.elevationEditorSideBySide = 'disallow'
        if (selected) {
            const middle = [...history.state.value.store.slides.note.values()]
                .flat()
                .find((note) => note.elevation === 2)!
            history.replaceState({ ...history.state.value, selectedEntities: [middle] })
        }
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
    }, options)
    await expect(page.locator('.elevation-canvas')).toBeVisible()
    await settle(page)
}

const middlePixel = (page: Page) =>
    page.evaluate(async () => {
        const { elevationLayout } = await window.editorTest.appImport<
            typeof import('../../src/editor/elevation/scene')
        >('/src/editor/elevation/scene.ts')
        const layout = elevationLayout.value
        const row = layout.rows.find((row) => row.note.elevation === 2)!
        const canvas = document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
        return [
            ...canvas
                .getContext('2d')!
                .getImageData(
                    Math.round(((row.x + 0.35 * layout.laneScale) * canvas.width) / layout.width),
                    Math.round((row.y * canvas.height) / layout.height),
                    1,
                    1,
                ).data,
        ]
    })

for (const attached of [false, true]) {
    for (const selected of [false, true]) {
        test(`committed ${attached ? 'attached' : 'unattached'} tap hides top connector${selected ? ' when selected' : ''}`, async ({
            page,
        }) => {
            await openSlide(page, { attached, selected, layer: 'top' })
            const connected = await middlePixel(page)
            await page.evaluate(() => {
                window.editorTest.view.visibilities = {
                    ...window.editorTest.view.visibilities,
                    connector: false,
                }
            })
            await settle(page)
            const plain = await middlePixel(page)
            expect(plain[3]).toBe(255)
            expect(connected).toEqual(plain)
            expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
        })
    }
}

test('explicit over connector still paints above an unselected attached tap', async ({ page }) => {
    await openSlide(page, { attached: true, selected: false, layer: 'over' })
    const connected = await middlePixel(page)
    await page.evaluate(() => {
        window.editorTest.view.visibilities = {
            ...window.editorTest.view.visibilities,
            connector: false,
        }
    })
    await settle(page)
    expect(connected).not.toEqual(await middlePixel(page))
})

for (const attached of [false, true]) {
    test(`selected ${attached ? 'attached' : 'unattached'} tap paints above over connectors`, async ({
        page,
    }) => {
        await openSlide(page, { attached, selected: true, layer: 'over' })
        const connected = await middlePixel(page)
        await page.evaluate(() => {
            window.editorTest.view.visibilities = {
                ...window.editorTest.view.visibilities,
                connector: false,
            }
        })
        await settle(page)
        expect(connected).toEqual(await middlePixel(page))
    })
}

test('selected overlapping note paints above an unselected note', async ({ page }) => {
    await openSlide(page, { attached: false, selected: false, layer: 'top' })
    await page.evaluate(async () => {
        const { fixtures, show, appImport } = window.editorTest
        const base = {
            ...fixtures.interaction.slides[0]![0]!,
            beat: 3,
            elevation: 2,
            left: -2,
            size: 4,
        }
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [[{ ...base, noteStyle: 'red' }], [{ ...base, noteStyle: 'blue' }]],
            },
            3,
        )
        const { openElevationEditor } = await appImport<
            typeof import('../../src/editor/elevation/state')
        >('/src/editor/elevation/state.ts')
        openElevationEditor(3)
    })
    await settle(page)
    expect(await middlePixel(page)).toEqual([230, 237, 255, 255])
    await page.evaluate(() => {
        const { history } = window.editorTest
        const red = [...history.state.value.store.slides.note.values()]
            .flat()
            .find((note) => note.noteStyle === 'red')!
        history.replaceState({ ...history.state.value, selectedEntities: [red] })
    })
    await settle(page)
    expect(await middlePixel(page)).toEqual([255, 237, 245, 255])
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('creation ghost stays in front of over connectors at its normal translucency', async ({
    page,
}) => {
    const samples = []
    for (const layer of ['top', 'over'] as const) {
        await openSlide(page, { attached: true, selected: false, layer })
        await page.keyboard.press('a')
        const local = await page.evaluate(async () => {
            const { elevationLayout } = await window.editorTest.appImport<
                typeof import('../../src/editor/elevation/scene')
            >('/src/editor/elevation/scene.ts')
            return { x: elevationLayout.value.xAt(0), y: elevationLayout.value.yAt(1) }
        })
        const box = (await page.locator('.elevation-canvas').boundingBox())!
        await page.mouse.move(box.x + local.x, box.y + local.y)
        await settle(page)
        expect(await page.evaluate(() => window.editorTest.view.entities.creating.length)).toBe(1)
        samples.push(
            await page.evaluate(async () => {
                const { elevationLayout } = await window.editorTest.appImport<
                    typeof import('../../src/editor/elevation/scene')
                >('/src/editor/elevation/scene.ts')
                const layout = elevationLayout.value
                const note = window.editorTest.view.entities.creating[0]!
                if (note.type !== 'note') throw new Error('Missing note ghost')
                const canvas = document.querySelector<HTMLCanvasElement>('.elevation-canvas')!
                return [
                    ...canvas
                        .getContext('2d')!
                        .getImageData(
                            Math.round(
                                (layout.xAt(note.left + note.size / 2 + 0.15) * canvas.width) /
                                    layout.width,
                            ),
                            Math.round(
                                (layout.yAt(note.elevation) * canvas.height) / layout.height,
                            ),
                            1,
                            1,
                        ).data,
                ]
            }),
        )
        await page.keyboard.press('Escape')
    }
    expect(samples[1]).toEqual(samples[0])
    expect(samples[0]![3]).toBeLessThan(255)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})

test('attached and unattached offscreen badges stay fully opaque', async ({ page }) => {
    await openSlide(page, { attached: true, selected: false, layer: 'top' })
    await page.evaluate(() => {
        window.editorTest.view.lane = 30
    })
    const badges = page.locator('.elevation-editor .offscreen-note-indicator')
    await expect(badges).toHaveCount(3)
    for (const badge of await badges.all()) await expect(badge).toHaveCSS('opacity', '1')
})
