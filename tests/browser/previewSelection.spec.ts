import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'
import { resource } from './previewResourceFixture'

const outlinePixels = (page: Page) =>
    page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.preview-selection')
        if (!canvas) return 0
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        return data ? data.filter((value, index) => index % 4 === 3 && value > 0).length : 0
    })

test.beforeEach(async ({ page }) => {
    await page.route('**/resource/skin.scp*', (route) => route.fulfill({ body: resource('skins') }))
    await page.route('**/resource/particle.scp*', (route) =>
        route.fulfill({ body: resource('particles') }),
    )
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.showPreview = true
    })
    await expect(page.locator('.preview').getByText('Note Speed', { exact: true })).toBeVisible()
})

test('selected notes highlight at the hit beat without seeking or adding history', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view, history } = window.editorTest
        const base = fixtures.interaction.slides[0]?.[0]
        if (!base) throw new Error('Missing fixture')
        show({ ...fixtures.interaction, slides: [[{ ...base, beat: 6 }]] }, 3)
        view.cursorTime = 3
        const note = [...history.state.value.store.slides.note.values()].flat()[0]
        if (note) history.replaceState({ ...history.state.value, selectedEntities: [note] })
    })
    await expect.poll(() => outlinePixels(page)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(3)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    const highlighting = page.locator('.preview').getByLabel('Highlight Selection', { exact: true })
    await highlighting.uncheck()
    await expect.poll(() => outlinePixels(page)).toBe(0)
    expect(
        await page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length),
    ).toBe(1)
    await highlighting.check()
    await expect.poll(() => outlinePixels(page)).toBeGreaterThan(0)
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await expect.poll(() => outlinePixels(page)).toBe(0)
    await expect(page.locator('.elevation-canvas')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Elevation', exact: true })).toHaveCount(0)
})

test('connectors, moving slide heads, and stage events highlight their visible objects', async ({
    page,
}) => {
    await page.evaluate(() => {
        const { fixtures, show, view, history } = window.editorTest
        const base = fixtures.interaction.slides[0]?.[0]
        const transform = fixtures.events.stageTransformEvents[0]
        const mask = fixtures.events.stageMaskEvents[0]
        const style = fixtures.events.stageStyleEvents[0]
        if (!base || !transform || !mask || !style) throw new Error('Missing fixture')
        show(
            {
                ...fixtures.interaction,
                isDynamicStages: true,
                slides: [
                    [
                        { ...base, beat: 4 },
                        { ...base, beat: 8, elevation: 0.5 },
                    ],
                ],
                stageTransformEvents: [{ ...transform, beat: 0, xTranslation: 0, elevation: 0.5 }],
                stageMaskEvents: [{ ...mask, beat: 0, maskLeft: -6, maskSize: 12 }],
                stageStyleEvents: [{ ...style, beat: 0 }],
            },
            3,
        )
        view.cursorTime = 3
        const connector = [...history.state.value.store.slides.connector.values()].flat()[0]
        if (connector)
            history.replaceState({ ...history.state.value, selectedEntities: [connector] })
    })
    await expect.poll(() => outlinePixels(page)).toBeGreaterThan(0)
    await page.evaluate(() => {
        const { history } = window.editorTest
        history.replaceState({ ...history.state.value, selectedEntities: [] })
    })
    await expect.poll(() => outlinePixels(page)).toBe(0)
    await page.evaluate(() => {
        const { history } = window.editorTest
        const head = [...history.state.value.store.slides.note.values()].flat()[0]
        if (head) history.replaceState({ ...history.state.value, selectedEntities: [head] })
    })
    await expect.poll(() => outlinePixels(page)).toBeGreaterThan(0)
    await page.evaluate(() => {
        const { history, store } = window.editorTest
        const event = [...store.getAllEntities()].find(
            (entity) => entity.type === 'stageTransformEventJoint',
        )
        if (!event) throw new Error('Missing stage event')
        history.replaceState({ ...history.state.value, selectedEntities: [event] })
    })
    await expect.poll(() => outlinePixels(page)).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.editorTest.view.cursorTime)).toBe(3)
    expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
})
