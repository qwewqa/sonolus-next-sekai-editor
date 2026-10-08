import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectorRenderer } from '../../src/editor/canvas/connectors'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { toConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { calculateBpms } from '../../src/state/integrals/bpms'

type Command = [string, ...number[]]

class RecordedPath {
    commands: Command[] = []
    moveTo(...values: number[]) {
        this.commands.push(['M', ...values])
    }
    lineTo(...values: number[]) {
        this.commands.push(['L', ...values])
    }
    quadraticCurveTo(...values: number[]) {
        this.commands.push(['Q', ...values])
    }
    rect(...values: number[]) {
        this.commands.push(['R', ...values])
    }
    closePath() {
        this.commands.push(['Z'])
    }
}

const originalPath = globalThis.Path2D
globalThis.Path2D = RecordedPath as unknown as typeof Path2D
test.after(() => {
    globalThis.Path2D = originalPath
})

const note = (beat: number, left: number, size: number, extra: Partial<NoteEntity> = {}) =>
    ({
        type: 'note',
        beat,
        left,
        size,
        connectorEase: 'linear',
        connectorType: 'active',
        connectorStyle: extra.connectorType === 'guide' ? 'blue' : 'default',
        connectorActiveIsCritical: false,
        connectorIsFake: false,
        connectorGuideAlpha: 1,
        ...extra,
    }) as NoteEntity

const fixture = () => {
    type Style = string | { points: number[]; stops: [number, string][] }
    const fills: { path: RecordedPath; alpha: number; style: Style }[] = []
    const strokes: { path: RecordedPath; alpha: number; width: number; style: string }[] = []
    const gradients: Exclude<Style, string>[] = []
    const stack: {
        globalAlpha: number
        fillStyle: Style
        strokeStyle: string
        lineWidth: number
        lineCap: string
    }[] = []
    const ctx = {
        globalAlpha: 1,
        fillStyle: '#000' as Style,
        strokeStyle: '#000',
        lineWidth: 1,
        lineCap: 'round',
        save() {
            stack.push({
                globalAlpha: this.globalAlpha,
                fillStyle: this.fillStyle,
                strokeStyle: this.strokeStyle,
                lineWidth: this.lineWidth,
                lineCap: this.lineCap,
            })
        },
        restore() {
            Object.assign(this, stack.pop())
        },
        fill(path: RecordedPath) {
            fills.push({ path, alpha: this.globalAlpha, style: this.fillStyle })
        },
        stroke(path: RecordedPath) {
            strokes.push({
                path,
                alpha: this.globalAlpha,
                width: this.lineWidth,
                style: this.strokeStyle,
            })
        },
        setLineDash() {},
        clip() {},
        createLinearGradient(...points: number[]) {
            const gradient = {
                points,
                stops: [] as [number, string][],
                addColorStop(offset: number, color: string) {
                    this.stops.push([offset, color])
                },
            }
            gradients.push(gradient)
            return gradient
        },
    }
    const context = {
        ctx,
        state: { bpms: [{ x: 0, y: 0, s: 0.5 }] },
        scale: 40,
        ups: -2,
    } as unknown as EditorDrawContext
    return { context, ctx, fills, strokes, gradients, renderer: createConnectorRenderer() }
}

test('Canvas eased connectors preserve partial-segment quadratic geometry', () => {
    const { context, fills, strokes, renderer } = fixture()
    const first = note(0, 0, 2, { connectorEase: 'inQuad' })
    const last = note(4, 4, 4)
    const entity = toConnectorEntity(note(1, 0, 0), note(3, 0, 0), first, last, first, last)

    renderer.draw(context, entity, false)
    assert.deepEqual(fills[0]!.path.commands, [
        ['M', 0.25, -1],
        ['Q', 0.75, -2, 2.25, -3],
        ['L', 5.375, -3],
        ['Q', 3.125, -2, 2.375, -1],
        ['Z'],
    ])
    assert.equal(fills[0]!.style, '#7fffd3')
    assert.equal(fills[0]!.alpha, 0.8)
    assert.deepEqual(strokes[0]!.path.commands, [
        ['M', 0.25, -1],
        ['Q', 0.75, -2, 2.25, -3],
        ['M', 2.375, -1],
        ['Q', 3.125, -2, 5.375, -3],
    ])
})

test('compound easing joins at the attachment midpoint and clips each half', () => {
    for (const connectorEase of ['inOutQuad', 'outInQuad'] as const) {
        const { context, fills, strokes, renderer } = fixture()
        const first = note(0, 0, 2, { connectorEase })
        const last = note(8, 8, 4)
        for (const [start, end] of [
            [0, 8],
            [1, 7],
            [0, 3],
            [5, 8],
        ] as const) {
            const entity = toConnectorEntity(
                note(start, 0, 0),
                note(end, 0, 0),
                first,
                last,
                first,
                last,
            )
            renderer.draw(context, entity, false)
            const commands = fills.at(-1)!.path.commands
            const halves = commands.filter(([command]) => command === 'M').length
            assert.equal(halves, start < 4 && end > 4 ? 2 : 1)
            const edges = strokes.at(-1)!.path.commands
            assert.equal(edges.filter(([command]) => command === 'M').length, halves * 2)
            assert.ok(edges.every(([command]) => command === 'M' || command === 'Q'))
            // At the shared midpoint both halves use the same three-lane-wide
            // cross-section; there can be no split or incorrect overlap.
            if (halves === 2) {
                assert.deepEqual(commands[2], ['L', 7, -4])
                assert.deepEqual(commands[5], ['M', 4, -4])
            }
            for (const [command, ...coordinates] of commands) {
                if (command === 'Z') continue
                for (let index = 1; index < coordinates.length; index += 2) {
                    assert.ok(coordinates[index]! >= -end && coordinates[index]! <= -start)
                }
            }
        }
    }
})

test('guide fades retain time-based alpha across BPM changes and segment boundaries', () => {
    const { context, gradients, renderer } = fixture()
    context.state.bpms = calculateBpms([
        { x: 0, y: 0, s: 0.5 },
        { x: 4, y: 2, s: 0.25 },
    ])
    const first = note(0, -3, 2, { connectorType: 'guide', connectorGuideAlpha: 0 })
    const last = note(8, 3, 4)
    const entity = toConnectorEntity(note(2, 0, 0), note(6, 0, 0), first, last, first, last)

    renderer.draw(context, entity, false, 0.25)
    assert.deepEqual(gradients[0]!.points, [0, -2, 0, -5])
    assert.deepEqual(gradients[0]!.stops, [
        [0, `rgba(115, 123, 214, ${1 / 6})`],
        [1, `rgba(115, 123, 214, ${5 / 12})`],
    ])
    renderer.draw(context, entity, true)
    assert.equal(gradients.length, 1)
    renderer.draw({ ...context, ups: -4 }, entity, false)
    assert.equal(gradients.length, 2)
    assert.deepEqual(gradients[1]!.points, [0, -4, 0, -10])
})

test('flat guides avoid gradients and fully transparent or empty connectors skip drawing', () => {
    const { context, fills, strokes, gradients, renderer } = fixture()
    for (const alpha of [0.125, 0.25, 0.5, 0.6, 1]) {
        const first = note(0, 0, 2, { connectorType: 'guide', connectorGuideAlpha: alpha })
        const last = note(4, 4, 4, { connectorGuideAlpha: alpha })
        renderer.draw(
            context,
            toConnectorEntity(first, last, first, last, first, last),
            false,
            0.25,
        )
        assert.equal(fills.at(-1)!.alpha, alpha * 0.5 * 0.25)
        assert.equal(fills.at(-1)!.style, '#737bd6')
    }
    assert.equal(gradients.length, 0)

    const transparent = note(0, 0, 2, {
        connectorType: 'guide',
        connectorGuideAlpha: 0,
        connectorIsFake: true,
    })
    const transparentLast = note(4, 4, 4, { connectorGuideAlpha: 0 })
    renderer.draw(
        context,
        toConnectorEntity(
            transparent,
            transparentLast,
            transparent,
            transparentLast,
            transparent,
            transparentLast,
        ),
        false,
    )
    const empty = note(0, 0, 2)
    renderer.draw(context, toConnectorEntity(empty, empty, empty, empty, empty, empty), false)
    assert.equal(fills.length, 5)
    assert.equal(strokes.length, 0)
})

test('guide fades preserve tiny alpha differences and visible endpoints', () => {
    for (const [headAlpha, tailAlpha] of [
        [0, 0.001],
        [0.001, 0],
        [0.25, 0.250000000001],
    ] as const) {
        const { context, fills, gradients, renderer } = fixture()
        const first = note(0, 0, 2, { connectorType: 'guide', connectorGuideAlpha: headAlpha })
        const last = note(4, 4, 4, { connectorGuideAlpha: tailAlpha })
        renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
        assert.equal(fills.length, 1)
        assert.equal(gradients.length, 1)
        assert.deepEqual(gradients[0]!.stops, [
            [0, `rgba(115, 123, 214, ${headAlpha * 0.5})`],
            [1, `rgba(115, 123, 214, ${tailAlpha * 0.5})`],
        ])
    }
})

test('guide alpha does not suppress active or damage connectors', () => {
    for (const connectorType of ['active', 'damage'] as const) {
        const { context, fills, renderer } = fixture()
        const first = note(0, 0, 2, { connectorType, connectorGuideAlpha: 0 })
        const last = note(4, 4, 4, { connectorGuideAlpha: 0 })
        renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
        assert.equal(fills.length, 1)
        assert.equal(fills[0]!.alpha, 0.8)
    }
})

test('connector path cache survives panning, but updates for zoom and BPM edits', () => {
    const { context, fills, renderer } = fixture()
    const first = note(0, 0, 2)
    const last = note(4, 4, 4)
    const entity = toConnectorEntity(first, last, first, last, first, last)

    renderer.draw(context, entity, false)
    renderer.draw({ ...context, bounds: { l: 1, r: 20, t: -40, b: 5, w: 19, h: 45 } }, entity, true)
    assert.equal(fills[1]!.path, fills[0]!.path)

    renderer.draw({ ...context, ups: -4 }, entity, false)
    assert.notEqual(fills[2]!.path, fills[0]!.path)
    assert.deepEqual(fills[2]!.path.commands[1], ['L', 4, -8])

    context.state.bpms = calculateBpms([{ x: 0, y: 0, s: 1 }])
    renderer.draw(context, entity, false)
    assert.notEqual(fills[3]!.path, fills[2]!.path)
    assert.deepEqual(fills[3]!.path.commands[1], ['L', 4, -8])

    renderer.clear()
    renderer.draw(context, entity, false)
    assert.notEqual(fills[4]!.path, fills[3]!.path)
})

/** Each line of a cross as its start and end points, rounded. */
const crossEnds = (path: RecordedPath) => {
    const round = (value: number) => Math.round(value * 1e6) / 1e6 + 0
    const lines: number[][] = []
    for (const [command, x = 0, y = 0] of path.commands) {
        if (command === 'M') lines.push([round(x), round(y)])
        else lines.at(-1)!.splice(2, 2, round(x), round(y))
    }
    return lines
}

test('fake connector crosses use non-scaling strokes and restore caller drawing state', () => {
    const { context, ctx, strokes, renderer } = fixture()
    const first = note(0, 0, 2, { connectorEase: 'inStep', connectorIsFake: true })
    const last = note(4, 4, 4)
    renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false, 0.25)
    const { path, ...style } = strokes.at(-1)!
    assert.deepEqual(style, { alpha: 0.2, width: 0.05, style: '#f44' })
    // Over the held body, from corner to corner.
    assert.deepEqual(crossEnds(path), [
        [0, 0, 2, -4],
        [2, 0, 0, -4],
    ])
    assert.equal(ctx.globalAlpha, 1)
    assert.equal(ctx.lineWidth, 1)
    assert.equal(ctx.strokeStyle, '#000')
    assert.equal(ctx.lineCap, 'round')
})

