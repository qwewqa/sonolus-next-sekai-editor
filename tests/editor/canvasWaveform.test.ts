import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { createWaveformRenderer } from '../../src/editor/canvas/waveform'
import type { Waveform } from '../../src/waveform'

const fixture = (t: TestContext) => {
    const images: TestImage[] = []
    class TestImage {
        src = ''
        complete = false
        naturalWidth = 0
        naturalHeight = 0
        onload: (() => void) | null = null

        constructor() {
            images.push(this)
        }

        load(width = 50, height = 1000) {
            this.complete = true
            this.naturalWidth = width
            this.naturalHeight = height
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
        imageSmoothingEnabled: true,
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
    const context = { ctx, ups: -200, scale: 1, pixelRatio: 1 } as unknown as EditorDrawContext
    const draw = (index: number, source: Waveform | undefined = waveform, offset = 0) =>
        renderer.draw(context, source, offset, { min: index * 10, max: index * 10 + 9 })
    return {
        renderer,
        waveform,
        images,
        drawn,
        draw,
        context,
        ctx,
        invalidations: () => invalidations,
    }
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

test('decoded waveform tiles obey the byte budget and retain recently used images', (t) => {
    const { images, draw, invalidations } = fixture(t)
    for (let index = 0; index < 4; index++) {
        draw(index)
        images[index]!.load(1024, 1024)
    }
    draw(0)
    draw(4)
    images[4]!.load(1024, 1024)
    assert.equal(images[1]!.onload, null, 'least recently used tile is released at 16 MiB')
    assert.notEqual(images[0]!.onload, null, 'recently used tile remains decoded')
    assert.equal(images.filter((image) => image.onload !== null).length, 4)
    assert.equal(invalidations(), 5)

    draw(0)
    assert.equal(images.length, 5, 'returning to the retained tile does not decode it again')
    draw(1)
    assert.equal(images.length, 6, 'returning to an evicted tile loads it again')
    draw(2)
    const before = invalidations()
    images[5]!.load(1024, 1024)
    assert.equal(invalidations(), before, 'an offscreen completion prunes without redrawing')
    assert.equal(images.filter((image) => image.onload !== null).length, 4)
})

test('visible waveform tiles remain resident when their working set exceeds the cache budget', (t) => {
    const { renderer, waveform, images, context, draw } = fixture(t)
    const drawWide = () => renderer.draw(context, waveform, 0, { min: 0, max: 49 })
    drawWide()
    for (const image of images) image.load(1024, 1024)
    drawWide()
    assert.equal(images.length, 5, 'all visible tiles are pinned even above the byte budget')
    assert.ok(images.every((image) => image.onload !== null))

    draw(4)
    assert.equal(images[0]!.onload, null, 'scrolling releases excess tiles from the old frame')
    assert.equal(images.filter((image) => image.onload !== null).length, 4)
})
