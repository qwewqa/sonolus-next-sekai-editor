import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

for (const cancelKind of ['pointercancel', 'lostcapture'] as const) {
    test(`${cancelKind} releases resize Escape ownership without altering selection`, async ({
        page,
    }) => {
        await page.addInitScript(installCanvasCounters)
        await page.goto('/')
        await expect(page.locator('canvas.editor-chart')).toBeVisible()
        await page.evaluate(installEditorFixture)
        await page.evaluate(async () => {
            const { show, fixtures, settings, history, appImport } = window.editorTest
            show({ ...fixtures.interaction, isDynamicStages: true }, 3)
            settings.showSidebar = false
            settings.showPreview = false
            settings.elevationEditorSideBySide = 'allow'
            const elevation = await appImport<typeof import('../../src/editor/elevation/state')>(
                '/src/editor/elevation/state.ts',
            )
            elevation.openElevationEditor(3)
            history.replaceState({
                ...history.state.value,
                selectedEntities: [...history.state.value.store.slides.note.values()]
                    .flat()
                    .slice(0, 1),
            })
        })
        const beat = page.getByRole('spinbutton', { name: 'Beat', exact: true })
        await beat.focus()
        const original = await page.evaluate(() => ({
            width: window.editorTest.settings.elevationEditorWidth,
            selected: window.editorTest.snapshot().selected,
        }))
        const divider = page.getByRole('separator', {
            name: 'Resize Elevation Editor',
            exact: true,
        })
        await divider.evaluate((element) =>
            element.addEventListener(
                'pointerdown',
                (event) => {
                    ;(element as HTMLElement).dataset.testPointerId =
                        `${(event as PointerEvent).pointerId}`
                },
                { once: true },
            ),
        )
        const box = (await divider.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x - 90, box.y + box.height / 2, { steps: 4 })
        await expect(beat).toBeFocused()
        await expect(divider).toHaveClass(/is-dragging/)
        await divider.evaluate((element, kind) => {
            const id = Number((element as HTMLElement).dataset.testPointerId)
            if (kind === 'pointercancel')
                element.dispatchEvent(
                    new PointerEvent('pointercancel', { pointerId: id, bubbles: true }),
                )
            else element.releasePointerCapture(id)
        }, cancelKind)
        await page.mouse.move(box.x - 95, box.y + box.height / 2)
        await expect(divider).not.toHaveClass(/is-dragging/)
        expect(await page.evaluate(() => window.editorTest.settings.elevationEditorWidth)).toBe(
            original.width,
        )
        expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual(
            original.selected,
        )
        expect(
            await page.evaluate(async () => {
                const { resizeEscapes } = await window.editorTest.appImport<
                    typeof import('../../src/editor/controls')
                >('/src/editor/controls/index.ts')
                return resizeEscapes.size
            }),
        ).toBe(0)
        await page.mouse.up()
        // The restored divider can leave the pointer over the main chart,
        // activating that pane. Return to the Beat control before testing its Escape.
        await beat.click()
        await page.keyboard.press('Escape')
        expect(await page.evaluate(() => window.editorTest.snapshot().selected)).toEqual([])
        await expect(page.locator('.elevation-canvas')).toBeVisible()
        expect(await page.evaluate(() => window.editorTest.history.canUndo.value)).toBe(false)
    })
}