test('one connector color applies to active, damage and guide connectors', () => {
    for (const connectorType of ['active', 'damage', 'guide'] as const) {
        const { context, fills, strokes, renderer } = fixture()
        const first = note(0, 0, 2, { connectorType, connectorStyle: 'red' })
        const last = note(4, 0, 2)
        renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
        assert.equal(fills.length, 1)
        assert.equal(fills[0]!.style, connectorType === 'damage' ? '#a75a60' : '#d6737b')
        if (connectorType === 'guide') {
            assert.equal(strokes.length, 0)
        } else {
            assert.equal(strokes[0]!.style, connectorType === 'damage' ? '#4b282b' : '#e0969c')
            assert.equal(strokes[0]!.width, 3 / context.scale)
        }
    }
})

test('a guide with the editor default color draws green', () => {
    const { context, fills, renderer } = fixture()
    const first = note(0, 0, 2, { connectorType: 'guide', connectorStyle: 'default' })
    const last = note(4, 0, 2)
    renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
    assert.equal(fills[0]?.style, '#73d69d')
})

test('step connectors hold their interior lane and in-out steps split at the attachment midpoint', () => {
    const rects = (connectorEase: NoteEntity['connectorEase'], start = 0, end = 4) => {
        const { context, fills, renderer } = fixture()
        const first = note(0, 0, 2, { connectorEase })
        const last = note(4, 4, 4)
        const entity = toConnectorEntity(
            note(start, 0, 0),
            note(end, 0, 0),
            first,
            last,
            first,
            last,
        )
        renderer.draw(context, entity, false)
        return fills[0]!.path.commands
    }
    assert.deepEqual(rects('inStep'), [['R', 0, -4, 2, 4]])
    assert.deepEqual(rects('none'), rects('inStep'))
    assert.deepEqual(rects('outStep'), [['R', 4, -4, 4, 4]])
    assert.deepEqual(rects('outInStep'), [['R', 2, -4, 3, 4]])
    assert.deepEqual(rects('inOutStep'), [
        ['R', 0, -2, 2, 2],
        ['R', 4, -4, 4, 2],
    ])
    assert.deepEqual(rects('inOutStep', 0, 1), [['R', 0, -1, 2, 1]])
    assert.deepEqual(rects('inOutStep', 3, 4), [['R', 4, -4, 4, 1]])
})

