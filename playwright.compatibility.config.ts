import { defineConfig, devices } from '@playwright/test'
import config from './playwright.config'

// Parallel local runs can each choose a free preview server port.
const previewPort = process.env.PLAYWRIGHT_PREVIEW_PORT ?? '5211'
const previewUrl = `http://127.0.0.1:${previewPort}`

export default defineConfig({
    ...config,
    testMatch: ['playerAudio.spec.ts', 'waveform.spec.ts'],
    outputDir: 'test-results-compatibility',
    use: {
        ...config.use,
        launchOptions: {},
    },
    projects: [
        { name: 'firefox', use: { browserName: 'firefox' } },
        { name: 'webkit', use: { browserName: 'webkit' } },
        // Firefox-specific keyboard defaults such as quick find and Backspace.
        {
            name: 'firefox-chrome',
            testMatch: ['editorChrome.spec.ts', 'shortcuts.spec.ts'],
            use: { browserName: 'firefox' },
        },
        {
            name: 'firefox-production',
            testDir: './tests/production',
            testMatch: 'browserCompatibility.spec.ts',
            use: { browserName: 'firefox', baseURL: previewUrl },
        },
        {
            name: 'webkit-production',
            testDir: './tests/production',
            testMatch: 'browserCompatibility.spec.ts',
            use: { browserName: 'webkit', baseURL: previewUrl },
        },
        {
            name: 'mobile-webkit-production',
            testDir: './tests/production',
            testMatch: 'browserCompatibility.spec.ts',
            use: {
                ...devices['iPhone 13'],
                browserName: 'webkit',
                baseURL: previewUrl,
            },
        },
    ],
    webServer: [
        ...(Array.isArray(config.webServer)
            ? config.webServer
            : config.webServer
              ? [config.webServer]
              : []),
        {
            command: `npx vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
            url: previewUrl,
            reuseExistingServer: false,
        },
    ],
})
