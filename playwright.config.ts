import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    timeout: 30_000,
    reporter: 'list',
    outputDir: 'test-results',
    use: {
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:5210',
        viewport: { width: 1600, height: 1000 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            // Exercise Chromium's deferred GPU Canvas backend consistently,
            // including the stale-overlay regression, without a hardware GPU.
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5210 --strictPort',
        url: 'http://127.0.0.1:5210',
        reuseExistingServer: false,
        timeout: 30_000,
    },
})