test('other curves are sampled polylines that keep overshoot and collapse negative sizes', () => {
    const { context, fills, strokes, renderer } = fixture()
    const first = note(0, 0, 2, { connectorEase: 'outElastic' })
    const last = note(4, 4, 0.1)
    renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
    const commands = fills[0]!.path.commands
    assert.deepEqual(commands[0], ['M', 0, -0])
    assert.deepEqual(commands.at(-1), ['Z'])
    assert.ok(commands.slice(1, -1).every(([command]) => command === 'L'))
    assert.ok(commands.length > 40)
    const lefts = commands.slice(0, -1).map(([, x]) => x!)
    assert.ok(Math.max(...lefts) > 4.5)
    // The right edge never crosses the left edge.
    const half = (commands.length - 1) / 2
    for (let index = 0; index < half; index++) {
        const [, leftX, leftY] = commands[index]!
        const [, rightX, rightY] = commands[commands.length - 2 - index]!
        assert.equal(leftY, rightY)
        assert.ok(rightX! >= leftX! - 1e-12)
    }
    assert.equal(strokes[0]!.path.commands.filter(([command]) => command === 'M').length, 2)
})

test('pieces between attached notes ease between their own ends, as the engine draws them', () => {
    const { context, fills, renderer } = fixture()
    const first = note(0, -3.5, 1, { connectorEase: 'inBack' })
    const last = note(4, 2.5, 1)
    // IN_BACK returns to 0 here, so the piece's ends share one eased value.
    const root = 4 * (1.70158 / 2.70158)
    const separator = note(root, -3.5, 1, { isAttached: true, isConnectorSeparator: true })
    renderer.draw(context, toConnectorEntity(first, separator, first, last, first, last), false)
    const xs = fills[0]!.path.commands.flatMap(([command, ...values]) =>
        command === 'Z' ? [] : values.filter((_, index) => index % 2 === 0),
    )
    // Straight, without the dip of the whole curve.
    assert.ok(Math.min(...xs) > -3.5 - 1e-6)
    assert.ok(Math.max(...xs) < -2.5 + 1e-6)

    // Elsewhere the piece follows the whole curve.
    const { context: other, fills: curve, renderer: curveRenderer } = fixture()
    const middle = note(2, 0, 0, { isAttached: true, isConnectorSeparator: true })
    curveRenderer.draw(other, toConnectorEntity(first, middle, first, last, first, last), false)
    const curveXs = curve[0]!.path.commands.flatMap(([command, ...values]) =>
        command === 'Z' ? [] : values.filter((_, index) => index % 2 === 0),
    )
    assert.ok(Math.min(...curveXs) < -3.5 - 0.5)
})

