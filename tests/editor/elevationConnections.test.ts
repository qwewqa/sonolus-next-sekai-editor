import assert from 'node:assert/strict'
import test from 'node:test'
import {
    drawElevationConnections,
    getElevationConnections,
} from '../../src/editor/elevation/connections'
import type { ElevationRow } from '../../src/editor/elevation/layout'
import { connectorColors } from '../../src/editor/utils/connectorColors'
import { toConnectorEntity } from '../../src/state/entities/slides/connector'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const note = (properties: Partial<NoteEntity> = {}) =>
    ({
        beat: 4,
        connectorType: 'active',
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
    trueY: y,
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
    assert.ok(guide && Math.abs(guide.alpha - 0.45) < 1e-12)
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

test('arrows clip to actual note bodies at high lane scale and still point at the tail', () => {
    const head = note(),
        tail = note()
    const connections = getElevationConnections(
        [row(head, 100, 250), row(tail, 100, 100)],
        [[connect(head, tail)]],
    )
    const recorded = canvas()
    drawElevationConnections(recorded.ctx, connections, 100)
    assert.deepEqual(recorded.moves[0], [100, 217])
    assert.deepEqual(recorded.lines[0], [100, 133])
    assert.deepEqual(recorded.moves.at(-1), [100, 133])
    assert.ok(recorded.lines.at(-1)![1] > 133)
    assert.equal(recorded.fills, 1)
})

test('overlapping endpoints route outside the note bodies and fake links remain dashed', () => {
    const head = note({ connectorIsFake: true }),
        tail = note()
    const connections = getElevationConnections(
        [row(head), row(tail, 110, 200)],
        [[connect(head, tail)]],
    )
    const recorded = canvas()
    drawElevationConnections(recorded.ctx, connections, 30)
    assert.deepEqual(recorded.moves[0], [100, 188])
    assert.deepEqual(recorded.lines[0], [100, 173])
    assert.deepEqual(recorded.lines[1], [110, 173])
    assert.ok(recorded.dashes.some((dash) => dash.join(',') === '5,4'))
    assert.equal(recorded.fills, 1)
})
