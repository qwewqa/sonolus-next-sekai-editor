import { expect, test } from '@playwright/test'

test('the old address points to the new one', async ({ page, baseURL }) => {
    await page.route('http://next-sekai-editor-test.qwewqa.xyz/**', (route) =>
        route.continue({
            url: route
                .request()
                .url()
                .replace('http://next-sekai-editor-test.qwewqa.xyz', baseURL!),
        }),
    )
    await page.route('https://nse.qwewqa.dev/**', (route) =>
        route.fulfill({ body: 'new site', contentType: 'text/plain' }),
    )
    await page.goto('http://next-sekai-editor-test.qwewqa.xyz/')
    const dialog = page.getByRole('dialog', { name: 'New Editor Address' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'nse.qwewqa.dev', exact: true })).toHaveAttribute(
        'href',
        'https://nse.qwewqa.dev/',
    )
    await expect(dialog).toContainText('The editor is now at nse.qwewqa.dev. Settings')
    await dialog.getByRole('link', { name: 'Go to nse.qwewqa.dev' }).click()
    await expect(page).toHaveURL('https://nse.qwewqa.dev/')
})

test('other addresses show no notice', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.editor-chart')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
})
