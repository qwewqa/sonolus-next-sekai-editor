import { expect, test, type Page } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

const errors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = []
    errors.set(page, pageErrors)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test.afterEach(async ({ page }) => {
    expect(errors.get(page)).toEqual([])
})

// An attached note on stage 2 exactly on its pivot and elevation step (beat 4),
// attached between notes on stage 1. Play holds stage 2's values from before the
// step, so detaching keeps it at lane 1 and elevation 0 (left 0, size 2).
const materialize = (page: Page, operation: 'combine' | 'makeVertical' | 'splitHold') =>
    page.evaluate(async (operation) => {
        const { combineNotes } = await import('/src/state/operations/combineNotes.ts')
        const { makeVertical } = await import('/src/state/operations/makeVertical.ts')
        const { splitHold } = await import('/src/state/operations/splitHold.ts')
        const { fixtures, show, history } = window.editorTest
        const pivot = fixtures.events.stagePivotEvents[0]!
        const transform = fixtures.events.stageTransformEvents[0]!
        const base = { ...fixtures.interaction.slides[0]![0]!, stageId: 1 as never }
        const side = 2 as never
        show({
            ...fixtures.interaction,
            isDynamicStages: true,
            stagePivotEvents: [
                { ...pivot, stageId: side, beat: 0, pivotLane: 0, yOffset: 0, eventEase: 'inStep' },
                { ...pivot, stageId: side, beat: 4, pivotLane: 3, yOffset: 0 },
            ],
            stageTransformEvents: [
                { ...transform, stageId: side, beat: 0, xTranslation: 0, elevation: 0 },
                { ...transform, stageId: side, beat: 4, xTranslation: 0, elevation: 2 },
            ].map((event) => ({ ...event, eventEase: 'inStep' as const })),
            slides: [
                [
                    { ...base, beat: 2, left: -4, size: 2 },
                    { ...base, beat: 4, stageId: side, isAttached: true },
                    { ...base, beat: 6, left: 4, size: 2 },
                ],
                [
                    { ...base, beat: 4, stageId: side, left: 3, size: 2, elevation: 1 },
                    { ...base, beat: 8, left: 3, size: 2 },
                ],
            ],
        })
        const source = history.state.value
        const notes = [...source.store.slides.note.values()].flat()
        const attached = notes.find((note) => note.isAttached)!
        const result =
            operation === 'combine'
                ? combineNotes(source, notes)
                : operation === 'makeVertical'
                  ? makeVertical(source, [attached, notes.find((note) => note.beat === 6)!])
                  : splitHold(source, [attached])
        return [...result.store.slides.note.values()]
            .flat()
            .filter((note) => note.stageId === side && note.elevation !== 1)
            .map(({ left, size, elevation, isAttached }) => ({ left, size, elevation, isAttached }))
    }, operation)

const held = { left: 0, size: 2, elevation: 0, isAttached: false }

test('combine keeps a note on a stage step at the held pivot and elevation', async ({ page }) => {
    expect(await materialize(page, 'combine')).toEqual([held])
})

test('split hold detaches a note on a stage step at the held values', async ({ page }) => {
    expect(await materialize(page, 'splitHold')).toEqual([held])
})

test('make vertical materializes a note on a stage step at the held lane', async ({ page }) => {
    // Make Vertical sets elevation from the beat offset, 0 for the earliest note.
    expect(await materialize(page, 'makeVertical')).toEqual([held])
})
