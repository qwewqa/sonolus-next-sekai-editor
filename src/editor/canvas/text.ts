import type { EditorDrawContext } from './types'

// SVG's default white-space handling collapses these characters, but preserves
// nonbreaking and other Unicode spaces. Canvas only replaces ASCII whitespace.
export const normalizeSvgText = (text: string) =>
    text.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '')

// SVG middle is half the font's x-height above the alphabetic baseline; Canvas
// middle is the center of its em box. Resolve the font metric once on mount and
// font loading, at a large size to avoid CSS layout rounding at scene-unit sizes.
export const measureTextMiddle = (fontFamily: string, parent: HTMLElement) => {
    const probe = document.createElement('span')
    probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;display:block;width:0.5ex;height:0;padding:0;border:0'
    probe.style.font = `1000px ${fontFamily}`
    parent.append(probe)
    const middle = probe.getBoundingClientRect().width / 1000
    probe.remove()
    return middle
}

// Half the height of typical sans-serif figures, in ems.
export const FIGURE_MIDDLE = 0.35

// Figures stand taller than the x-height, so number labels centre on their ink.
export const measureFigureMiddle = (fontFamily: string) => {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return FIGURE_MIDDLE
    ctx.font = `1000px ${fontFamily}`
    const { actualBoundingBoxAscent, actualBoundingBoxDescent } = ctx.measureText('0123456789')
    const middle = (actualBoundingBoxAscent - actualBoundingBoxDescent) / 2000
    return middle > 0 ? middle : FIGURE_MIDDLE
}

/** A label's width in scene units, as drawText draws it. */
export const measureText = (
    { ctx, scale, fontFamily }: EditorDrawContext,
    text: string,
    size = 0.4,
) => {
    ctx.save()
    ctx.font = `${size * scale}px ${fontFamily}`
    ctx.fontKerning = 'normal'
    const { width } = ctx.measureText(normalizeSvgText(text))
    ctx.restore()
    return width / scale
}

/** Draws a label centred `middle` ems above its baseline: SVG middle by default. */
export const drawText = (
    { ctx, scale, fontFamily, fontMiddle }: EditorDrawContext,
    text: string,
    x: number,
    y: number,
    color: string,
    size = 0.4,
    align: CanvasTextAlign = 'center',
    middle = fontMiddle,
) => {
    const normalized = normalizeSvgText(text)
    if (!normalized) return
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1 / scale, 1 / scale)
    // Shape at the displayed CSS size, avoiding subpixel font-size quantization
    // and kerning heuristics on a 0.4px font subsequently magnified by the CTM.
    const fontSize = size * scale
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.fontKerning = 'normal'
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = align
    ctx.fillStyle = color
    ctx.fillText(normalized, 0, fontSize * middle)
    ctx.restore()
}
