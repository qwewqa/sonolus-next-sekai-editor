import { expect, test, type Page } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const panel = (page: Page) => page.locator('#workspace-panel-properties')

const open = async (page: Page, locale: string) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async (locale) => {
        const { settings, history, store, nextTick, fixtures, show } = window.editorTest
        Object.assign(settings, { locale, showSidebar: true, rightDockWidth: 260 })
        show(fixtures.events, 3)
        await nextTick()
        history.replaceState({
            ...history.state.value,
            selectedEntities: [...store.getAllEntities()],
        })
        await nextTick()
    }, locale)
    await expect(panel(page).locator('.form-field-text').first()).toBeVisible()
}

/** A label's text split where it wraps. */
const lines = (page: Page, label: string) =>
    panel(page)
        .locator('.form-field-text')
        .getByText(label, { exact: true })
        .first()
        .evaluate((element) => {
            const node = element.firstChild!
            const text = node.textContent!
            const range = document.createRange()
            const result: string[] = []
            let top: number | undefined
            for (let index = 0; index < text.length; index++) {
                range.setStart(node, index)
                range.setEnd(node, index + 1)
                const rect = range.getClientRects()[0]
                if (!rect) continue
                const character = text.charAt(index)
                if (top === undefined || rect.top > top + 2) result.push(character)
                else result.push(`${result.pop() ?? ''}${character}`)
                top = rect.top
            }
            return result.map((line) => line.trim())
        })

test('Korean labels wrap between words', async ({ page }) => {
    await open(page, 'ko')
    // Not "판정선 불투명 / 도".
    await expect.poll(() => lines(page, '판정선 불투명도')).toEqual(['판정선', '불투명도'])
})

test('Japanese labels wrap between phrases, never before a long vowel mark', async ({ page }) => {
    await open(page, 'ja')
    // Not "ノーツの不透 / 明度".
    await expect.poll(() => lines(page, 'ノーツの不透明度')).toEqual(['ノーツの', '不透明度'])
    for (const label of await panel(page).locator('.form-field-text').allTextContents())
        for (const line of (await lines(page, label)).slice(1))
            expect(line.startsWith('ー'), label).toBe(false)
})
