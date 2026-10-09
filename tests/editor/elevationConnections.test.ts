import assert from 'node:assert/strict'
import test from 'node:test'
import { ease, eases } from '../../src/ease'
import {
    drawElevationConnections,
    getElevationConnections,
    getElevationCurve,
    getElevationRibbon,
} from '../../src/editor/elevation/connections'
import type { ElevationRow } from '../../src/editor/elevation/layout'
import { connectorColors } from '../../src/editor/utils/connectorColors'
import { toConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { calculateBpms } from '../../src/state/integrals/bpms'

const note = (properties: Partial<NoteEntity> = {}) =>
    ({
        beat: 4,
        elevation: 0,
        connectorType: 'active',
        connectorEase: 'linear',
        connectorLayer: 'top',
        connectorStyle: 'default',
        connectorIsFake: false,
        connectorGuideAlpha: 1,
        connectorActiveIsCritical: false,
        ...properties,
    }) as NoteEntity
const row = (note: NoteEntity, x = 100, y = 200, order = 0): ElevationRow => ({
    note,
    x,
    y,
    w: 40,
    lane: 0,
    size: 1,
    elevation: 0,
    attached: note.isAttached,
    order,
})
const connect = (head: NoteEntity, tail: NoteEntity, segmentHead = head, segmentTail = tail) =>
    toConnectorEntity(head, tail, head, tail, segmentHead, segmentTail)

test('elevation connections use real endpoints without bridging filtered notes', () => {
    const a = note(),
        b = note(),
        c = note()
    const connectors = [connect(a, b), connect(b, c)]
    assert.equal(getElevationConnections([row(a), row(c)], [connectors]).length, 0)
    assert.equal(getElevationConnections([row(a), row(b), row(c)], [connectors]).length, 2)
    assert.equal(getElevationConnections([row(a), row(b)], [connectors], false).length, 0)
})

test('same-beat elevation connections preserve head-to-tail order independently of row height', () => {
    const head = note(),
        tail = note()
    const a = row(head, 100, 100, 0),
        b = row(tail, 200, 250, 1)
    const connection = connect(head, tail)
    const result = getElevationConnections([b, a], [[connection]])
    assert.equal(result.length, 1)
    assert.equal(result[0]?.head, a)
    assert.equal(result[0]?.tail, b)
    assert.equal(result[0]?.connector, connection)
})

test('attached notes do not invent connector boundaries and separator slices remain distinct', () => {
    const head = note(),
        attached = note({ isAttached: true }),
        tail = note()
    const rows = [row(head), row(attached), row(tail)]
    const direct = getElevationConnections(rows, [[connect(head, tail)]])
    assert.equal(direct.length, 1)
    assert.equal(direct[0]?.tail.note, tail)
    const sliced = getElevationConnections(rows, [
        [connect(head, attached), connect(attached, tail)],
    ])
    assert.equal(sliced.length, 2)
    assert.equal(sliced[1]?.head.note, attached)
})

test('styles belong to segment owners and transparent guides are omitted', () => {
    const head = note(),
        tail = note({ connectorGuideAlpha: 0 })
    const owner = note({ connectorType: 'guide', connectorStyle: 'red', connectorGuideAlpha: 0 })
    assert.equal(
        getElevationConnections([row(head), row(tail)], [[connect(head, tail, owner, tail)]])
            .length,
        0,
    )
    owner.connectorGuideAlpha = 0.75
    const guide = getElevationConnections(
        [row(head), row(tail)],
        [[connect(head, tail, owner, tail)]],
    )[0]
    assert.equal(guide?.color, connectorColors(owner).body)
    assert.equal(guide?.edge, undefined)
    assert.ok(guide && Math.abs(guide.alpha - 0.1875) < 1e-12)
    const damageOwner = note({ connectorType: 'damage', connectorIsFake: true })
    const damage = getElevationConnections(
        [row(head), row(tail)],
        [[connect(head, tail, damageOwner)]],
    )[0]
    assert.equal(damage?.color, connectorColors(damageOwner).body)
    assert.equal(damage?.edge, connectorColors(damageOwner).edge)
    assert.equal(damage?.fake, true)
})

const canvas = () => {
    const moves: [number, number][] = []
    const lines: [number, number][] = []
    const dashes: number[][] = []
    const gradients: { points: number[]; stops: [number, string][] }[] = []
    let fills = 0
    const ctx = {
        save() {},
        restore() {},
        beginPath() {},
        stroke() {},
        closePath() {},
        clip() {},
        moveTo(x: number, y: number) {
            moves.push([x, y])
        },
        lineTo(x: number, y: number) {
            lines.push([x, y])
        },
        setLineDash(value: number[]) {
            dashes.push(value)
        },
        fill() {
            fills++
        },
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
    } as unknown as CanvasRenderingContext2D
    return {
        ctx,
        moves,
        lines,
        dashes,
        gradients,
        get fills() {
            return fills
        },
    }
}

test('ribbons join full endpoint widths and taper without clipping to note bodies', () => {
    const head = note(),
        tail = note()
    const a = row(head, 100, 250),
        b = { ...row(tail, 160, 100), w: 80 }
    const [connection] = getElevationConnections([a, b], [[connect(head, tail)]])
    assert.ok(connection)
    assert.deepEqual(getElevationRibbon(connection), {
        headLeft: [80, 250],
        headRight: [120, 250],
        tailLeft: [120, 100],
        tailRight: [200, 100],
    })
    const recorded = canvas()
    drawElevationConnections(recorded.ctx, [connection])
    assert.deepEqual(recorded.moves[0], [80, 250])
    assert.deepEqual(recorded.lines.slice(0, 3), [
        [120, 100],
        [200, 100],
        [120, 250],
    ])
    assert.equal(recorded.fills, 1)
})

test('same-beat guide ribbons fade linearly over height through every easing and step band', () => {
    for (const connectorEase of ['linear', 'inQuad', 'inOutStep'] as const) {
        for (const reverse of [false, true]) {
            const head = note({
                elevation: reverse ? 4 : 0,
                connectorType: 'guide',
                connectorGuideAlpha: 0,
                connectorEase,
            })
            const tail = note({ elevation: reverse ? 0 : 4, connectorGuideAlpha: 1 })
            const [connection] = getElevationConnections(
                [row(head, 100, reverse ? 100 : 300), row(tail, 200, reverse ? 300 : 100)],
                [[connect(head, tail)]],
            )
            assert.ok(connection, 'a transparent start must not suppress the visible tail')
            assert.equal(connection.alpha, 0)
            assert.equal(connection.tailAlpha, 0.5)
            const { ctx, gradients } = canvas()
            drawElevationConnections(ctx, [connection])
            assert.equal(gradients.length, 1, 'step bands share one full-height fade')
            assert.deepEqual(gradients[0]!.points, [0, connection.head.y, 0, connection.tail.y])
            assert.equal(gradients[0]!.stops[0]![1].endsWith(', 0)'), true)
            assert.equal(gradients[0]!.stops[1]![1].endsWith(', 0.5)'), true)
        }
    }
})

test('same-beat guide alpha ignores displayed stage heights and retains separator endpoint values', () => {
    const owner = note({ elevation: 1, connectorType: 'guide', connectorGuideAlpha: 0.2 })
    const marker = note({ elevation: 2 })
    const tail = note({ elevation: 5, connectorGuideAlpha: 1 })
    const build = (firstY: number, lastY: number) =>
        getElevationConnections(
            [row(marker, 100, firstY), row(tail, 200, lastY)],
            [[connect(marker, tail, owner, tail)]],
        )[0]!
    const a = build(200, 100),
        b = build(100, 500)
    assert.equal(a.alpha, 0.2)
    assert.equal(a.tailAlpha, 0.5)
    assert.equal(b.alpha, a.alpha)
    assert.equal(b.tailAlpha, a.tailAlpha)
})

test('all interpolating eases retain the same ribbon endpoint bounds', () => {
    for (const connectorEase of [
        'linear',
        'inQuad',
        'outQuad',
        'inOutQuad',
        'outInQuad',
    ] as const) {
        const head = note({ connectorEase }),
            tail = note()
        const [connection] = getElevationConnections(
            [row(head), row(tail, 150, 100)],
            [[connect(head, tail)]],
        )
        assert.ok(connection)
        assert.deepEqual(getElevationRibbon(connection), {
            headLeft: [80, 200],
            headRight: [120, 200],
            tailLeft: [130, 100],
            tailRight: [170, 100],
        })
    }
})

test('same-elevation and zero-width connectors do not invent visible geometry', () => {
    for (const kind of ['level', 'zero'] as const) {
        const head = note({ connectorEase: 'linear' }),
            tail = note()
        const a = row(head),
            b = row(tail, 150, kind === 'level' ? 200 : 100)
        if (kind === 'zero') a.w = b.w = 0
        const [connection] = getElevationConnections([a, b], [[connect(head, tail)]])
        assert.ok(connection)
        assert.equal(getElevationRibbon(connection), undefined)
        const recorded = canvas()
        drawElevationConnections(recorded.ctx, [connection])
        assert.equal(recorded.fills, 0)
        assert.equal(recorded.moves.length, 0)
    }
})

test('a zero-width endpoint tapers to a point without losing the other endpoint', () => {
    const head = note(),
        tail = note()
    const a = { ...row(head), w: 0 },
        b = row(tail, 150, 100)
    const [connection] = getElevationConnections([a, b], [[connect(head, tail)]])
    assert.ok(connection)
    assert.deepEqual(getElevationRibbon(connection), {
        headLeft: [100, 200],
        headRight: [100, 200],
        tailLeft: [130, 100],
        tailRight: [170, 100],
    })
})

test('fake ribbons retain filled bodies and use the same cross marker as the main editor', () => {
    const head = note({ connectorIsFake: true }),
        tail = note()
    const connections = getElevationConnections(
        [row(head), row(tail, 110, 100)],
        [[connect(head, tail)]],
    )
    const recorded = canvas()
    drawElevationConnections(recorded.ctx, connections)
    assert.equal(recorded.fills, 1)
    assert.ok(recorded.dashes.every((dash) => dash.length === 0))
    assert.deepEqual(recorded.moves.slice(-2), [
        [80, 200],
        [90, 100],
    ])
    assert.deepEqual(recorded.lines.slice(-2), [
        [130, 100],
        [120, 200],
    ])
})

test('connector layers and families are painted in preview order', () => {
    const head = note(),
        tail = note()
    const owners = [
        note({ connectorLayer: 'over', connectorType: 'guide' }),
        note({ connectorLayer: 'top', connectorType: 'damage' }),
        note({ connectorLayer: 'under', connectorType: 'guide' }),
        note({ connectorLayer: 'top', connectorType: 'active' }),
        note({ connectorLayer: 'bottom', connectorType: 'active' }),
    ]
    const result = getElevationConnections(
        [row(head), row(tail)],
        [owners.map((owner) => connect(head, tail, owner))],
    )
    assert.deepEqual(
        result.map((item) => [
            item.connector.segmentHead.connectorLayer,
            item.connector.segmentHead.connectorType,
        ]),
        [
            ['under', 'guide'],
            ['bottom', 'active'],
            ['top', 'active'],
            ['top', 'damage'],
            ['over', 'guide'],
        ],
    )
})

test('guide opacity interpolates in time across BPM changes', () => {
    const head = note(),
        tail = note()
    const segmentHead = note({ beat: 0, connectorType: 'guide', connectorGuideAlpha: 0 })
    const segmentTail = note({ beat: 8, connectorGuideAlpha: 1 })
    const bpms = calculateBpms([
        { x: 0, y: 0, s: 0.5 },
        { x: 4, y: 2, s: 1 },
    ])
    const [connection] = getElevationConnections(
        [row(head), row(tail)],
        [[connect(head, tail, segmentHead, segmentTail)]],
        true,
        bpms,
    )
    assert.ok(connection)
    assert.ok(Math.abs(connection.alpha - 1 / 6) < 1e-12)
})

test('same-beat curves ease horizontal position and width over signed elevation', () => {
    for (const direction of [-1, 1]) {
        const head = note({ connectorEase: 'inQuad' }),
            tail = note()
        const [connection] = getElevationConnections(
            [row(head, 0, 100), { ...row(tail, 400, 100 + direction * 400), w: 80 }],
            [[connect(head, tail)]],
        )
        assert.ok(connection)
        const points = getElevationCurve(connection)?.[0]
        assert.ok(points)
        assert.deepEqual(points[0], { x: 0, y: 100, w: 40, u: 0 })
        assert.deepEqual(points.at(-1), { x: 400, y: 100 + direction * 400, w: 80, u: 1 })
        assert.deepEqual(
            points.find(({ u }) => u === 0.5),
            { x: 100, y: 100 + direction * 200, w: 50, u: 0.5 },
        )
    }
})

test('all same-beat easing families stay finite and follow their elevation parameter', () => {
    for (const connectorEase of eases) {
        if (connectorEase === 'linear') continue
        const head = note({ connectorEase }),
            tail = note()
        const [connection] = getElevationConnections(
            [
                { ...row(head, 0, 400), w: 80 },
                { ...row(tail, 400, 0), w: 0 },
            ],
            [[connect(head, tail)]],
        )
        assert.ok(connection)
        const sections = getElevationCurve(connection)
        assert.ok(sections, connectorEase)
        for (const points of sections) {
            for (const point of points) {
                assert.ok(Object.values(point).every(Number.isFinite), connectorEase)
                assert.ok(point.w >= 0, connectorEase)
                if (
                    sections.length === 1 &&
                    !connectorEase.toLowerCase().includes('step') &&
                    connectorEase !== 'none'
                ) {
                    assert.ok(
                        Math.abs(point.x - 400 * ease(connectorEase, point.u)) < 1e-9,
                        connectorEase,
                    )
                    assert.equal(point.y, 400 * (1 - point.u), connectorEase)
                }
            }
        }
    }
})

test('same-beat step eases draw held bands and split in-out steps over elevation', () => {
    for (const [connectorEase, fractions] of [
        ['none', [0]],
        ['inStep', [0]],
        ['outStep', [1]],
        ['outInStep', [0.5]],
        ['inOutStep', [0, 1]],
    ] as const) {
        const head = note({ connectorEase }),
            tail = note()
        const [connection] = getElevationConnections(
            [row(head, 0, 400), row(tail, 400, 0)],
            [[connect(head, tail)]],
        )
        assert.ok(connection)
        const sections = getElevationCurve(connection)!
        assert.equal(sections.length, fractions.length)
        for (const [index, points] of sections.entries()) {
            assert.ok(points.every(({ x }) => x === 400 * fractions[index]!))
        }
        if (connectorEase === 'inOutStep') {
            assert.equal(sections[0]!.at(-1)!.y, 200)
            assert.equal(sections[1]![0]!.y, 200)
        }
        const recorded = canvas()
        drawElevationConnections(recorded.ctx, [connection])
        assert.equal(recorded.fills, 1)
    }
})

test('distinct authored beats retain old straight geometry even within pane beat tolerance', () => {
    for (const difference of [1e-8, 1]) {
        for (const connectorEase of ['inQuad', 'inStep'] as const) {
            const head = note({ connectorEase }),
                tail = note({ beat: 4 + difference })
            const [connection] = getElevationConnections(
                [row(head), row(tail, 400, 0)],
                [[connect(head, tail)]],
            )
            assert.ok(connection)
            assert.equal(getElevationCurve(connection), undefined)
            const recorded = canvas()
            drawElevationConnections(recorded.ctx, [connection])
            assert.equal(recorded.fills, connectorEase === 'inStep' ? 0 : 1)
            if (connectorEase === 'inQuad')
                assert.deepEqual(recorded.lines.slice(0, 3), [
                    [380, 0],
                    [420, 0],
                    [120, 200],
                ])
        }
    }
})

test('same-beat attached separators preserve the original elevation easing interval', () => {
    for (const direction of [-1, 1]) {
        const head = note({ connectorEase: 'inQuad', elevation: direction > 0 ? 0 : 4 })
        const attached = note({
            isAttached: true,
            isConnectorSeparator: true,
            elevation: direction > 0 ? 1 : 3,
        })
        const tail = note({ elevation: direction > 0 ? 4 : 0 })
        const connections = getElevationConnections(
            [
                row(head, 0, 0),
                { ...row(attached, 25, direction * 100), w: 42.5 },
                { ...row(tail, 400, direction * 400), w: 80 },
            ],
            [
                [
                    toConnectorEntity(head, attached, head, tail, head, tail),
                    toConnectorEntity(attached, tail, head, tail, attached, tail),
                ],
            ],
        )
        assert.equal(connections.length, 2)
        const first = getElevationCurve(connections[0]!)![0]!
        const second = getElevationCurve(connections[1]!)![0]!
        assert.deepEqual(first.at(-1), { x: 25, y: direction * 100, w: 42.5, u: 1 })
        assert.deepEqual(second[0], { x: 25, y: direction * 100, w: 42.5, u: 0 })
        assert.deepEqual(
            first.find(({ u }) => u === 0.5),
            { x: 6.25, y: direction * 50, w: 40.625, u: 0.5 },
        )
        assert.deepEqual(
            second.find(({ u }) => u === 0.5),
            { x: 156.25, y: direction * 250, w: 55.625, u: 0.5 },
        )
    }
})

test('same-beat pieces inside distinct-beat attachments ease over their own elevation span', () => {
    const head = note({ beat: 4, connectorEase: 'outStep', elevation: 0 })
    const attached = note({ beat: 4, isAttached: true, isConnectorSeparator: true })
    const tail = note({ beat: 8, elevation: 4 })
    const [connection] = getElevationConnections(
        [row(head, 0, 400), row(attached, 400, 0)],
        [[toConnectorEntity(head, attached, head, tail, head, tail)]],
    )
    assert.ok(connection)
    assert.equal(connection.headFraction, 0)
    assert.equal(connection.tailFraction, 1)
    assert.deepEqual(getElevationCurve(connection), [
        [
            { x: 400, y: 400, w: 40, u: 0 },
            { x: 400, y: 0, w: 40, u: 1 },
        ],
    ])
})
