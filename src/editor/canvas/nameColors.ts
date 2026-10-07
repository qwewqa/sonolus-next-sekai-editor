// The chart background (Tailwind `bg`), under translucent fills.
export const CHART_BACKGROUND = '#404464'

type Rgb = [number, number, number]

const parse = (color: string): Rgb => {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

const format = (rgb: Rgb) =>
    `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

const luminance = (color: string) => {
    const [r, g, b] = parse(color).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #rgb or #rrggbb colours. */
export const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (high + 0.05) / (low + 0.05)
}

/** A fill as seen over the chart background at an opacity. */
export const blendOverChart = (color: string, alpha: number) => {
    if (alpha >= 1) return color
    const fill = parse(color)
    const background = parse(CHART_BACKGROUND)
    const a = Math.max(0, alpha)
    return format(fill.map((v, i) => v * a + (background[i] ?? 0) * (1 - a)) as Rgb)
}

// The dark pair first, then darker and lighter steps of the same hue.
const ladders: Record<string, string[]> = {
    '#f6f': ['#a0a', '#808', '#606', '#404', '#202', '#fdf', '#fff'],
    '#0aa': ['#077', '#055', '#044', '#033', '#022', '#dff', '#fff'],
}

const TARGET = 4.5
const cache = new Map<string, string>()

/**
 * The colour a name takes over a fill of one or more colours: its own wherever
 * it reads at least as well as on the chart background, otherwise the first
 * step reaching 4.5:1 on all of them.
 */
export const nameColorOn = (color: string, fills: readonly string[]) => {
    const key = `${color}:${fills.join()}`
    let result = cache.get(key)
    if (result) return result
    const ladder = ladders[color]
    const worst = (step: string) => Math.min(...fills.map((fill) => contrast(step, fill)))
    if (!ladder || worst(color) >= Math.min(TARGET, contrast(color, CHART_BACKGROUND))) {
        result = color
    } else {
        result =
            ladder.find((step) => worst(step) >= TARGET) ??
            [color, ...ladder].reduce((best, step) => (worst(step) > worst(best) ? step : best))
    }
    cache.set(key, result)
    return result
}
