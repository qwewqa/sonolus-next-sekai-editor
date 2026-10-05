import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import english from '../../src/i18n/en/index.json'
import { installCanvasCounters, installEditorFixture } from './editorFixture'

test.use({ isMobile: true, hasTouch: true })

for (const locale of ['en', 'fr', 'ja', 'ko', 'tr', 'zhs', 'zht']) {
    const messages = JSON.parse(
        readFileSync(new URL(`../../src/i18n/${locale}/index.json`, import.meta.url), 'utf8'),
    ) as typeof english

    for (const { split, width } of [
        { split: false, width: 375 },
        { split: true, width: 320 },
        ...(locale === 'fr' ? [{ split: false, width: 300 }] : []),
    ]) {
        test(`${locale} elevation controls fit on a ${width}px phone (${split ? 'split' : 'replacement'})`, async ({
            page,
        }, testInfo) => {
            await page.setViewportSize({ width, height: 812 })
            await page.addInitScript(installCanvasCounters)
            await page.goto('/')
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
            await page.evaluate(installEditorFixture)
            await page.evaluate(
                ({ locale, split }) => {
                    const { settings, show, fixtures } = window.editorTest
                    settings.locale = locale
                    settings.elevationEditorSideBySide = split ? 'allow' : 'disallow'
                    settings.previewPosition = 'top'
                    show(fixtures.interaction, 3)
                },
                { locale, split },
            )
            await page.keyboard.press('t')
            const header = page.locator('.elevation-header')
            await expect(header.locator('.elevation-title')).toHaveText(messages.elevation.header)
            const beat = page.getByRole('spinbutton', {
                name: messages.elevation.beat,
                exact: true,
            })
            const snap = page.getByRole('combobox', {
                name: messages.elevation.snapping,
                exact: true,
            })
            const close = page.getByRole('button', { name: messages.elevation.close, exact: true })
            const previous = page.getByRole('button', {
                name: messages.elevation.previousBeat,
                exact: true,
            })
            const next = page.getByRole('button', {
                name: messages.elevation.nextBeat,
                exact: true,
            })
            for (const control of [beat, snap, close, previous, next]) {
                await expect(control).toBeVisible()
                expect(
                    await control.evaluate((element) => {
                        const bounds = element.getBoundingClientRect()
                        const parent = element.closest('.elevation-header')!.getBoundingClientRect()
                        return (
                            bounds.x >= parent.x &&
                            bounds.right <= parent.right &&
                            element.contains(
                                document.elementFromPoint(
                                    bounds.x + bounds.width / 2,
                                    bounds.y + bounds.height / 2,
                                ),
                            )
                        )
                    }),
                ).toBe(true)
            }
            const labelBounds = await header.locator('label span').evaluateAll((labels) =>
                labels.map((label) => {
                    const bounds = label.getBoundingClientRect()
                    const input = label.nextElementSibling!.getBoundingClientRect()
                    return {
                        right: bounds.right,
                        bottom: bounds.bottom,
                        inputLeft: input.x,
                        inputTop: input.y,
                        width: label.scrollWidth,
                        visibleWidth: label.clientWidth,
                    }
                }),
            )
            for (const label of labelBounds) {
                expect(label.right <= label.inputLeft || label.bottom <= label.inputTop).toBe(true)
                expect(label.width).toBeLessThanOrEqual(label.visibleWidth)
            }
            expect((await beat.boundingBox())!.width).toBeGreaterThanOrEqual(56)
            expect((await snap.boundingBox())!.width).toBeGreaterThanOrEqual(56)
            if (split || width === 300)
                expect((await beat.boundingBox())!.x).toBe((await snap.boundingBox())!.x)
            await beat.fill('7')
            await beat.press('Tab')
            await snap.selectOption('4')
            await page.screenshot({
                path: testInfo.outputPath('localized-elevation.png'),
                style: '.notification { visibility:hidden }',
            })
            await close.click()
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
            if (!split) {
                await page.keyboard.press(',')
                const dialog = page.getByRole('dialog')
                await expect(dialog).toBeVisible()
                await expect(
                    dialog.getByRole('button', {
                        name: messages.settings.resetSettings,
                        exact: true,
                    }),
                ).toBeVisible()
                await expect(
                    dialog.getByRole('button', {
                        name: messages.settings.resetKeybinds,
                        exact: true,
                    }),
                ).toBeVisible()
                await expect(
                    dialog.getByText(messages.settings.editor.elevationSideBySide, { exact: true }),
                ).toBeVisible()
                const highlight = dialog.getByText(messages.settings.preview.highlightSelection, {
                    exact: true,
                })
                await highlight.scrollIntoViewIfNeeded()
                await expect(highlight).toBeVisible()
                const secondary = dialog.getByRole('combobox', {
                    name: messages.settings.mouse.secondaryTool.title,
                    exact: true,
                })
                await secondary.selectOption('selectContextMenu')
                await expect(secondary.locator('option:checked')).toHaveText(
                    messages.settings.mouse.secondaryTool.selectContextMenu,
                )
                const save = dialog
                    .locator('label')
                    .filter({ has: page.getByText(messages.commands.save.title, { exact: true }) })
                    .getByRole('button')
                await save.click()
                await expect(save).toHaveText(messages.modals.form.key.press)
                await save.click()
                await expect(save).toHaveText(messages.modals.form.key.unassigned)
                expect(
                    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
                ).toBe(true)
                await page.screenshot({ path: testInfo.outputPath('localized-settings.png') })
            }
        })
    }
}

