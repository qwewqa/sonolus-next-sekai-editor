import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')
const selection = (page: Page) => panel(page).locator('#properties-section-selection')
const control = (page: Page, label: string) =>
    selection(page)
        .locator('label')
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator('input, select')

const open = async (page: Page) => {
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        window.editorTest.settings.showSidebar = true
    })
    await expect(panel(page)).toBeVisible()
}

/** Shows slides of notes from partial note objects and selects every note. */
const showSlides = (page: Page, slides: Partial<NoteObject>[][]) =>
    page.evaluate(async (slides) => {
        const { fixtures, show, history, store, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        show(
            {
                ...fixtures.interaction,
                slides: slides.map((notes) =>
                    notes.map((note) => ({
                        ...template,
                        left: 0,
                        size: 2,
                        isAttached: false,
                        isCritical: false,
                        isConnectorSeparator: false,
                        noteType: 'default' as const,
                        connectorType: 'active' as const,
                        connectorActiveIsCritical: false,
                        ...note,
                    })),
                ),
            },
            2,
        )
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note',
            ),
        })
        await nextTick()
    }, slides)

const notes = (page: Page) =>
    page.evaluate(() =>
        [...window.editorTest.store.getAllEntities()]
            .flatMap((entity) => (entity.type === 'note' ? [entity] : []))
            .sort((a, b) => a.beat - b.beat)
            .map(({ beat, isAttached, isCritical, connectorActiveIsCritical }) => ({
                beat,
                isAttached,
                isCritical,
                connectorActiveIsCritical,
            })),
    )

const selectedCount = (page: Page) =>
    page.evaluate(() => window.editorTest.history.state.value.selectedEntities.length)

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await open(page)
})

test.describe('partial fields', () => {
    test('edits write only to the notes a field applies to', async ({ page }) => {
        await showSlides(page, [[{ beat: 0 }, { beat: 1 }, { beat: 2 }, { beat: 3 }]])
        await control(page, 'Attached').click()
        expect((await notes(page)).map((note) => note.isAttached)).toEqual([
            false,
            true,
            true,
            false,
        ])
        // Every note stays selected.
        expect(await selectedCount(page)).toBe(4)
    })

    test('critical still reaches the connectors of anchors', async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, noteType: 'anchor' },
                { beat: 1, noteType: 'anchor', isConnectorSeparator: true },
                { beat: 2 },
            ],
        ])
        await control(page, 'Critical').click()
        expect(await notes(page)).toEqual([
            { beat: 0, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
            { beat: 1, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
            { beat: 2, isAttached: false, isCritical: true, connectorActiveIsCritical: true },
        ])
    })
})
