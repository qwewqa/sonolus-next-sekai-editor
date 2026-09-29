import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
    downloadPackage,
    itemDetailsUrl,
    refreshPreviewAssetLock,
    stagePreviewAssets,
} from '../../scripts/release-assets.mjs'

const hash = (bytes) => createHash('sha1').update(bytes).digest('hex')
const data = gzipSync(JSON.stringify({ width: 1, height: 1, sprites: [], effects: [] }))
const texture = Buffer.from('texture fixture')

function server(t, options = {}) {
    const urls = []
    t.mock.method(globalThis, 'fetch', async (input) => {
        const url = new URL(input)
        urls.push(url.href)
        if (url.pathname.endsWith('/data')) return new Response(data)
        if (url.pathname.endsWith('/texture')) return new Response(texture)
        return Response.json({
            item: {
                name: 'fixture',
                title: options.title || 'Fixture skin',
                author: 'Fixture author',
                tags: [{ title: options.likes || '100', icon: 'heartHollow' }],
                authorUser: { name: 'author', tags: [{ title: options.authorTag || '#OWNER' }] },
                data: {
                    url: '/data',
                    hash: options.missingHash
                        ? undefined
                        : options.badHash
                          ? '0'.repeat(40)
                          : hash(data),
                },
                texture: { url: 'https://cdn.example/texture', hash: hash(texture) },
            },
        })
    })
    return urls
}

async function temporary(t) {
    const directory = await mkdtemp(join(tmpdir(), 'sekai-assets-test-'))
    t.after(async () => {
        assert.equal(dirname(directory), resolve(tmpdir()))
        assert.ok(directory.startsWith(join(tmpdir(), 'sekai-assets-test-')))
        await rm(directory, { recursive: true, force: true })
    })
    return directory
}

test('public and API links resolve to the same item endpoint', () => {
    const expected = 'https://example.com/server/sonolus/skins/test?localization=en'
    assert.equal(
        itemDetailsUrl('https://example.com/server/skins/test?localization=en', 'skins'),
        expected,
    )
    assert.equal(itemDetailsUrl(expected, 'skins'), expected)
    assert.throws(() => itemDetailsUrl('https://example.com/particles/test', 'skins'), /Expected/)
    assert.throws(() => itemDetailsUrl('file:///skins/test', 'skins'), /HTTP/)
})

test('downloads resolve relative resources and preserve attribution', async (t) => {
    const urls = server(t)
    const result = await downloadPackage('https://example.com/server/skins/test', 'skins')
    assert.equal(result.title, 'Fixture skin')
    assert.equal(result.author, 'Fixture author')
    assert.equal(result.bytes.readUInt32LE(0), 0x04034b50)
    assert.deepEqual(urls, [
        'https://example.com/server/sonolus/skins/test',
        'https://example.com/data',
        'https://cdn.example/texture',
    ])
})

test('a server hash mismatch fails instead of packaging modified resources', async (t) => {
    server(t, { badHash: true })
    await assert.rejects(
        downloadPackage('https://example.com/skins/test', 'skins'),
        /hash mismatch/,
    )
})

test('failed item and resource requests fail the build', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
    await assert.rejects(downloadPackage('https://example.com/skins/test', 'skins'), /503/)
})

test('refresh pins Coconut resources and default staging uses the lock without item requests', async (t) => {
    const urls = server(t)
    const directory = await temporary(t)
    const lock = await refreshPreviewAssetLock(directory, {})
    assert.equal(lock.version, 1)
    assert.ok(
        urls.includes('https://coconut.sonolus.com/next-sekai/sonolus/skins/coconut-next-sekai-1'),
    )
    assert.ok(
        urls.includes(
            'https://coconut.sonolus.com/next-sekai/sonolus/particles/coconut-next-sekai-1',
        ),
    )
    assert.equal(lock.skin.item.data.url, 'https://coconut.sonolus.com/data')
    assert.equal(lock.skin.item.data.hash, hash(data))
    urls.length = 0
    const assets = await stagePreviewAssets(directory, directory, {})
    assert.equal(assets.length, 2)
    assert.deepEqual(urls, [
        'https://coconut.sonolus.com/data',
        'https://cdn.example/texture',
        'https://coconut.sonolus.com/data',
        'https://cdn.example/texture',
    ])
    for (const asset of assets) {
        const bytes = await readFile(join(directory, asset.file))
        assert.equal(bytes.length, asset.bytes)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    }
    assert.equal(assets[0].sha256, lock.skin.sha256)
    assert.equal(assets[1].sha256, lock.particle.sha256)
})

test('upstream item metadata only changes packaged assets after an explicit refresh', async (t) => {
    const options = {}
    const urls = server(t, options)
    const directory = await temporary(t)
    await refreshPreviewAssetLock(directory, {})
    const before = await stagePreviewAssets(directory, directory, {})
    options.title = 'Updated skin'
    urls.length = 0
    const after = await stagePreviewAssets(directory, directory, {})
    assert.deepEqual(after, before)
    assert.ok(urls.every((url) => !url.includes('/sonolus/')))
    await refreshPreviewAssetLock(directory, {})
    const refreshed = await stagePreviewAssets(directory, directory, {})
    assert.equal(refreshed[0].title, 'Updated skin')
    assert.notEqual(refreshed[0].sha256, before[0].sha256)
})

