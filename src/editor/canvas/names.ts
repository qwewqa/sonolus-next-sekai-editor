import type { Entity } from '../../state/entities'
import { drawText, measureText } from './text'
import type { EditorDrawContext } from './types'

type Box = { l: number; r: number; t: number; b: number }

type NameRequest = {
    owner: Entity
    highlighted: boolean
    text: string
    x: number
    y: number
    color: string
    size: number
    align: CanvasTextAlign
    alpha: number
}

/** A frame's stage and group names, placed after every object so they yield to each other. */
export type NameLayer = {
    names: NameRequest[]
    dots: (Box & { owner: Entity })[]
}

export const createNameLayer = (): NameLayer => ({ names: [], dots: [] })

/** Draws a name now, or queues it when the frame places names. */
export const drawName = (
    context: EditorDrawContext,
    owner: Entity,
    highlighted: boolean,
    text: string,
    x: number,
    y: number,
    color: string,
    size = 0.4,
    align: CanvasTextAlign = 'center',
) => {
    if (!context.names) {
        drawText(context, text, x, y, color, size, align)
        return
    }
    const alpha = context.ctx.globalAlpha
    context.names.names.push({ owner, highlighted, text, x, y, color, size, align, alpha })
}

/** An event dot that other objects' names keep clear of. */
export const markDot = (
    context: EditorDrawContext,
    owner: Entity,
    x: number,
    y: number,
    r: number,
) => {
    // Include the outline stroke.
    const extent = r + 1 / context.scale
    context.names?.dots.push({ owner, l: x - extent, r: x + extent, t: y - extent, b: y + extent })
}

const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/** Draws the queued names, selected and hovered ones first, skipping any that would overlap. */
export const placeNames = (context: EditorDrawContext, { names, dots }: NameLayer) => {
    const placed: Box[] = []
    const { ctx } = context
    ctx.save()
    for (const name of [
        ...names.filter(({ highlighted }) => highlighted),
        ...names.filter(({ highlighted }) => !highlighted),
    ]) {
        const width = measureText(context, name.text, name.size)
        if (!width) continue
        const l =
            name.align === 'center'
                ? name.x - width / 2
                : name.align === 'end' || name.align === 'right'
                  ? name.x - width
                  : name.x
        const box = { l, r: l + width, t: name.y - name.size / 2, b: name.y + name.size / 2 }
        if (placed.some((other) => overlaps(box, other))) continue
        if (dots.some((dot) => dot.owner !== name.owner && overlaps(box, dot))) continue
        placed.push(box)
        ctx.globalAlpha = name.alpha
        drawText(context, name.text, name.x, name.y, name.color, name.size, name.align)
    }
    ctx.restore()
}
