import { expect, test } from '@playwright/test'

// Modules on an import cycle evaluate fine whichever one a page loads first.
for (const pathname of ['/src/utils/interpolate.ts', '/src/editor/workspace/manager/folders.ts'])
    test(`${pathname} can be the first module a page imports`, async ({ page }) => {
        // A blank page on the dev server, without the app's entry.
        await page.route('**/blank.html', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><script type="module" src="/@vite/client"></script>',
            }),
        )
        await page.goto('/blank.html')
        const error = await page.evaluate(async (pathname) => {
            try {
                await import(pathname)
            } catch (error) {
                return String(error)
            }
        }, pathname)
        expect(error).toBeUndefined()
    })

test('messages still follow the plural rules of the chosen locale', async ({ page }) => {
    await page.goto('/')
    const forms = await page.evaluate(async () => {
        const { settings } = await import('/src/settings.ts')
        const { interpolateRaw } = await import('/src/utils/interpolate.ts')
        const form = () => interpolateRaw('{0} object|{0} objects', '0')
        settings.locale = 'en'
        const en = form()
        // French counts zero as singular.
        settings.locale = 'fr'
        return [en, form()]
    })
    expect(forms).toEqual(['0 objects', '0 object'])
})
