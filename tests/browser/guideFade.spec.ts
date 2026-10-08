import { expect, test, type Page } from '@playwright/test'
import type { NoteObject } from '../../src/chart/note'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
})

const settle = (page: Page) =>
    page.evaluate(async () => {
        await window.editorTest.nextTick()
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
    })

// At 150 BPM, a beat is 0.4 s.
const pointAt = (page: Page, lane: number, beat: number) =>
    page.evaluate(
        ({ lane, beat }) => {
            const { view, settings } = window.editorTest
            return {
                x: view.x + view.w * (0.5 + (lane - view.lane) / settings.width),
                y: view.y + view.h / 2 - (beat * 0.4 - view.time) * settings.pps,
            }
        },
        { lane, beat },
    )

test('a separator moved onto another by float noise draws its zero-length guide segment', async ({
    page,
}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.evaluate(async () => {
        const { fixtures, show, view, nextTick } = window.editorTest
        const base = fixtures.interaction.slides[0]![0]!
        const guide = (beat: number, extra: Partial<NoteObject> = {}): NoteObject => ({
            ...base,
            beat,
            left: -4,
            size: 2,
            noteType: 'anchor',
            connectorType: 'guide',
            connectorGuideAlpha: 1,
            ...extra,
        })
        show(
            {
                ...fixtures.interaction,
                bpms: [{ beat: 0, bpm: 150 }],
                slides: [
                    [
                        guide(0),
                        guide(22 / 3, { isConnectorSeparator: true }),
                        guide(7 / 3, {
                            left: 2,
                            isConnectorSeparator: true,
                            connectorGuideAlpha: 0.2,
                        }),
                        guide(10),
                    ],
                ],
            },
            2,
        )
        view.snapping = 'absolute'
        view.division = 3
        await nextTick()
    })
    await settle(page)

    // Dragged with the select tool onto the other separator's beat, it lands a hair later.
    const start = await pointAt(page, 3, 7 / 3)
    const end = await pointAt(page, 3, 22 / 3)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)

    // The precondition: two separators a float step apart, at one time.
    const [, head, tail] = await page.evaluate(() =>
        window.editorTest.snapshot().notes.map((note) => note.beat),
    )
    expect(head).not.toBe(tail)
    expect(Math.abs(head! - tail!)).toBeLessThan(1e-9)
    expect(errors).toEqual([])
})
