import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRelease } from './release-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const expected = { version }
if (process.env.GITHUB_SHA) expected.commit = process.env.GITHUB_SHA
if (process.env.GITHUB_ACTIONS === 'true') expected.sourceDirty = false
const manifest = await checkRelease(join(root, 'dist'), expected)
console.log(
    `Release artifact verified: ${manifest.appVersion} (${Object.keys(manifest.files).length} files)`,
)
