import type { Range } from '../../utils/range'
import { waveformDuration, type Waveform } from '../../waveform'
import type { EditorDrawContext } from './types'

const MAX_TILE_BYTES = 16 * 1024 * 1024
const MAX_TILES = 32

type Tile = {
    image: HTMLImageElement
    reductions: HTMLCanvasElement[]
    bytes: number
}

// Waveform tiles contain white pixels with amplitude encoded in alpha. Taking
// the strongest of each adjacent row pair keeps narrow attacks visible when
// zooming out. Browser bilinear reduction can entirely skip individual rows,
// and Firefox does not support imageSmoothingQuality to change that behavior.
const reduceTile = (image: HTMLImageElement | HTMLCanvasElement) => {
    const width = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth
    const height = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Unexpected missing canvas context')
    ctx.drawImage(image, 0, 0)
    const source = ctx.getImageData(0, 0, width, height).data
    const target = ctx.createImageData(width, Math.ceil(height / 2))
    target.data.fill(255)
    for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < width; x++) {
            const first = (y * 2 * width + x) * 4 + 3
            target.data[(y * width + x) * 4 + 3] = Math.max(
                source[first] ?? 0,
                source[first + width * 4] ?? 0,
            )
        }
    }
    canvas.height = target.height
    ctx.putImageData(target, 0, 0)
    return canvas
}

export const createWaveformRenderer = (invalidate: () => void) => {
    let source: Waveform | undefined
    const images = new Map<string, Tile>()
    const visible = new Set<string>()
    let bytes = 0

    const prune = () => {
        for (const [href, entry] of images) {
            if (bytes <= MAX_TILE_BYTES && images.size <= MAX_TILES) break
            // Never evict part of the current frame's working set: doing so can
            // trigger a decode/redraw loop when many tiles are visible together.
            if (visible.has(href)) continue
            entry.image.onload = null
            images.delete(href)
            bytes -= entry.bytes
        }
    }

    const clear = () => {
        for (const { image } of images.values()) image.onload = null
        images.clear()
        visible.clear()
        bytes = 0
        source = undefined
    }

    return {
        clear,
        draw(
            { ctx, ups }: EditorDrawContext,
            waveform: Waveform | undefined,
            offset: number,
            times: Range<number>,
        ) {
            if (source !== waveform) {
                clear()
                source = waveform
            }
            visible.clear()
            if (!waveform) return

            const min = Math.max(0, Math.floor((times.min + offset) / waveformDuration))
            const max = Math.min(
                waveform.images.length - 1,
                Math.floor((times.max + offset) / waveformDuration),
            )
            for (let index = min; index <= max; index++) {
                const href = waveform.images[index]
                if (href) visible.add(href)
            }
            // prepareSurface rounds the backing dimensions. Its actual scale
            // can be slightly below scale * DPR, so use the installed transform
            // to avoid dropping isolated rows at a reduction threshold.
            const tilePixels = waveformDuration * Math.abs(ups * ctx.getTransform().d)
            ctx.save()
            ctx.globalAlpha = 0.25
            ctx.translate(0, offset * -ups)
            ctx.scale(4, waveformDuration * -ups)
            for (let index = min; index <= max; index++) {
                const href = waveform.images[index]
                if (!href) continue
                let entry = images.get(href)
                if (!entry) {
                    const image = new Image()
                    const created: Tile = { image, reductions: [], bytes: 0 }
                    entry = created
                    images.set(href, entry)
                    image.onload = () => {
                        if (images.get(href) !== created) return
                        bytes -= created.bytes
                        created.reductions.length = 0
                        created.bytes = image.naturalWidth * image.naturalHeight * 4
                        bytes += created.bytes
                        // Retained tiles can finish loading after a scroll. Only
                        // the latest visible range needs another chart draw.
                        if (visible.has(href)) invalidate()
                        prune()
                    }
                    image.src = href
                }
                // Keep recently used tiles within both decoded-pixel and count
                // limits; pending images have no known decoded dimensions yet.
                images.delete(href)
                images.set(href, entry)
                const { image } = entry
                if (!image.complete || !image.naturalWidth) continue
                let rendered: HTMLImageElement | HTMLCanvasElement = image
                let height = image.naturalHeight
                if (waveform.style.imageRendering === 'pixelated') {
                    for (let level = 0; height > Math.max(1, tilePixels); level++) {
                        let reduced = entry.reductions[level]
                        if (!reduced) {
                            reduced = reduceTile(rendered)
                            entry.reductions.push(reduced)
                            const addedBytes = reduced.width * reduced.height * 4
                            entry.bytes += addedBytes
                            bytes += addedBytes
                        }
                        rendered = reduced
                        height = reduced.height
                    }
                    ctx.imageSmoothingEnabled = false
                } else {
                    ctx.imageSmoothingEnabled = true
                }
                ctx.drawImage(rendered, 0, -index - 1, 1, 1)
                ctx.save()
                ctx.scale(-1, 1)
                ctx.drawImage(rendered, 0, -index - 1, 1, 1)
                ctx.restore()
            }
            ctx.restore()
            prune()
        },
    }
}
