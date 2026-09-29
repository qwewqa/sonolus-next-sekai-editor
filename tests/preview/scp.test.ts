import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { createScp } from '../../scripts/release-assets.mjs'
import { loadParticleFromScp } from '../../src/preview/particle'
import { parseScp } from '../../src/preview/scp'
import { loadSkinFromScp } from '../../src/preview/skin'

test('generated release archives are decoded by the existing local skin and particle loaders', async (t) => {
    const texture = { close() {} } as ImageBitmap
    Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: async () => texture,
    })
    t.after(() => {
        Reflect.deleteProperty(globalThis, 'createImageBitmap')
    })
    for (const [category, load] of [
        ['skins', loadSkinFromScp],
        ['particles', loadParticleFromScp],
    ] as const) {
        const item = {
            name: 'fixture',
            title: 'Local fixture',
            data: { url: '/data' },
            texture: { url: '/texture' },
        }
        const bytes = createScp({
            [`sonolus/${category}/list`]: Buffer.from(JSON.stringify({ items: [item] })),
            data: gzipSync(
                JSON.stringify({
                    width: 1,
                    height: 1,
                    interpolation: true,
                    sprites: [],
                    effects: [],
                }),
            ),
            texture: Buffer.from('decoded by bitmap mock'),
        })
        const buffer = Uint8Array.from(bytes).buffer
        assert.equal(
            parseScp(buffer).getJson<{ items: { title: string }[] }>(`sonolus/${category}/list`)
                ?.items[0]?.title,
            item.title,
        )
        const resource = await load(buffer)
        assert.equal(resource.title, item.title)
        assert.equal(resource.texture, texture)
        assert.equal(resource.interpolation, true)
    }
})

test('invalid skin and particle metadata is rejected before allocating decoded textures', async (t) => {
    let decodedTextures = 0
    Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: async () => {
            decodedTextures++
            return { close() {} } as ImageBitmap
        },
    })
    t.after(() => {
        Reflect.deleteProperty(globalThis, 'createImageBitmap')
    })

    for (const [category, load, metadata] of [
        ['skins', loadSkinFromScp, { sprites: null }],
        ['skins', loadSkinFromScp, { sprites: [{ name: 'broken', transform: null }] }],
        ['particles', loadParticleFromScp, { sprites: null }],
        ['particles', loadParticleFromScp, { effects: [{ name: 'broken', transform: {} }] }],
    ] as const) {
        const bytes = createScp({
            [`sonolus/${category}/list`]: Buffer.from(
                JSON.stringify({
                    items: [
                        { name: 'fixture', data: { url: '/data' }, texture: { url: '/texture' } },
                    ],
                }),
            ),
            data: gzipSync(
                JSON.stringify({ width: 1, height: 1, sprites: [], effects: [], ...metadata }),
            ),
            texture: Buffer.from('decoded by bitmap mock'),
        })
        // A rejected package can be retried from the preview's Reload button.
        for (let attempt = 0; attempt < 2; attempt++) {
            await assert.rejects(load(Uint8Array.from(bytes).buffer), TypeError)
            assert.equal(decodedTextures, 0)
        }
    }
})