test('social metadata changes leave refreshed lock files and packages unchanged', async (t) => {
    const options = {}
    server(t, options)
    const directory = await temporary(t)
    await refreshPreviewAssetLock(directory, {})
    const lockPath = join(directory, 'deployment/preview-assets.lock.json')
    const before = await readFile(lockPath, 'utf8')
    const beforeAssets = await stagePreviewAssets(directory, directory, {})
    options.likes = '200'
    options.authorTag = '#NEW'
    const refreshed = await refreshPreviewAssetLock(directory, {})
    assert.equal('tags' in refreshed.skin.item, false)
    assert.equal('authorUser' in refreshed.skin.item, false)
    assert.equal(await readFile(lockPath, 'utf8'), before)
    assert.deepEqual(await stagePreviewAssets(directory, directory, {}), beforeAssets)
})

test('locked resource and package hashes reject remote and metadata changes', async (t) => {
    server(t)
    const directory = await temporary(t)
    const lock = await refreshPreviewAssetLock(directory, {})
    const lockPath = join(directory, 'deployment/preview-assets.lock.json')
    lock.skin.item.data.hash = '0'.repeat(40)
    await writeFile(lockPath, JSON.stringify(lock))
    await assert.rejects(stagePreviewAssets(directory, directory, {}), /resource hash mismatch/)
    lock.skin.item.data.hash = hash(data)
    lock.skin.item.title = 'Unrefreshed metadata'
    await writeFile(lockPath, JSON.stringify(lock))
    await assert.rejects(stagePreviewAssets(directory, directory, {}), /package hash mismatch/)
})

test('refresh requires resource hashes and leaves the previous lock on failure', async (t) => {
    const options = {}
    server(t, options)
    const directory = await temporary(t)
    await refreshPreviewAssetLock(directory, {})
    const lockPath = join(directory, 'deployment/preview-assets.lock.json')
    const before = await readFile(lockPath, 'utf8')
    options.missingHash = true
    await assert.rejects(refreshPreviewAssetLock(directory, {}), /must have a SHA-1 hash/)
    assert.equal(await readFile(lockPath, 'utf8'), before)
})

test('default staging fails for missing or unsupported locks without requesting item details', async (t) => {
    const urls = server(t)
    const directory = await temporary(t)
    await assert.rejects(stagePreviewAssets(directory, directory, {}), { code: 'ENOENT' })
    await mkdir(join(directory, 'deployment'))
    await writeFile(join(directory, 'deployment/preview-assets.lock.json'), '{"version":2}')
    await assert.rejects(stagePreviewAssets(directory, directory, {}), /Unsupported/)
    assert.deepEqual(urls, [])
})

test('configured servers replace the defaults', async (t) => {
    const urls = server(t)
    const directory = await temporary(t)
    await stagePreviewAssets(directory, directory, {
        PREVIEW_SKIN_URL: 'https://example.com/skins/custom',
        PREVIEW_PARTICLE_URL: 'https://example.com/particles/custom',
    })
    assert.ok(urls.includes('https://example.com/sonolus/skins/custom'))
    assert.ok(urls.includes('https://example.com/sonolus/particles/custom'))
    assert.ok(urls.every((url) => !url.includes('coconut')))
})

test('one configured server preserves the other locked asset', async (t) => {
    const urls = server(t)
    const directory = await temporary(t)
    await refreshPreviewAssetLock(directory, {})
    urls.length = 0
    const assets = await stagePreviewAssets(directory, directory, {
        PREVIEW_SKIN_URL: 'https://example.com/skins/custom',
    })
    assert.equal(assets[0].source, 'https://example.com/sonolus/skins/custom')
    assert.equal(
        assets[1].source,
        'https://coconut.sonolus.com/next-sekai/sonolus/particles/coconut-next-sekai-1',
    )
    assert.deepEqual(
        urls.filter((url) => url.includes('/sonolus/')),
        ['https://example.com/sonolus/skins/custom'],
    )
})

test('local staging requires a skin, accepts optional particles, and never fetches', async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('local build fetched from a server'))
    const directory = await temporary(t)
    const output = join(directory, 'output')
    const env = { PREVIEW_ASSET_SOURCE: 'local' }
    await assert.rejects(stagePreviewAssets(directory, output, env), { code: 'ENOENT' })
    await mkdir(join(directory, 'public/resource'), { recursive: true })
    await writeFile(join(directory, 'public/resource/skin.scp'), 'local skin')
    const assets = await stagePreviewAssets(directory, output, env)
    assert.deepEqual(
        assets.map((asset) => asset.file),
        ['resource/skin.scp'],
    )
    assert.equal(await readFile(join(output, 'resource/skin.scp'), 'utf8'), 'local skin')
    await writeFile(join(directory, 'public/resource/particle.scp'), 'local particle')
    assert.equal((await stagePreviewAssets(directory, output, env)).length, 2)
    await assert.rejects(
        stagePreviewAssets(directory, output, { PREVIEW_ASSET_SOURCE: 'typo' }),
        /must be/,
    )
})
