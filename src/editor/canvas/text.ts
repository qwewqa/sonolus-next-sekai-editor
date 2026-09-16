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

export const drawText = (
    { ctx, scale, fontFamily, fontMiddle }: EditorDrawContext,
    text: string,
    x: number,
    y: number,
    color: string,
    size = 0.4,
    align: CanvasTextAlign = 'center',
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
    ctx.fillText(normalized, 0, fontSize * fontMiddle)
    ctx.restore()
}
