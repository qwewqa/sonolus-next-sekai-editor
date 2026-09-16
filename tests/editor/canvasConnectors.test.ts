import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectorRenderer } from '../../src/editor/canvas/connectors'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { toConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'

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
        connectorActiveIsCritical: false,
        connectorIsFake: false,
        connectorGuideColor: 'blue',
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
    }[] = []
    const ctx = {
        globalAlpha: 1,
        fillStyle: '#000' as Style,
        strokeStyle: '#000',
        lineWidth: 1,
        save() {
            stack.push({
                globalAlpha: this.globalAlpha,
                fillStyle: this.fillStyle,
                strokeStyle: this.strokeStyle,
                lineWidth: this.lineWidth,
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
    const { context, fills, renderer } = fixture()
    const first = note(0, 0, 2, { connectorEase: 'in' })
    const last = note(4, 4, 4)
    const entity = toConnectorEntity(note(1, 0, 0), note(3, 0, 0), first, last, first, last)

    renderer.draw(context, entity, false)
    assert.deepEqual(fills[0].path.commands, [
        ['M', 0.25, -1],
        ['Q', 0.75, -2, 2.25, -3],
        ['L', 5.375, -3],
        ['Q', 3.125, -2, 2.375, -1],
        ['Z'],
    ])
    assert.equal(fills[0].style, '#7fffd3')
    assert.equal(fills[0].alpha, 0.8)
})

test('compound easing joins at the attachment midpoint and clips each half', () => {
    for (const connectorEase of ['inOut', 'outIn'] as const) {
        const { context, fills, renderer } = fixture()
        const first = note(0, 0, 2, { connectorEase })
        const last = note(8, 8, 4)
        for (const [start, end] of [
            [0, 8],
            [1, 7],
            [0, 3],
            [5, 8],
        ]) {
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
            // At the shared midpoint both halves use the same three-lane-wide
            // cross-section; there can be no split or incorrect overlap.
            if (halves === 2) {
                assert.deepEqual(commands[2], ['L', 7, -4])
                assert.deepEqual(commands[5], ['M', 4, -4])
            }
            for (const [command, ...coordinates] of commands) {
                if (command === 'Z') continue
                for (let index = 1; index < coordinates.length; index += 2) {
                    assert.ok(coordinates[index] >= -end && coordinates[index] <= -start)
                }
            }
        }
    }
})

test('guide fades retain time-based alpha across BPM changes and segment boundaries', () => {
    const { context, gradients, renderer } = fixture()
    context.state.bpms = [
        { x: 0, y: 0, s: 0.5 },
        { x: 4, y: 2, s: 0.25 },
    ]
    const first = note(0, -3, 2, { connectorType: 'guide', connectorGuideAlpha: 0 })
    const last = note(8, 3, 4)
    const entity = toConnectorEntity(note(2, 0, 0), note(6, 0, 0), first, last, first, last)

    renderer.draw(context, entity, false, 0.25)
    assert.deepEqual(gradients[0].points, [0, -2, 0, -5])
    assert.deepEqual(gradients[0].stops, [
        [0, `rgba(115, 123, 214, ${1 / 6})`],
        [1, `rgba(115, 123, 214, ${5 / 12})`],
    ])
    renderer.draw(context, entity, true)
    assert.equal(gradients.length, 1)
    renderer.draw({ ...context, ups: -4 }, entity, false)
    assert.equal(gradients.length, 2)
    assert.deepEqual(gradients[1].points, [0, -4, 0, -10])
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
    ]) {
        const { context, fills, gradients, renderer } = fixture()
        const first = note(0, 0, 2, { connectorType: 'guide', connectorGuideAlpha: headAlpha })
        const last = note(4, 4, 4, { connectorGuideAlpha: tailAlpha })
        renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false)
        assert.equal(fills.length, 1)
        assert.equal(gradients.length, 1)
        assert.deepEqual(gradients[0].stops, [
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
        assert.equal(fills[0].alpha, 0.8)
    }
})

test('connector path cache survives panning, but updates for zoom and BPM edits', () => {
    const { context, fills, renderer } = fixture()
    const first = note(0, 0, 2)
    const last = note(4, 4, 4)
    const entity = toConnectorEntity(first, last, first, last, first, last)

    renderer.draw(context, entity, false)
    renderer.draw({ ...context, bounds: { l: 1, r: 20, t: -40, b: 5, w: 19, h: 45 } }, entity, true)
    assert.equal(fills[1].path, fills[0].path)

    renderer.draw({ ...context, ups: -4 }, entity, false)
    assert.notEqual(fills[2].path, fills[0].path)
    assert.deepEqual(fills[2].path.commands[1], ['L', 4, -8])

    context.state.bpms = [{ x: 0, y: 0, s: 1 }]
    renderer.draw(context, entity, false)
    assert.notEqual(fills[3].path, fills[2].path)
    assert.deepEqual(fills[3].path.commands[1], ['L', 4, -8])

    renderer.clear()
    renderer.draw(context, entity, false)
    assert.notEqual(fills[4].path, fills[3].path)
})

test('fake connector crosses use non-scaling strokes and restore caller drawing state', () => {
    const { context, ctx, strokes, renderer } = fixture()
    const first = note(0, 0, 2, { connectorEase: 'none', connectorIsFake: true })
    const last = note(4, 4, 4)
    renderer.draw(context, toConnectorEntity(first, last, first, last, first, last), false, 0.25)
    assert.deepEqual(strokes[0], {
        path: Object.assign(new RecordedPath(), {
            commands: [
                ['M', 0, -0],
                ['L', 8, -4],
                ['M', 4, -4],
                ['L', 2, -0],
            ],
        }),
        alpha: 0.2,
        width: 0.05,
        style: '#f44',
    })
    assert.equal(ctx.globalAlpha, 1)
    assert.equal(ctx.lineWidth, 1)
    assert.equal(ctx.strokeStyle, '#000')
})
