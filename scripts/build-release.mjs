import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stagePreviewAssets } from './release-assets.mjs'
import { checkRelease, stageReleasePublic, writeReleaseManifest } from './release-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const commit = git('rev-parse', 'HEAD')
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
    throw new Error('GITHUB_SHA does not match the checked-out source')
}
process.env.GITHUB_SHA = commit
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const metadata = {
    version,
    commit,
    base: '/',
    appVersion: `${version}+${commit.slice(0, 8)}`,
    sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')),
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'sekai-release-'))
// Only remove the directory just allocated by mkdtemp, never a caller path.
if (
    dirname(temporaryRoot) !== resolve(tmpdir()) ||
    !temporaryRoot.startsWith(join(tmpdir(), 'sekai-release-'))
) {
    throw new Error('Refusing to remove an unexpected temporary directory')
}
try {
    const publicDir = join(temporaryRoot, 'public')
    await stageReleasePublic(root, publicDir)
    const assets = await stagePreviewAssets(root, publicDir)
    const { build } = await import('vite')
    await build({
        root,
        base: '/',
        publicDir,
        build: { outDir: join(root, 'dist'), emptyOutDir: true },
    })
    await writeReleaseManifest(join(root, 'dist'), metadata, assets)
    await checkRelease(join(root, 'dist'), metadata)
    console.log(
        `Verified release ${metadata.appVersion}${metadata.sourceDirty ? ' (working tree has changes)' : ''}`,
    )
} finally {
    await rm(temporaryRoot, { recursive: true, force: true })
}
