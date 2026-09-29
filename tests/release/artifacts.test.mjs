import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
    checkRelease,
    noticeFiles,
    sha256,
    stageReleasePublic,
    staticFiles,
    writeReleaseManifest,
} from '../../scripts/release-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const metadata = {
    version: '1.0.0-test',
    commit: 'a'.repeat(40),
    base: '/',
    appVersion: '1.0.0-test+aaaaaaaa',
    sourceDirty: false,
}

async function temporary(t) {
    const directory = await mkdtemp(join(tmpdir(), 'sekai-release-test-'))
    t.after(async () => {
        assert.equal(dirname(directory), resolve(tmpdir()))
        assert.ok(directory.startsWith(join(tmpdir(), 'sekai-release-test-')))
        await rm(directory, { recursive: true, force: true })
    })
    return directory
}

async function write(directory, file, content) {
    const target = join(directory, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
}

async function releaseFixture(t) {
    const directory = await temporary(t)
    const assets = ['skin', 'particle'].map((name) => {
        const bytes = Buffer.from(`test ${name} package`)
        return {
            file: `resource/${name}.scp`,
            source: `https://example.com/sonolus/${name === 'skin' ? 'skins' : 'particles'}/fixture`,
            bytes: bytes.length,
            sha256: sha256(bytes),
        }
    })
    for (const asset of assets)
        await write(
            directory,
            asset.file,
            `test ${asset.file.includes('skin') ? 'skin' : 'particle'} package`,
        )
    for (const file of ['index.html', ...staticFiles, ...noticeFiles])
        await write(directory, file, `test ${file}`)
    await write(directory, 'assets/index-12345678.js', 'console.log("release")')
    await write(directory, 'assets/index-12345678.css', 'body { color: red }')
    await writeReleaseManifest(directory, metadata, assets)
    return { directory, assets }
}

test('staging includes site notices without reading local preview packages', async (t) => {
    const directory = await temporary(t)
    await stageReleasePublic(root, directory)
    await assert.rejects(readFile(join(directory, 'resource/skin.scp')), { code: 'ENOENT' })
    const notices = await readFile(join(directory, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
    assert.match(notices, /@breezystack\/lamejs 1\.2\.7/)
    assert.match(notices, /Corresponding source archive:/)
    assert.match(
        await readFile(join(directory, 'notices/LGPL-3.0.txt'), 'utf8'),
        /GNU LESSER GENERAL PUBLIC LICENSE/,
    )
})

test('artifact verification detects file tampering and unexpected files', async (t) => {
    const { directory } = await releaseFixture(t)
    await checkRelease(directory, metadata)
    await write(directory, 'assets/index-12345678.js', 'changed')
    await assert.rejects(checkRelease(directory), /file integrity failed/)
    await write(directory, 'assets/index-12345678.js', 'console.log("release")')
    await write(directory, 'resource/next-sekai-resources.scp', 'unintended media')
    await assert.rejects(checkRelease(directory), /Unexpected release file/)
})

test('an extra hashed bundle still fails when it was not recorded by the build', async (t) => {
    const { directory } = await releaseFixture(t)
    await write(directory, 'assets/unexpected-12345678.js', 'unrecorded')
    await assert.rejects(checkRelease(directory), /file inventory differs/)
})

test('package hashes detect replacements even when the file inventory is recomputed', async (t) => {
    const { directory, assets } = await releaseFixture(t)
    await write(directory, 'resource/skin.scp', 'replacement package')
    await writeReleaseManifest(directory, metadata, assets)
    await assert.rejects(checkRelease(directory), /Preview asset integrity failed/)
})

test('release identity must match the expected checkout and version', async (t) => {
    const { directory, assets } = await releaseFixture(t)
    await assert.rejects(
        checkRelease(directory, { commit: 'b'.repeat(40) }),
        /metadata mismatch: commit/,
    )
    await assert.rejects(
        checkRelease(directory, { version: '2.0.0' }),
        /metadata mismatch: version/,
    )
    await writeReleaseManifest(directory, { ...metadata, sourceDirty: true }, assets)
    await assert.rejects(
        checkRelease(directory, { sourceDirty: false }),
        /metadata mismatch: sourceDirty/,
    )
})

test('missing notices or required packages prevent producing a release manifest', async (t) => {
    const { directory, assets } = await releaseFixture(t)
    await rm(join(directory, 'notices/LGPL-3.0.txt'))
    await assert.rejects(
        writeReleaseManifest(directory, metadata, assets),
        /Missing release file: notices\/LGPL-3.0.txt/,
    )
})
