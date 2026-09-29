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
                title: 'Fixture skin',
                author: 'Fixture author',
                data: { url: '/data', hash: options.badHash ? '0'.repeat(40) : hash(data) },
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

test('default staging loads Coconut and records both generated package hashes', async (t) => {
    const urls = server(t)
    const directory = await temporary(t)
    const assets = await stagePreviewAssets(directory, directory, {})
    assert.equal(assets.length, 2)
    assert.ok(
        urls.includes('https://coconut.sonolus.com/next-sekai/sonolus/skins/coconut-next-sekai-1'),
    )
    assert.ok(
        urls.includes(
            'https://coconut.sonolus.com/next-sekai/sonolus/particles/coconut-next-sekai-1',
        ),
    )
    for (const asset of assets) {
        const bytes = await readFile(join(directory, asset.file))
        assert.equal(bytes.length, asset.bytes)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    }
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
