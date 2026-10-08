import type { Entity } from '../../state/entities'
import { nameColorOn } from './nameColors'
import { drawText, measureText, normalizeSvgText } from './text'
import type { EditorDrawContext } from './types'

type Box = { l: number; r: number; t: number; b: number }

/** A filled area a name can lie over: its own note's body, or a slide connector. */
export type NameFill = {
    /** The note whose names alone it affects; none for connectors. */
    owner?: Entity
    box: Box
    /** Its outline as shapes that may overlap, all wound the same way. */
    shapes: () => Path2D[]
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

/** A frame's stage and group names, drawn after every object. */
export type NameLayer = {
    names: NameRequest[]
    /** Fills in drawing order. */
    fills: NameFill[]
}

export const createNameLayer = (): NameLayer => ({ names: [], fills: [] })

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

// Clip to everything around the box but the shapes, one at a time so overlaps stay out.
const clipOut = (ctx: CanvasRenderingContext2D, shapes: Path2D[], box: Box) => {
    for (const shape of shapes) {
        const outside = new Path2D()
        outside.rect(box.l - 1, box.t - 1, box.r - box.l + 2, box.b - box.t + 2)
        outside.addPath(shape)
        ctx.clip(outside, 'evenodd')
    }
}

// Like-wound shapes clip in as one nonzero union.
const union = (shapes: Path2D[]) => {
    const [only] = shapes
    if (only && shapes.length === 1) return only
    const path = new Path2D()
    for (const shape of shapes) path.addPath(shape)
    return path
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
    const shapes = over.map(({ fill }) => fill.shapes())
    ctx.save()
    clipOut(ctx, shapes.flat(), box)
    draw(name.color)
    ctx.restore()
    // Later fills cover earlier ones.
    for (const [index, { color }] of over.entries()) {
        ctx.save()
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ctx.clip(union(shapes[index]!))
        clipOut(ctx, shapes.slice(index + 1).flat(), box)
        draw(color)
        ctx.restore()
    }
}

// Every shown name is measured on every frame; keep widths for each canvas's font and zoom.
const widths = new Map<string, Map<number, Map<string, number>>>()
const maxWidthKeys = 4

/** Forgets measured names, as a loaded font changes their widths. */
export const clearNameWidths = () => {
    widths.clear()
}

const measureName = (context: EditorDrawContext, text: string, size: number) => {
    const key = `${context.fontFamily}|${context.scale}`
    // Most recently used last; old zooms go first.
    const byKey = widths.get(key) ?? new Map<number, Map<string, number>>()
    widths.delete(key)
    widths.set(key, byKey)
    for (const old of widths.keys()) {
        if (widths.size <= maxWidthKeys) break
        widths.delete(old)
    }
    let bySize = byKey.get(size)
    if (!bySize) byKey.set(size, (bySize = new Map<string, number>()))
    let width = bySize.get(text)
    if (width === undefined) {
        width = measureText(context, text, size)
        bySize.set(text, width)
    }
    return width
}

const ellipsis = '…'
const graphemes = new Intl.Segmenter()

/** Cuts a name at the pane's side with an ellipsis; none when even that has no room. */
const fitName = <T extends Omit<NameRequest, 'owner' | 'highlighted' | 'alpha'>>(
    context: EditorDrawContext,
    name: T,
): T | undefined => {
    const box = nameBox(name, measureName(context, name.text, name.size))
    const { l, r } = context.bounds
    if (box.l >= l && box.r <= r) return name
    // Keep the start unless only the start runs past.
    const keepStart = box.r > r
    const from = Math.max(box.l, l)
    const room = (keepStart ? r : box.r) - from
    const parts = [...graphemes.segment(normalizeSvgText(name.text))].map(({ segment }) => segment)
    const cut = (count: number) =>
        keepStart
            ? parts.slice(0, count).join('') + ellipsis
            : ellipsis + parts.slice(parts.length - count).join('')
    const fits = (count: number) => measureText(context, cut(count), name.size) <= room
    if (!fits(0)) return
    let low = 0
    let high = parts.length - 1
    while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (fits(mid)) low = mid
        else high = mid - 1
    }
    return keepStart
        ? { ...name, text: cut(low), x: from, align: 'left' }
        : { ...name, text: cut(low), x: box.r, align: 'right' }
}

/** Records a fill names may lie over, when the frame places names. */
export const markFill = (context: EditorDrawContext, fill: NameFill) => {
    context.names?.fills.push(fill)
}

// Stage names lighten only where contrast redraws them over fills.
export const stageNameColor = (context: EditorDrawContext) =>
    context.nameContrast ? '#f6f' : '#a0a'

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
        const name = fitName(context, { text, x, y, color, size, align })
        if (!name) return
        if (!body.length) drawText(context, name.text, name.x, y, color, size, name.align)
        else
            drawSplitName(context, name, nameBox(name, measureName(context, name.text, size)), body)
        return
    }
    const alpha = context.ctx.globalAlpha
    context.names.names.push({ owner, highlighted, text, x, y, color, size, align, alpha })
}

/** Draws the queued names, selected and hovered ones last so they lie on top. */
export const placeNames = (context: EditorDrawContext, { names, fills }: NameLayer) => {
    const { ctx } = context
    ctx.save()
    for (const queued of [
        ...names.filter(({ highlighted }) => !highlighted),
        ...names.filter(({ highlighted }) => highlighted),
    ]) {
        const name = fitName(context, queued)
        if (!name) continue
        ctx.globalAlpha = name.alpha
        if (!context.nameContrast) {
            drawText(context, name.text, name.x, name.y, name.color, name.size, name.align)
            continue
        }
        drawSplitName(
            context,
            name,
            nameBox(name, measureName(context, name.text, name.size)),
            fills.filter(({ owner }) => !owner || owner === name.owner),
        )
    }
    ctx.restore()
}
