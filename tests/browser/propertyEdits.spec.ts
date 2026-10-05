import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

/** Shows slides of notes plus one stage transform joint at beat 20. */
const showSlides = (page: Page, slides: Partial<NoteObject>[][]) =>
    page.evaluate(async (slides) => {
        const { fixtures, show, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        show(
            {
                ...fixtures.events,
                cameraEvents: [],
                stageMaskEvents: [],
                stagePivotEvents: [],
                stageStyleEvents: [],
                timeScales: [],
                stageTransformEvents: [
                    {
                        stageId: template.stageId,
                        beat: 20,
                        rotation: 0,
                        xTranslation: 0,
                        yTranslation: 0,
                        elevation: 0,
                        anchor: 'default',
                        eventEase: 'linear',
                    },
                ],
                slides: slides.map((notes) =>
                    notes.map((note) => ({ ...template, left: 0, size: 2, ...note })),
                ),
            },
            2,
        )
        await nextTick()
    }, slides)

const selectAll = (page: Page) =>
    page.evaluate(() => {
        const { history, store } = window.editorTest
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()].filter(
                (entity) => entity.type === 'note' || entity.type === 'stageTransformEventJoint',
            ),
        })
    })

const quickEdit = (page: Page, properties: Record<string, unknown>) =>
    page.evaluate(async (properties) => {
        const { quickEdit } = await window.editorTest.appImport<
            typeof import('../../src/editor/utils/quickEdit')
        >('/src/editor/utils/quickEdit.ts')
        quickEdit({ copyProperties: true, ...properties })
    }, properties)

const values = (page: Page, key: string) =>
    page.evaluate(
        (key) =>
            [...window.editorTest.store.getAllEntities()]
                .filter((entity) => key in entity)
                .sort((a, b) => a.beat - b.beat)
                .map((entity) => `${entity.type}:${String(entity[key as keyof typeof entity])}`),
        key,
    )

test.describe('quick edit', () => {
    test('a note preset leaves selected events alone', async ({ page }) => {
        await showSlides(page, [[{ beat: 0, elevation: 0 }]])
        await selectAll(page)
        await quickEdit(page, { elevation: 2 })
        expect(await values(page, 'elevation')).toEqual(['note:2', 'stageTransformEventJoint:0'])
    })

    test('a single Guide Alpha preset sets that alpha', async ({ page }) => {
        await showSlides(page, [
            [
                { beat: 0, connectorType: 'guide', connectorGuideAlpha: 1 },
                { beat: 2, connectorType: 'guide', connectorGuideAlpha: 1 },
            ],
        ])
        await selectAll(page)
        await quickEdit(page, { connectorGuideAlpha: 0.5 })
        expect(await values(page, 'connectorGuideAlpha')).toEqual(['note:0.5', 'note:0.5'])
    })
})
