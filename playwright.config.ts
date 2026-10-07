import { defineConfig } from '@playwright/test'

// Parallel local runs can each choose a free development server port.
const port = process.env.PLAYWRIGHT_PORT ?? '5210'
const timingSpecs = ['renderPacing.spec.ts']

export default defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    // More workers don't help: the dev server is the limit. Concurrent runs should pass --workers.
    workers: '25%',
    forbidOnly: !!process.env.CI,
    timeout: 30_000,
    reporter: 'list',
    outputDir: 'test-results',
    use: {
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${port}`,
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
    projects: [
        { name: 'chromium', testIgnore: timingSpecs },
        // Measures real frame timing, so it runs alone after the parallel batch.
        // Any chromium failure skips it; add --no-deps to run it by itself.
        { name: 'timing', testMatch: timingSpecs, dependencies: ['chromium'], workers: 1 },
    ],
    webServer: {
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 30_000,
    },
})
