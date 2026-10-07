import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')

const open = async (page: Page) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { history, store, nextTick, fixtures, settings } = window.editorTest
        const chart = structuredClone(fixtures.interaction)
        // Each head gets a tail, so connector fields show; Critical is mixed.
        chart.slides = chart.slides.map(([head], index) => [
            { ...head!, isCritical: index === 0 },
            { ...head!, beat: head!.beat + 1 },
        ])
        history.resetState(false, chart, 0, 'titles.json')
        Object.assign(settings, {
            locale: 'fr',
            showSidebar: true,
            rightDockWidth: 260,
            propertiesConnectorExpanded: true,
        })
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter((e) => e.type === 'note'),
        })
        await nextTick()
    })
    await expect(panel(page).locator('.form-field-toggle > input').first()).toBeVisible()
}

const toggles = (page: Page) =>
    panel(page)
        .locator('.form-field-toggle > input')
        .evaluateAll((inputs) =>
            inputs
                .filter((input) => input.getClientRects().length)
                .map((input) => ({
                    value: (input as HTMLInputElement).value,
                    title: input.getAttribute('title'),
                })),
        )

const labels = (page: Page) =>
    panel(page)
        .locator('.form-field-text')
        .evaluateAll((texts) =>
            texts
                .filter((text) => text.getClientRects().length)
                .map((text) => ({
                    text: text.textContent,
                    clamped: text.scrollHeight > text.clientHeight + 1,
                    title: text.getAttribute('title'),
                })),
        )

test('on/off values carry the shown value as their hover title, as selects do', async ({
    page,
}) => {
    await open(page)
    const french = await toggles(page)
    expect(french.map(({ value }) => value)).toEqual(expect.arrayContaining(['Mixte', 'Désactivé']))
    for (const { value, title } of french) expect(title).toBe(value)

    // Titles follow a locale switch and a new value.
    await page.evaluate(() => (window.editorTest.settings.locale = 'tr'))
    await expect.poll(async () => (await toggles(page))[0]?.title).toBe('Karışık')
    for (const { value, title } of await toggles(page)) expect(title).toBe(value)
    await panel(page).locator('.form-field-toggle > input').first().click()
    await expect.poll(async () => (await toggles(page))[0]?.title).toBe('Etkin')
})

test('a clamped label carries its full text as its hover title', async ({ page }) => {
    await open(page)
    await expect
        .poll(async () => (await labels(page)).filter(({ clamped }) => clamped).length)
        .toBeGreaterThan(0)
    for (const { text, clamped, title } of await labels(page))
        expect(title, text ?? '').toBe(clamped ? text : null)

    // A wider dock unclamps it and drops the title.
    await page.evaluate(() => (window.editorTest.settings.rightDockWidth = 480))
    await expect.poll(async () => (await labels(page)).filter(({ title }) => title).length).toBe(0)
    for (const { clamped } of await labels(page)) expect(clamped).toBe(false)
})
