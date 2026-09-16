import { defineConfig } from '@playwright/test'

// Build with `npm run build:release` first, or set PRODUCTION_TEST_URL to check
// the deployed site. Neither mode loads Vite development modules.
const hostedUrl = process.env.PRODUCTION_TEST_URL

export default defineConfig({
    testDir: './tests/production',
    testMatch: '**/*.spec.ts',
    workers: 1,
    forbidOnly: !!process.env.CI,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: 'list',
    outputDir: 'test-results-production',
    use: {
        browserName: 'chromium',
        baseURL: hostedUrl ?? 'http://127.0.0.1:5211',
        locale: 'en-US',
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 1.25,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
    },
    webServer: hostedUrl
        ? undefined
        : {
              command: 'npx vite preview --host 127.0.0.1 --port 5211 --strictPort',
              url: 'http://127.0.0.1:5211',
              reuseExistingServer: false,
              timeout: 30_000,
          },
})
