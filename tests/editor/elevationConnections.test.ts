import assert from 'node:assert/strict'
import test from 'node:test'
import {
    drawElevationConnections,
    getElevationConnections,
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
    } as unknown as CanvasRenderingContext2D
    return {
        ctx,
        moves,
        lines,
        dashes,
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

test('all interpolating eases produce the same ribbon at a single beat', () => {
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

test('same-elevation, none-ease and zero-width connectors do not invent visible geometry', () => {
    for (const kind of ['level', 'none', 'zero'] as const) {
        const head = note({ connectorEase: kind === 'none' ? 'inStep' : 'linear' }),
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
