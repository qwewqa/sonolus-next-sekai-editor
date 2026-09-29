import { defineConfig } from '@playwright/test'
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
    ],
})
