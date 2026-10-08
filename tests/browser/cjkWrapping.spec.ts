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
const lines = (page: Page, label: string, selector = '.form-field-text', root = panel(page)) =>
    root
        .locator(selector)
        .getByText(label, { exact: true })
        .first()
        .evaluate((element) => {
            const range = document.createRange()
            const result: string[] = []
            let top: number | undefined
            // A unit sits in its own span, so every text node counts.
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.textContent!
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

test('Preview Settings labels make room for a phrase rather than break inside it', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(async () => {
        const { settings, nextTick, fixtures, show } = window.editorTest
        Object.assign(settings, { locale: 'ja', showSidebar: true, showPreview: true })
        show(fixtures.interaction, 3)
        await nextTick()
    })
    // The default dock has room to show the form.
    const form = page.locator('.preview-controls:not(.invisible)')
    await expect(form).toBeVisible()
    const label = (text: string) => lines(page, text, '.preview-setting-label', form)
    // Not "アンチエイリア / ス" or "再生コントロー / ル".
    await expect.poll(() => label('アンチエイリアス')).toEqual(['アンチエイリアス'])
    await expect.poll(() => label('再生コントロール')).toEqual(['再生コントロール'])
    await expect.poll(() => label('選択対象を強調表示')).toEqual(['選択対象を', '強調表示'])
    // Controls share one column, and no value truncates.
    const edges = await form
        .locator('.preview-setting-control')
        .evaluateAll((elements) =>
            elements.map((element) => Math.round(element.getBoundingClientRect().left)),
        )
    expect(new Set(edges).size).toBe(1)
    for (const field of await form.locator('.preview-field').all())
        expect(await field.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
            true,
        )
})

test('Korean labels too long for two lines by word still break between words', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, 'ko')
    await page.keyboard.press(',')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Not "스테이지 마스크 이 / 벤트 표시 여부 전환".
    await expect
        .poll(() =>
            lines(page, '스테이지 마스크 이벤트 표시 여부 전환', '.form-field-text', dialog),
        )
        .toEqual(['스테이지 마스크', '이벤트 표시 여부', '전환'])
})

for (const [locale, command, label] of [
    ['zht', ',', '水平捲動上限（軌道）'],
    ['zht', ',', '自動儲存週期（秒）'],
    ['zhs', ',', '背景音乐音量（%）'],
    ['zhs', ',', '自动保存延迟（秒）'],
    ['ja', 'm', 'オフセット\u00a0(ミリ秒)'],
] as const)
    test(`${locale} ${label} keeps its unit whole, on the line of the word before it`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 320, height: 700 })
        await open(page, locale)
        await page.keyboard.press(command)
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const unit = /[(（][^()（）]*[)）]$/.exec(label)![0]
        const text = await lines(page, label, '.form-field-text', dialog)
        expect(text.join('').replace(/\s/g, '')).toBe(label.replace(/\s/g, ''))
        // The unit's line holds all of it, and a character before it.
        const last = text.at(-1)!
        expect(last.endsWith(unit), text.join('|')).toBe(true)
        expect(last.length, text.join('|')).toBeGreaterThan(unit.length)
        // Its row still fits.
        const field = dialog.locator('.form-field').filter({
            has: page.locator('.form-field-text').getByText(label, { exact: true }),
        })
        expect(await field.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
            true,
        )
    })
