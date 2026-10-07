import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Runs the parallel chromium batch, then the timing specs alone even if it failed:
// as a project dependency, any chromium failure would skip them.
// Arguments go to the chromium run, e.g. npm run test:browser -- --workers=4.
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const run = (...args) =>
    spawnSync(process.execPath, [cli, 'test', ...args], { stdio: 'inherit' }).status ?? 1

const chromium = run('--project=chromium', ...process.argv.slice(2))
const timing = run('--project=timing', '--no-deps')
process.exit(chromium || timing)