test('fake connector crosses follow the drawn body', () => {
    const cross = (entity: ReturnType<typeof toConnectorEntity>) => {
        const { context, fills, strokes, renderer } = fixture()
        renderer.draw(context, entity, false)
        return { body: fills[0]!.path.commands, cross: strokes.at(-1)!.path }
    }
    const fake = { connectorIsFake: true }

    // A None connector holds its head's lane, and so does its cross.
    const held = note(0, 0, 2, { ...fake, connectorEase: 'none' })
    const last = note(4, 4, 4)
    assert.deepEqual(
        crossEnds(cross(toConnectorEntity(held, last, held, last, held, last)).cross),
        [
            [0, 0, 2, -4],
            [2, 0, 0, -4],
        ],
    )

    // A linear one, widening, keeps straight lines corner to corner.
    const linear = note(0, 0, 2, { ...fake, connectorEase: 'linear' })
    const straight = cross(toConnectorEntity(linear, last, linear, last, linear, last)).cross
    assert.equal(straight.commands.length, 4)
    assert.deepEqual(crossEnds(straight), [
        [0, 0, 8, -4],
        [2, 0, 4, -4],
    ])

    // An overshooting ease crosses at its own middle, not the straight one.
    const back = note(0, 0, 2, { ...fake, connectorEase: 'outBack' })
    const { cross: curved } = cross(toConnectorEntity(back, last, back, last, back, last))
    const q = 1 + 2.70158 * (0.5 - 1) ** 3 + 1.70158 * (0.5 - 1) ** 2
    const middle = curved.commands[16]!
    assert.ok(Math.abs(middle[1]! - (4 * q + (2 + 2 * q) / 2)) < 1e-6)
    assert.ok(Math.abs(middle[2]! + 2) < 1e-6)

    // A piece after an attached note crosses its own corners.
    const first = note(0, 0, 2, { ...fake, connectorEase: 'inQuad' })
    const attached = note(2, 0, 0, { isAttached: true })
    const piece = cross(toConnectorEntity(attached, last, first, last, first, last))
    const n = (piece.body.length - 1) / 2
    const corner = (index: number) =>
        (piece.body[index]!.slice(1) as number[]).map((value) => Math.round(value * 1e6) / 1e6 + 0)
    assert.deepEqual(crossEnds(piece.cross), [
        [...corner(0), ...corner(n)],
        [...corner(2 * n - 1), ...corner(n - 1)],
    ])
})

