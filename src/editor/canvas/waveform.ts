import type { Range } from '../../utils/range'
import { waveformDuration, type Waveform } from '../../waveform'
import type { EditorDrawContext } from './types'

export const createWaveformRenderer = (invalidate: () => void) => {
    let source: Waveform | undefined
    const images = new Map<string, HTMLImageElement>()
    const visible = new Set<string>()

    const clear = () => {
        for (const image of images.values()) image.onload = null
        images.clear()
        visible.clear()
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
            ctx.save()
            ctx.globalAlpha = 0.25
            ctx.imageSmoothingEnabled = waveform.style.imageRendering !== 'pixelated'
            ctx.translate(0, offset * -ups)
            ctx.scale(4, waveformDuration * -ups)
            for (let index = min; index <= max; index++) {
                const href = waveform.images[index]
                if (!href) continue
                visible.add(href)
                let image = images.get(href)
                if (!image) {
                    image = new Image()
                    image.onload = () => {
                        // Retained tiles can finish loading after a scroll. Only
                        // the latest visible range needs another chart draw.
                        if (visible.has(href)) invalidate()
                    }
                    image.src = href
                }
                // Keep a small working set as the user scrolls through long audio.
                images.delete(href)
                images.set(href, image)
                if (!image.complete || !image.naturalWidth) continue
                ctx.drawImage(image, 0, -index - 1, 1, 1)
                ctx.save()
                ctx.scale(-1, 1)
                ctx.drawImage(image, 0, -index - 1, 1, 1)
                ctx.restore()
            }
            ctx.restore()
            while (images.size > Math.max(32, max - min + 1)) {
                const first = images.entries().next().value
                if (!first) break
                first[1].onload = null
                images.delete(first[0])
            }
        },
    }
}
