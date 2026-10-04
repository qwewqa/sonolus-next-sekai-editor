import vue from '@vitejs/plugin-vue'
import autoprefixer from 'autoprefixer'
import tailwind from 'tailwindcss'
import { defineConfig } from 'vite'
import { version } from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        watch: { ignored: ['**/test-results*/**', '**/playwright-report/**'] },
    },
    build: {
        target: ['chrome106', 'edge106', 'firefox105', 'safari16', 'ios16'],
    },
    css: {
        postcss: {
            plugins: [tailwind(), autoprefixer()],
        },
    },
    plugins: [vue()],
    define: {
        __APP_VERSION__: JSON.stringify(
            (process.env.GITHUB_SHA && `${version}+${process.env.GITHUB_SHA.slice(0, 8)}`) ||
                (process.env.CF_PAGES_BRANCH !== 'prod' &&
                    process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8)) ||
                version,
        ),
    },
})