test('a guide segment under 1e-6 s takes its middle alpha, as the engine does', () => {
    const { context, fills, gradients, renderer } = fixture()
    // At 150 BPM, these beats a float step apart share one time.
    context.state.bpms = calculateBpms([{ x: 0, y: 0, s: 0.4 }])
    const head = note(22 / 3, 0, 2, { connectorType: 'guide', connectorGuideAlpha: 1 })
    const tail = note(7.333333333333334, 0, 2, { connectorGuideAlpha: 0.2 })
    renderer.draw(context, toConnectorEntity(head, tail, head, tail, head, tail), false)
    assert.equal(gradients.length, 0)
    assert.equal(fills.length, 1)
    assert.equal(fills[0]!.alpha, 0.6 * 0.5)
})

test('connectors with ends at one time draw finite geometry for every ease', () => {
    for (const connectorEase of [
        'linear',
        'inQuad',
        'inOutQuad',
        'outElastic',
        'inStep',
    ] as const) {
        const { context, fills, renderer } = fixture()
        context.state.bpms = calculateBpms([{ x: 0, y: 0, s: 0.4 }])
        const head = note(22 / 3, 0, 2, { connectorEase, connectorIsFake: true })
        const tail = note(7.333333333333334, 4, 4)
        renderer.draw(context, toConnectorEntity(head, tail, head, tail, head, tail), false)
        const values = fills.flatMap(({ path }) => path.commands.flatMap(([, ...xs]) => xs))
        assert.ok(values.every(Number.isFinite), connectorEase)
    }
})
