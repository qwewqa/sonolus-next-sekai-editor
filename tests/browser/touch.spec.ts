import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.use({ hasTouch: true })

let client: CDPSession

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    client = await page.context().newCDPSession(page)
})

/** Sends the touches still down, by id. */
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
    client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    })

/** Two lone notes at beat 2, centred on lanes -3 and 3. */
const showNotes = (page: Page) =>
    page.evaluate(async () => {
        const { fixtures, show, nextTick } = window.editorTest
        const template = fixtures.interaction.slides.flat()[0]!
        show(
            {
                ...fixtures.interaction,
                slides: [-4, 2].map((left) => [
                    { ...template, beat: 2, left, size: 2, isAttached: false },
                ]),
            },
            1.1,
        )
        await nextTick()
    })

const point = (page: Page, lane: number, beat: number) =>
    page.evaluate(([lane, beat]) => window.editorTest.point(lane, beat), [lane, beat] as const)

const notes = (page: Page) =>
    page.evaluate(() =>
        window.editorTest
            .snapshot()
            .notes.map(({ beat, left }) => ({ beat, left }))
            .sort((a, b) => a.left! - b.left!),
    )

for (const order of ['mouse', 'touch'] as const)
    test(`a touch drag during a mouse drag is ignored, released ${order} first`, async ({
        page,
    }) => {
        await showNotes(page)
        await page.keyboard.press('a')
        const a = await point(page, -3, 2)
        const aTo = await point(page, -1, 2.5)
        const b = await point(page, 3, 2)
        const bTo = await point(page, 5, 2.5)
        await page.mouse.move(a.x, a.y)
        await page.mouse.down()
        await page.mouse.move(aTo.x, aTo.y, { steps: 4 })
        await touch('touchStart', [[b.x, b.y]])
        for (let step = 1; step <= 4; step++)
            await touch('touchMove', [
                [b.x + ((bTo.x - b.x) * step) / 4, b.y + ((bTo.y - b.y) * step) / 4],
            ])
        if (order === 'mouse') {
            await page.mouse.up()
            await touch('touchEnd', [])
        } else {
            await touch('touchEnd', [])
            await page.mouse.up()
        }
        // The mouse drag moves its note; the touch drag starts nothing.
        expect(await notes(page)).toEqual([
            { beat: 2.5, left: -2 },
            { beat: 2, left: 2 },
        ])
    })

test('a mouse drag during a touch drag is ignored', async ({ page }) => {
    await showNotes(page)
    await page.keyboard.press('a')
    const a = await point(page, -3, 2)
    const aTo = await point(page, -1, 2.5)
    const b = await point(page, 3, 2)
    const bTo = await point(page, 5, 2.5)
    await touch('touchStart', [[b.x, b.y]])
    for (let step = 1; step <= 4; step++)
        await touch('touchMove', [
            [b.x + ((bTo.x - b.x) * step) / 4, b.y + ((bTo.y - b.y) * step) / 4],
        ])
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(aTo.x, aTo.y, { steps: 4 })
    await page.mouse.up()
    // A click in place during the drag adds nothing either.
    await page.mouse.click(aTo.x, aTo.y)
    await touch('touchEnd', [])
    expect(await notes(page)).toEqual([
        { beat: 2, left: -4 },
        { beat: 2.5, left: 4 },
    ])
})

test('two fingers still pinch to zoom', async ({ page }) => {
    await showNotes(page)
    const before = await page.evaluate(() => window.editorTest.settings.pps)
    const { x, y } = await point(page, 0, 2)
    await touch('touchStart', [
        [x, y - 50],
        [x, y + 50],
    ])
    for (let step = 1; step <= 4; step++)
        await touch('touchMove', [
            [x, y - 50 - step * 25],
            [x, y + 50 + step * 25],
        ])
    await touch('touchEnd', [])
    expect(await page.evaluate(() => window.editorTest.settings.pps)).toBeGreaterThan(before)
})

test('holding a finger still during a mouse drag opens no menu', async ({ page }) => {
    await showNotes(page)
    await page.keyboard.press('a')
    const a = await point(page, -3, 2)
    const aTo = await point(page, -1, 2.5)
    const b = await point(page, 3, 2)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(aTo.x, aTo.y, { steps: 4 })
    await touch('touchStart', [[b.x, b.y]])
    await page.waitForTimeout(700)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await touch('touchEnd', [])
    await page.mouse.up()
    expect(await notes(page)).toEqual([
        { beat: 2.5, left: -2 },
        { beat: 2, left: 2 },
    ])
})

test('touch leaves no hover marker, and the edge labels under it come back', async ({ page }) => {
    await page.evaluate(() => window.editorTest.show(window.editorTest.fixtures.interaction, 5))
    const pane = (await page.locator('canvas.editor-chart').boundingBox())!
    const x = pane.x + 30
    const y = pane.y + 15
    const state = () =>
        page.evaluate(async () => {
            const { edgeLabelBoxes, hoverLabelCenter } = await window.editorTest.appImport<
                typeof import('../../src/editor/edgeLabels')
            >('/src/editor/edgeLabels.ts')
            const visible = (selector: string) =>
                [...document.querySelectorAll(selector)].map(
                    (span) => getComputedStyle(span).visibility === 'visible',
                )
            const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-overlay')!
            const pixels = canvas
                .getContext('2d')!
                .getImageData(0, 0, canvas.width, canvas.height).data
            let drawn = false
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) drawn = true
            const { left, right } = edgeLabelBoxes.value
            return {
                hover: visible('.chart-pane > div:nth-of-type(2) > span'),
                top: visible('.chart-pane > div:first-of-type > div:first-child > span'),
                // The grid leaves out its labels under the hover labels' boxes.
                gridSkipsHover: [left, right].map((boxes) =>
                    boxes.some(
                        ({ top, bottom }) =>
                            Math.abs((top + bottom) / 2 - hoverLabelCenter.value) < 0.01,
                    ),
                ),
                drawn,
            }
        })
    const hidden = {
        hover: [false, false],
        top: [true, true],
        gridSkipsHover: [false, false],
        drawn: false,
    }
    const shown = {
        hover: [true, true],
        top: [false, false],
        gridSkipsHover: [true, true],
        drawn: true,
    }

    await touch('touchStart', [[x, y]])
    await touch('touchEnd', [])
    await expect.poll(state).toEqual(hidden)

    await page.mouse.move(x, y)
    await expect.poll(state).toEqual(shown)

    // A pinch starts by clearing the mouse's marker.
    await touch('touchStart', [
        [x, y + 100],
        [x + 100, y + 100],
    ])
    await expect.poll(state).toEqual(hidden)
    for (let step = 1; step <= 4; step++)
        await touch('touchMove', [
            [x, y + 100],
            [x + 100 + step * 25, y + 100],
        ])
    await touch('touchEnd', [])
    await expect.poll(state).toEqual(hidden)

    // A drag shows it while the finger is down.
    await touch('touchStart', [[x, y + 100]])
    for (let step = 1; step <= 4; step++) await touch('touchMove', [[x + step * 20, y]])
    await expect.poll(async () => (await state()).hover).toEqual([true, true])
    await touch('touchEnd', [])
    await expect.poll(state).toEqual(hidden)
})
