import { expect, test } from '@playwright/test'
import type { EditorDrawContext } from '../../src/editor/canvas/types'

type Label = { text: string; align: 'start' | 'center' | 'end'; size?: number; color?: string }
type TextCase = {
    name: string
    fontFamily: string
    scale: number
    direction?: 'ltr' | 'rtl'
    labels: Label[]
}

const systemFont = 'ui-sans-serif, system-ui, sans-serif'
const cases: TextCase[] = [
    {
        name: 'time numbers on the left of the grid',
        fontFamily: systemFont,
        scale: 37.375,
        labels: [{ text: '01:23', align: 'end' }],
    },
    {
        name: 'BPM labels on the right of the grid',
        fontFamily: systemFont,
        scale: 51.625,
        labels: [{ text: '120', align: 'start', size: 0.5 }],
    },
    {
        name: 'time-scale label at a fractional zoom',
        fontFamily: systemFont,
        scale: 23.7,
        labels: [{ text: '1x+0.5^', align: 'start', size: 0.5 }],
    },
    {
        name: 'centered stage name with kerning',
        fontFamily: 'Arial',
        scale: 40,
        labels: [{ text: 'Stage A', align: 'center' }],
    },
    {
        name: 'paired stage and group names',
        fontFamily: systemFont,
        scale: 47.25,
        labels: [
            { text: 'Stage A', align: 'end', color: '#a0a' },
            { text: 'Group B', align: 'start', color: '#0aa' },
        ],
    },
    {
        name: 'paired names with collapsed ASCII spaces and preserved nonbreaking spaces',
        fontFamily: 'Arial',
        scale: 43.3,
        labels: [
            { text: ' \tStage  A\n ', align: 'end', color: '#a0a' },
            { text: '\u00a0Group\u00a0', align: 'start', color: '#0aa' },
        ],
    },
    {
        name: 'centered CJK name with a Japanese font',
        fontFamily: '"Yu Gothic", sans-serif',
        scale: 52.125,
        labels: [{ text: '\u821e\u53f0\u540d', align: 'center' }],
    },
    {
        name: 'mixed CJK and Latin name with system font fallback',
        fontFamily: systemFont,
        scale: 39.75,
        labels: [{ text: '\u821e\u53f0 Stage A', align: 'center' }],
    },
    {
        name: 'logical start anchor with inherited right-to-left direction',
        fontFamily: 'Arial',
        scale: 46.625,
        direction: 'rtl',
        labels: [{ text: '\u05e9\u05dc\u05d5\u05dd', align: 'start' }],
    },
]

for (const pixelRatio of [1, 1.25, 2]) {
    test(`Canvas text matches SVG alignment at pixel ratio ${pixelRatio}`, async ({ page }) => {
        await page.goto('/')
        await page.evaluate(() => document.fonts.ready)
        const results = await page.evaluate(
            async ({ cases, pixelRatio }) => {
                const modulePath = '/src/editor/canvas/text.ts'
                const { drawText, measureTextMiddle } = (await import(
                    modulePath
                )) as typeof import('../../src/editor/canvas/text')
                const width = 512
                const height = 160
                const results = []
                for (const item of cases) {
                    const parent = document.createElement('div')
                    parent.style.cssText = 'position:absolute;left:-10000px;top:0'
                    parent.dir = item.direction ?? 'ltr'
                    document.body.append(parent)
                    const canvas = document.createElement('canvas')
                    canvas.width = width * pixelRatio
                    canvas.height = height * pixelRatio
                    parent.append(canvas)
                    const ctx = canvas.getContext('2d')!
                    ctx.setTransform(item.scale * pixelRatio, 0, 0, item.scale * pixelRatio, 0, 0)
                    const context = {
                        ctx,
                        scale: item.scale,
                        pixelRatio,
                        fontFamily: item.fontFamily,
                        fontMiddle: measureTextMiddle(item.fontFamily, parent),
                    } as EditorDrawContext
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
                    svg.setAttribute('width', String(canvas.width))
                    svg.setAttribute('height', String(canvas.height))
                    svg.setAttribute('viewBox', `0 0 ${width / item.scale} ${height / item.scale}`)
                    svg.setAttribute('direction', parent.dir)
                    const anchorX = 256 / item.scale
                    const anchorY = 80 / item.scale
                    for (const label of item.labels) {
                        const size = label.size ?? 0.4
                        const color = label.color ?? '#fff'
                        drawText(context, label.text, anchorX, anchorY, color, size, label.align)
                        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
                        text.setAttribute('x', String(anchorX))
                        text.setAttribute('y', String(anchorY))
                        text.setAttribute('font-family', item.fontFamily)
                        text.setAttribute('font-size', String(size))
                        text.setAttribute('dominant-baseline', 'middle')
                        text.setAttribute(
                            'text-anchor',
                            label.align === 'center' ? 'middle' : label.align,
                        )
                        text.setAttribute('fill', color)
                        text.textContent = label.text
                        svg.append(text)
                    }
                    // Rasterize the original SVG text semantics independently of the
                    // Canvas helper. Comparing real ink catches baseline and anchor
                    // regressions that recorded fillText coordinates cannot detect.
                    const url = URL.createObjectURL(
                        new Blob([new XMLSerializer().serializeToString(svg)], {
                            type: 'image/svg+xml',
                        }),
                    )
                    const image = new Image()
                    image.src = url
                    await image.decode()
                    const reference = document.createElement('canvas')
                    reference.width = canvas.width
                    reference.height = canvas.height
                    const referenceContext = reference.getContext('2d')!
                    referenceContext.drawImage(image, 0, 0)
                    URL.revokeObjectURL(url)
                    const measureInk = (target: CanvasRenderingContext2D) => {
                        const pixels = target.getImageData(0, 0, canvas.width, canvas.height).data
                        let left = canvas.width
                        let right = -1
                        let top = canvas.height
                        let bottom = -1
                        let alpha = 0
                        let xSum = 0
                        let ySum = 0
                        for (let y = 0; y < canvas.height; y++) {
                            for (let x = 0; x < canvas.width; x++) {
                                const value = pixels[(y * canvas.width + x) * 4 + 3]!
                                alpha += value
                                xSum += x * value
                                ySum += y * value
                                if (value < 16) continue
                                left = Math.min(left, x)
                                right = Math.max(right, x)
                                top = Math.min(top, y)
                                bottom = Math.max(bottom, y)
                            }
                        }
                        return { left, right, top, bottom, x: xSum / alpha, y: ySum / alpha, alpha }
                    }
                    results.push({
                        name: item.name,
                        actual: measureInk(ctx),
                        reference: measureInk(referenceContext),
                    })
                    parent.remove()
                }
                return results
            },
            { cases, pixelRatio },
        )
        for (const { name, actual, reference } of results) {
            expect(actual.alpha, `${name}: visible text`).toBeGreaterThan(0)
            for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
                expect(
                    Math.abs(actual[edge] - reference[edge]),
                    `${name}: ${edge} ink edge`,
                ).toBeLessThanOrEqual(1)
            }
            expect(
                Math.abs(actual.x - reference.x),
                `${name}: horizontal ink alignment`,
            ).toBeLessThan(0.6)
            expect(
                Math.abs(actual.y - reference.y),
                `${name}: vertical ink alignment`,
            ).toBeLessThan(0.6)
        }
    })
}
