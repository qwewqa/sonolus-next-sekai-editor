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
        // Every event and time scale ease is In Step, and so is the connector.
        show(
            {
                ...fixtures.events,
                cameraEvents: fixtures.events.cameraEvents.map((e) => ({
                    ...e,
                    eventEase: 'inStep',
                })),
                stageMaskEvents: fixtures.events.stageMaskEvents.map((e) => ({
                    ...e,
                    eventEase: 'inStep',
                })),
                timeScales: fixtures.events.timeScales.map((e) => ({
                    ...e,
                    timeScaleEase: 'inStep',
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

test('copy writes In Step as NONE and pastes it back as In Step', async ({ page, context }) => {
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
        .toContain(0)
    const copied = easeValues(
        await page.evaluate(
            async () =>
                JSON.parse(await navigator.clipboard.readText()) as {
                    entities: LevelData['entities']
                },
        ),
    )
    expect(copied).not.toContain(38)

    await page.keyboard.press('v')
    const target = await page.evaluate(() => window.editorTest.point(0, 30))
    await page.mouse.click(target.x, target.y)
    await expect
        .poll(() =>
            page.evaluate(() => {
                const pasted = window.editorTest.history.state.value.selectedEntities
                return [
                    ...new Set(
                        pasted.flatMap((entity) =>
                            entity.type === 'note'
                                ? [entity.connectorEase]
                                : entity.type === 'timeScale'
                                  ? [entity.timeScaleEase]
                                  : 'eventEase' in entity
                                    ? [entity.eventEase]
                                    : [],
                        ),
                    ),
                ]
            }),
        )
        .toEqual(['inStep'])
})

test('auto-save writes In Step as NONE', async ({ page }) => {
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
    expect(values).toContain(0)
    expect(values).not.toContain(38)
})
