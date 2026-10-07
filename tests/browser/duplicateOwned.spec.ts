import { expect, test } from '@playwright/test'
import { installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

test('duplicating owners keeps the selection in an array of its own', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { show, fixtures, history, appImport } = window.editorTest
        const { duplicateOwned } = await appImport<
            typeof import('../../src/state/operations/duplicateOwned')
        >('/src/state/operations/duplicateOwned.ts')
        show(fixtures.interaction)
        const source = history.state.value
        const selected = [...source.store.slides.note.values()].flat().slice(0, 1)
        const state = { ...source, selectedEntities: selected }
        const duplicated = duplicateOwned(state, {
            key: 'groupId',
            copies: new Map([[1 as never, 2 as never]]),
        })
        return {
            notes: [...duplicated.store.slides.note.values()].flat().length,
            source: [...source.store.slides.note.values()].flat().length,
            // Commits rebuild their selection in place, which must not reach the step before.
            shared: duplicated.selectedEntities === selected,
            same: duplicated.selectedEntities.every((entity, i) => entity === selected[i]),
            count: duplicated.selectedEntities.length,
        }
    })
    expect(result.notes).toBe(result.source * 2)
    expect(result).toMatchObject({ shared: false, same: true, count: 1 })
})
