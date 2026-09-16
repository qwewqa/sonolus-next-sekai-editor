import type { CanvasBounds } from './types'

// Changing the backing dimensions clears all Canvas state and allocates a new
// surface. Only do that on a real resize, never on an ordinary scroll or edit.
export const prepareSurface = (
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    pixelRatio: number,
    bounds: CanvasBounds,
) => {
    const w = Math.max(1, Math.round(width * pixelRatio))
    const h = Math.max(1, Math.round(height * pixelRatio))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // Explicitly replace the pixels, including on frames with no visible
    // drawing. Chromium's deferred Canvas backend can retain old outlines after
    // clearRect when the next stroke lies offscreen. This avoids a readback or
    // backing-store reallocation to flush that clear.
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'copy'
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
    const scale = width / bounds.w
    const s = scale * pixelRatio
    ctx.setTransform(s, 0, 0, s, -bounds.l * s, -bounds.t * s)
    ctx.lineWidth = 2 / scale
    return ctx
}

// Coalesce all invalidations into the next frame. In particular, do not cancel
// and reschedule on playback updates, which could starve a pending draw.
export const createFrameScheduler = () => {
    let id = 0
    let draw: (() => void) | undefined
    return {
        schedule(next: () => void) {
            draw = next
            if (id) return
            id = requestAnimationFrame(() => {
                id = 0
                const current = draw
                draw = undefined
                current?.()
            })
        },
        cancel() {
            cancelAnimationFrame(id)
            id = 0
            draw = undefined
        },
    }
}
