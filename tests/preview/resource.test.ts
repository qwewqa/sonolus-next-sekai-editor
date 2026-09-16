import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPreviewResource } from '../../src/preview/resource'

test('resource loads retain their bitmap and pass cancellation through to fetch', async (t) => {
    const controller = new AbortController()
    const buffer = new ArrayBuffer(4)
    const resource = {
        texture: { close: () => assert.fail('active texture closed') } as ImageBitmap,
    }
    t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
        assert.equal(url, '/resource/skin.scp')
        assert.equal(options.signal, controller.signal)
        assert.equal(options.cache, 'no-store')
        return { ok: true, arrayBuffer: async () => buffer } as Response
    })
    assert.equal(
        await loadPreviewResource(
            '/resource/skin.scp',
            async (input) => {
                assert.equal(input, buffer)
                return resource
            },
            controller.signal,
        ),
        resource,
    )
})

test('a bitmap finishing after unmount or replacement is closed instead of published', async (t) => {
    const controller = new AbortController()
    let closes = 0
    let finishDecode: ((resource: { texture: ImageBitmap }) => void) | undefined
    let markDecoding: (() => void) | undefined
    const decoding = new Promise<void>((resolve) => (markDecoding = resolve))
    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const result = loadPreviewResource(
        '/resource/particle.scp',
        () => {
            markDecoding!()
            return new Promise<{ texture: ImageBitmap }>((resolve) => (finishDecode = resolve))
        },
        controller.signal,
    )
    await decoding
    controller.abort()
    finishDecode!({ texture: { close: () => closes++ } as ImageBitmap })
    assert.equal(await result, undefined)
    assert.equal(closes, 1)
})

test('canceled downloads do not start decoding', async (t) => {
    const controller = new AbortController()
    let finishDownload: ((buffer: ArrayBuffer) => void) | undefined
    let markDownloading: (() => void) | undefined
    const downloading = new Promise<void>((resolve) => (markDownloading = resolve))
    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        arrayBuffer: () => {
            markDownloading!()
            return new Promise<ArrayBuffer>((resolve) => (finishDownload = resolve))
        },
    }))
    const result = loadPreviewResource(
        '/resource/skin.scp',
        async () => assert.fail('canceled download decoded'),
        controller.signal,
    )
    await downloading
    controller.abort()
    finishDownload!(new ArrayBuffer(0))
    assert.equal(await result, undefined)
})
