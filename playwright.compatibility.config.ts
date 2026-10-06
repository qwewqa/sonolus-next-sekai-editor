import { defineConfig, devices } from '@playwright/test'
import config from './playwright.config'

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
            use: { browserName: 'firefox', baseURL: 'http://127.0.0.1:5211' },
        },
        {
            name: 'webkit-production',
            testDir: './tests/production',
            testMatch: 'browserCompatibility.spec.ts',
            use: { browserName: 'webkit', baseURL: 'http://127.0.0.1:5211' },
        },
        {
            name: 'mobile-webkit-production',
            testDir: './tests/production',
            testMatch: 'browserCompatibility.spec.ts',
            use: {
                ...devices['iPhone 13'],
                browserName: 'webkit',
                baseURL: 'http://127.0.0.1:5211',
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
            command: 'npx vite preview --host 127.0.0.1 --port 5211 --strictPort',
            url: 'http://127.0.0.1:5211',
            reuseExistingServer: false,
        },
    ],
})
