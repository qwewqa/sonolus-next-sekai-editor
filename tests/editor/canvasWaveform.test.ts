import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import type { Waveform } from '../../src/waveform'

// The waveform module installs a browser audio compatibility alias at import.
// Rendering these already-generated tiles does not use an audio context.
const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext')
Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: class {} })
const { createWaveformRenderer } = await import('../../src/editor/canvas/waveform')
if (originalAudio) Object.defineProperty(globalThis, 'OfflineAudioContext', originalAudio)
else Reflect.deleteProperty(globalThis, 'OfflineAudioContext')

const fixture = (t: TestContext) => {
    const images: TestImage[] = []
    class TestImage {
        src = ''
        complete = false
        naturalWidth = 0
        onload: (() => void) | null = null

        constructor() {
            images.push(this)
        }

        load() {
            this.complete = true
            this.naturalWidth = 50
            this.onload?.()
        }
    }
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: TestImage })
    t.after(() => {
        if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage)
        else Reflect.deleteProperty(globalThis, 'Image')
    })

    let invalidations = 0
    const drawn: TestImage[] = []
    const ctx = {
        save() {},
        restore() {},
        translate() {},
        scale() {},
        drawImage(image: TestImage) {
            drawn.push(image)
        },
    }
    const renderer = createWaveformRenderer(() => invalidations++)
    const waveform: Waveform = {
        images: Array.from({ length: 40 }, (_, index) => `tile-${index}`),
        style: { imageRendering: 'pixelated' },
    }
    const context = { ctx, ups: -1 } as unknown as EditorDrawContext
    const draw = (index: number, source: Waveform | undefined = waveform, offset = 0) =>
        renderer.draw(context, source, offset, { min: index * 10, max: index * 10 + 9 })
    return { renderer, waveform, images, drawn, draw, invalidations: () => invalidations }
}

test('waveform loads invalidate only the latest visible tiles after scrolling back and forth', (t) => {
    const { images, drawn, draw, invalidations } = fixture(t)
    draw(0)
    draw(1)
    draw(2)
    images[0]!.load()
    assert.equal(invalidations(), 0, 'a retained offscreen tile does not redraw the chart')

    draw(1)
    images[2]!.load()
    assert.equal(invalidations(), 0, 'completion does not use a previously visible range')
    images[1]!.load()
    assert.equal(invalidations(), 1, 'a pending tile brought back into view still invalidates')

    draw(0)
    assert.equal(images.length, 3, 'returning to a loaded tile reuses the cached image')
    assert.deepEqual(drawn, [images[0], images[0]], 'the loaded tile renders both mirrored halves')
})

test('waveform offset changes update which delayed completions are visible', (t) => {
    const { waveform, images, draw, invalidations } = fixture(t)
    draw(0)
    draw(0, waveform, 10)
    images[0]!.load()
    assert.equal(invalidations(), 0)
    images[1]!.load()
    assert.equal(invalidations(), 1)
})

test('disabling, replacing and clearing waveform releases pending load callbacks', (t) => {
    const { renderer, waveform, images, draw, invalidations } = fixture(t)
    draw(0)
    renderer.draw({} as EditorDrawContext, undefined, 0, { min: 0, max: 9 })
    assert.equal(images[0]!.onload, null)
    images[0]!.load()
    assert.equal(invalidations(), 0)

    draw(0)
    // Even when URL strings match, a new source owns a new image/callback.
    draw(0, { ...waveform })
    assert.equal(images[1]!.onload, null)
    images[1]!.load()
    assert.equal(invalidations(), 0)
    images[2]!.load()
    assert.equal(invalidations(), 1)

    draw(1)
    renderer.clear()
    assert.ok(images.every((image) => image.onload === null))
    images[3]!.load()
    assert.equal(invalidations(), 1)
})

test('waveform eviction detaches callbacks while retaining pending tiles in the working set', (t) => {
    const { images, draw, invalidations } = fixture(t)
    for (let index = 0; index < 40; index++) draw(index)
    assert.equal(images.filter((image) => image.onload !== null).length, 32)
    for (const image of images.slice(0, 39)) image.load()
    assert.equal(invalidations(), 0, 'neither evicted nor retained offscreen loads redraw')
    images[39]!.load()
    assert.equal(invalidations(), 1)
})
