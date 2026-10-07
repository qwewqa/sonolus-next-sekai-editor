import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

const ja = JSON.parse(
    readFileSync(new URL('../../src/i18n/ja/index.json', import.meta.url), 'utf8'),
) as {
    commands: Record<'save' | 'copy', { title: string }> & { slide: { title: { default: string } } }
}

test('shared-binding notes list commands in the locale’s punctuation', async ({ page }) => {
    await page.addInitScript(installCanvasCounters)
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await page.evaluate(installEditorFixture)
    await page.evaluate(() => {
        const { settings } = window.editorTest
        settings.locale = 'ja'
        // Slide already answers to S.
        settings.keyboardShortcuts = { ...settings.keyboardShortcuts, save: 's', copy: 's' }
    })
    await page.keyboard.press(',')
    const row = page
        .getByRole('dialog')
        .locator('.form-field')
        .filter({
            has: page.locator('.form-field-text').getByText(ja.commands.slide.title.default, {
                exact: true,
            }),
        })
    await expect(row.locator('.form-field-notes')).toHaveText(
        `${ja.commands.save.title}、${ja.commands.copy.title}も実行されます`,
    )
})
