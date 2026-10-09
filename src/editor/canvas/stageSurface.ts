import type { Range } from '../../utils/range'
import type { ScopeLookup } from '../scopeRules'
import { drawComposedStages } from './stages'
import { prepareSurface } from './surface'
import type { EditorDrawContext } from './types'

// One viewport, at most 32 MiB of RGBA pixels. Larger screens draw directly
// instead of retaining another unbounded backing store beside the chart.
const MAX_PIXELS = 8 * 1024 * 1024

/** Retains the composed stage pixels across note/selection-only chart redraws. */
export const createStageSurface = () => {
    let canvas: HTMLCanvasElement | undefined
    let surfaceContext: CanvasRenderingContext2D | undefined
    let previous: readonly unknown[] | undefined

    const clear = () => {
        if (canvas) canvas.width = canvas.height = 0
        canvas = undefined
        surfaceContext = undefined
        previous = undefined
    }

    return {
        draw(
            context: EditorDrawContext,
            width: number,
            height: number,
            beats: Range<number>,
            scope: ScopeLookup,
            laneDivision: number,
        ) {
            const { composed, bounds, pixelRatio, scale, ups } = context
            if (!composed) {
                clear()
                return
            }
            // Older Canvas implementations do not expose context-loss queries.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (surfaceContext?.isContextLost?.()) clear()
            const pixels =
                Math.max(1, Math.round(width * pixelRatio)) *
                Math.max(1, Math.round(height * pixelRatio))
            if (
                !Number.isFinite(pixels) ||
                pixels > MAX_PIXELS ||
                width <= 0 ||
                height <= 0 ||
                pixelRatio <= 0
            ) {
                clear()
                drawComposedStages(context, beats, scope, laneDivision)
                return
            }
            const key = [
                composed.stages,
                context.state.bpms,
                width,
                height,
                pixelRatio,
                scale,
                ups,
                bounds.l,
                bounds.r,
                bounds.t,
                bounds.b,
                bounds.w,
                bounds.h,
                beats.min,
                beats.max,
                laneDivision,
                ...[...composed.stages.keys()].map((id) => scope.stage(id)),
            ]
            if (
                previous?.length !== key.length ||
                key.some((value, i) => value !== previous?.[i])
            ) {
                canvas ??= document.createElement('canvas')
                const ctx = prepareSurface(canvas, width, height, pixelRatio, bounds)
                if (!ctx) {
                    clear()
                    drawComposedStages(context, beats, scope, laneDivision)
                    return
                }
                drawComposedStages({ ...context, ctx }, beats, scope, laneDivision)
                surfaceContext = ctx
                previous = key
            }
            if (!canvas) return
            context.ctx.save()
            // The cached surface uses exactly the chart's backing dimensions and
            // viewport transform; copying at integer pixels adds no resampling.
            context.ctx.setTransform(1, 0, 0, 1, 0, 0)
            context.ctx.globalAlpha = 1
            context.ctx.drawImage(canvas, 0, 0)
            context.ctx.restore()
        },
        clear,
    }
}
