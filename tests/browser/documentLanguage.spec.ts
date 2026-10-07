import { expect, test } from '@playwright/test'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test('the document language is a valid tag, so Chinese text gets its own fonts', async ({
    page,
}) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    const html = page.locator('html')
    for (const [locale, tag] of [
        ['zht', 'zh-Hant'],
        ['zhs', 'zh-Hans'],
        ['ja', 'ja'],
        ['en', 'en'],
    ] as const) {
        await page.evaluate(
            (locale) => (window.editorTest.settings.locale = locale as never),
            locale,
        )
        await expect(html).toHaveAttribute('lang', tag)
    }
})
