import type { Entity } from '../../state/entities'
import { nameColorOn } from './nameColors'
import { drawText, measureText } from './text'
import type { EditorDrawContext } from './types'

type Box = { l: number; r: number; t: number; b: number }

/** A filled area a name can lie over: its own note's body, or a slide connector. */
export type NameFill = {
    /** The note whose names alone it affects; none for connectors. */
    owner?: Entity
    box: Box
    path: () => Path2D
    /** The opaque colours it shows at a height. */
    colorsAt: (y: number) => string[]
}

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
    /** Fills in drawing order. */
    fills: NameFill[]
}

export const createNameLayer = (): NameLayer => ({ names: [], dots: [], fills: [] })

const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

const nameBox = (name: Omit<NameRequest, 'owner' | 'highlighted' | 'alpha'>, width: number) => {
    const l =
        name.align === 'center'
            ? name.x - width / 2
            : name.align === 'end' || name.align === 'right'
              ? name.x - width
              : name.x
    return { l, r: l + width, t: name.y - name.size / 2, b: name.y + name.size / 2 }
}

// Clip to everything around the box but the path.
const clipOut = (ctx: CanvasRenderingContext2D, path: Path2D, box: Box) => {
    const outside = new Path2D()
    outside.rect(box.l - 1, box.t - 1, box.r - box.l + 2, box.b - box.t + 2)
    outside.addPath(path)
    ctx.clip(outside, 'evenodd')
}

/** Draws a name in its colour, and in a darker or lighter one over each fill it would not read on. */
const drawSplitName = (
    context: EditorDrawContext,
    name: Omit<NameRequest, 'owner' | 'highlighted' | 'alpha'>,
    box: Box,
    fills: NameFill[],
) => {
    const draw = (color: string) => {
        drawText(context, name.text, name.x, name.y, color, name.size, name.align)
    }
    const over = (box.r > box.l ? fills : [])
        .filter((fill) => overlaps(fill.box, box))
        .map((fill) => ({
            fill,
            color: nameColorOn(name.color, fill.colorsAt(name.y), !fill.owner),
        }))
    if (over.every(({ color }) => color === name.color)) {
        draw(name.color)
        return
    }
    const { ctx } = context
    const paths = over.map(({ fill }) => fill.path())
    ctx.save()
    for (const path of paths) clipOut(ctx, path, box)
    draw(name.color)
    ctx.restore()
    // Later fills cover earlier ones.
    for (const [index, { color }] of over.entries()) {
        ctx.save()
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ctx.clip(paths[index]!)
        for (const path of paths.slice(index + 1)) clipOut(ctx, path, box)
        draw(color)
        ctx.restore()
    }
}

// Every shown name is measured on every frame; keep widths for one font and zoom.
const noWidths = () => ({
    fontFamily: '',
    scale: 0,
    bySize: new Map<number, Map<string, number>>(),
})
let widths = noWidths()

/** Forgets measured names, as a loaded font changes their widths. */
export const clearNameWidths = () => {
    widths = noWidths()
}

const measureName = (context: EditorDrawContext, text: string, size: number) => {
    const { fontFamily, scale } = context
    if (widths.fontFamily !== fontFamily || widths.scale !== scale)
        widths = { fontFamily, scale, bySize: new Map() }
    let bySize = widths.bySize.get(size)
    if (!bySize) widths.bySize.set(size, (bySize = new Map<string, number>()))
    let width = bySize.get(text)
    if (width === undefined) {
        width = measureText(context, text, size)
        bySize.set(text, width)
    }
    return width
}

/** Records a fill names may lie over, when the frame places names. */
export const markFill = (context: EditorDrawContext, fill: NameFill) => {
    context.names?.fills.push(fill)
}

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
    body: NameFill[] = [],
) => {
    if (!context.names) {
        const name = { text, x, y, color, size, align }
        if (!body.length) drawText(context, text, x, y, color, size, align)
        else drawSplitName(context, name, nameBox(name, measureName(context, text, size)), body)
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

/** Draws the queued names, selected and hovered ones first, skipping any that would overlap. */
export const placeNames = (context: EditorDrawContext, { names, dots, fills }: NameLayer) => {
    const placed: Box[] = []
    const { ctx } = context
    ctx.save()
    for (const name of [
        ...names.filter(({ highlighted }) => highlighted),
        ...names.filter(({ highlighted }) => !highlighted),
    ]) {
        const width = measureName(context, name.text, name.size)
        if (!width) continue
        const box = nameBox(name, width)
        if (placed.some((other) => overlaps(box, other))) continue
        if (dots.some((dot) => dot.owner !== name.owner && overlaps(box, dot))) continue
        placed.push(box)
        ctx.globalAlpha = name.alpha
        if (!context.nameContrast) {
            drawText(context, name.text, name.x, name.y, name.color, name.size, name.align)
            continue
        }
        drawSplitName(
            context,
            name,
            box,
            fills.filter(({ owner }) => !owner || owner === name.owner),
        )
    }
    ctx.restore()
}