// Field labels may wrap to two lines but are never cut off.
for (const locale of ['en', 'fr', 'ja', 'ko', 'tr', 'zhs', 'zht']) {
    const messages = JSON.parse(
        readFileSync(new URL(`../../src/i18n/${locale}/index.json`, import.meta.url), 'utf8'),
    ) as typeof english
    for (const { device, viewport } of [
        { device: 'desktop', viewport: { width: 1600, height: 1000 } },
        { device: 'phone', viewport: { width: 375, height: 812 } },
    ]) {
        test(`${locale} field labels fit on ${device}`, async ({ page }) => {
            await page.setViewportSize(viewport)
            await page.addInitScript(installCanvasCounters)
            await page.goto('/')
            await expect(page.locator('canvas.editor-chart')).toBeVisible()
            await page.evaluate(installEditorFixture)
            const clipped = () =>
                page
                    .locator('.form-field-text')
                    .evaluateAll((labels) =>
                        labels
                            .filter((label) => label.scrollHeight > label.clientHeight + 1)
                            .map((label) => label.textContent),
                    )
            const select = (types: string[]) =>
                page.evaluate(async (types) => {
                    const { history, store, nextTick } = window.editorTest
                    history.replaceState({
                        ...history.state.value,
                        selectedEntities: [...store.getAllEntities()].filter((entity) =>
                            types.includes(entity.type),
                        ),
                    })
                    await nextTick()
                }, types)
            await page.evaluate((locale) => {
                const { settings, show, fixtures } = window.editorTest
                settings.locale = locale
                settings.showSidebar = true
                settings.propertiesConnectorExpanded = true
                show(fixtures.events, 3)
            }, locale)
            const selection = page.locator('#properties-section-selection')
            // Every kind at once shows the full, longest labels; one kind the short ones.
            for (const types of [
                [
                    'note',
                    'bpm',
                    'timeScale',
                    'cameraEventJoint',
                    'stageMaskEventJoint',
                    'stagePivotEventJoint',
                    'stageStyleEventJoint',
                    'stageTransformEventJoint',
                ],
                ['cameraEventJoint'],
            ]) {
                await select(types)
                await expect(selection.locator('.form-field-text').first()).toBeAttached()
                expect(await clipped()).toEqual([])
            }
            await page.keyboard.press(',')
            const dialog = page.getByRole('dialog')
            await expect(dialog).toBeVisible()
            // Long shortcut names still clamp beside their icons on phones, so they are left out.
            const shortcuts = messages.settings.keyboardShortcuts.title
            expect(
                await dialog
                    .locator('section')
                    .filter({ hasNot: page.getByRole('heading', { name: shortcuts, exact: true }) })
                    .locator('.form-field-text')
                    .evaluateAll((labels) =>
                        labels
                            .filter((label) => label.scrollHeight > label.clientHeight + 1)
                            .map((label) => label.textContent),
                    ),
            ).toEqual([])
        })
    }
}
