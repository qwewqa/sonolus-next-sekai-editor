import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

type LevelData = { entities: { data: { name: string; value?: number }[] }[] }

const easeValues = (levelData: LevelData) =>
    levelData.entities.flatMap((entity) =>
        entity.data.flatMap(({ name, value }) =>
            ['connectorEase', 'ease', '#TIMESCALE_EASE'].includes(name) && value !== undefined
                ? [value]
                : [],
        ),
    )

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('sonolus-next-sekai-editor.showPreview', 'false')
    })
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { fixtures, show } = window.editorTest
        const base = fixtures.events.slides[0]![0]!
        // Camera events and time scales are None; mask events and the connector are In Step.
        show(
            {
                ...fixtures.events,
                cameraEvents: fixtures.events.cameraEvents.map((e) => ({
                    ...e,
                    eventEase: 'none',
                })),
                stageMaskEvents: fixtures.events.stageMaskEvents.map((e) => ({
                    ...e,
                    eventEase: 'inStep',
                })),
                timeScales: fixtures.events.timeScales.map((e) => ({
                    ...e,
                    timeScaleEase: 'none',
                })),
                slides: [
                    [
                        { ...base, beat: 4, connectorEase: 'inStep' },
                        { ...base, beat: 6, connectorEase: 'inStep' },
                    ],
                ],
            },
            2,
        )
    })
})

test('copy writes None as NONE and In Step as IN_STEP, and pastes each back', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) =>
                    entity.type === 'note' ||
                    entity.type === 'cameraEventJoint' ||
                    entity.type === 'stageMaskEventJoint' ||
                    entity.type === 'timeScale',
            ),
        })
    })
    const source = await page.evaluate(() => window.editorTest.point(0, 4))
    await page.mouse.move(source.x, source.y)
    await page.keyboard.press('c')
    await expect
        .poll(async () =>
            easeValues(
                await page.evaluate(
                    async () =>
                        JSON.parse(await navigator.clipboard.readText()) as {
                            entities: LevelData['entities']
                        },
                ),
            ),
        )
        .toEqual(expect.arrayContaining([0, 38]))
    const copied = easeValues(
        await page.evaluate(
            async () =>
                JSON.parse(await navigator.clipboard.readText()) as {
                    entities: LevelData['entities']
                },
        ),
    )
    expect(copied.filter((value) => value !== 0 && value !== 38)).toEqual([])

    await page.keyboard.press('v')
    const target = await page.evaluate(() => window.editorTest.point(0, 30))
    await page.mouse.click(target.x, target.y)
    await expect
        .poll(() =>
            page.evaluate(() => {
                const pasted = window.editorTest.history.state.value.selectedEntities
                const eases = (type: string) => [
                    ...new Set(
                        pasted.flatMap((entity) =>
                            entity.type !== type
                                ? []
                                : entity.type === 'note'
                                  ? [entity.connectorEase]
                                  : entity.type === 'timeScale'
                                    ? [entity.timeScaleEase]
                                    : 'eventEase' in entity
                                      ? [entity.eventEase]
                                      : [],
                        ),
                    ),
                ]
                return {
                    note: eases('note'),
                    camera: eases('cameraEventJoint'),
                    mask: eases('stageMaskEventJoint'),
                    timeScale: eases('timeScale'),
                }
            }),
        )
        .toEqual({ note: ['inStep'], camera: ['none'], mask: ['inStep'], timeScale: ['none'] })
})

test('auto-save writes None as NONE and In Step as IN_STEP', async ({ page }) => {
    await page.evaluate(async () => {
        const { history, store, settings } = window.editorTest
        const { editSelectedEditableEntities } =
            await import('/src/editor/sidebars/default/index.ts')
        settings.autoSaveDelay = 0
        settings.autoSave = true
        const note = [...store.getAllEntities()].find((entity) => entity.type === 'note')!
        history.replaceState({ ...history.state.value, selectedEntities: [note] })
        editSelectedEditableEntities({ size: 3 })
    })
    const saved = async () =>
        page.evaluate(async () => {
            const { storageGet } = await import('/src/storage.ts')
            const { parseAutoSave } = await import('/src/history/autoSave/parse.ts')
            const data = storageGet('autoSave.levelData', undefined)
            return data ? (parseAutoSave(data).levelData as LevelData) : undefined
        })
    await expect.poll(async () => (await saved())?.entities.length ?? 0).toBeGreaterThan(0)
    const values = easeValues((await saved())!)
    expect(values).toEqual(expect.arrayContaining([0, 38]))
})
