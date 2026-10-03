import assert from 'node:assert/strict'
import test from 'node:test'
import { getNotesAtBeat } from '../../src/editor/elevation/candidates'
import {
    layoutElevationNotes,
    sameBeat,
    type ElevationAxes,
    type ElevationNote,
    type ElevationRow,
} from '../../src/editor/elevation/layout'
import type { SlideId } from '../../src/state/entities/slides'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const axes: ElevationAxes = {
    width: 600,
    height: 600,
    laneLeft: -10,
    laneScale: 30,
    elevationCenter: 2.5,
    elevationScale: 100,
}
const source = (beat: number): NoteEntity => ({ beat }) as NoteEntity
const note = (slide: number, order: number, lane = 0, elevation = 0, size = 1): ElevationNote => ({
    note: { slideId: slide as SlideId } as NoteEntity,
    lane,
    size,
    elevation,
    order,
    attached: false,
})

const legacyRows = (notes: ElevationNote[], axes: ElevationAxes) => {
    const rows: ElevationRow[] = []
    const spacing = Math.max(30, axes.laneScale * 0.6 + 16)
    for (const item of [...notes].sort((a, b) => a.elevation - b.elevation || a.order - b.order)) {
        const x = (item.lane - axes.laneLeft) * axes.laneScale
        const w = item.size * axes.laneScale
        const trueY =
            axes.height / 2 - (item.elevation - axes.elevationCenter) * axes.elevationScale
        const preceding = rows.filter(
            (row) =>
                row.note.slideId === item.note.slideId && sameBeat(row.elevation, item.elevation),
        )
        let y = preceding.length
            ? Math.min(trueY, ...preceding.map((row) => row.y)) - spacing
            : trueY
        for (;;) {
            const collision = rows.find(
                (row) =>
                    Math.abs(row.x - x) <
                        (Math.max(row.w, axes.laneScale * 1.5) +
                            Math.max(w, axes.laneScale * 1.5)) /
                            2 +
                            8 &&
                    row.y - spacing < y &&
                    y < row.y + spacing,
            )
            if (!collision) break
            y = collision.y - spacing
        }
        rows.push({ ...item, x, y, w, trueY })
    }
    return rows
}

test('beat grid candidates include both sides of fractional bucket boundaries only within tolerance', () => {
    const before = source(4 - 1e-9)
    const exact = source(4)
    const after = source(4 + 1e-9)
    const distant = source(4.0001)
    const grid = new Map([
        [3, new Set([before])],
        [4, new Set([exact, after, distant])],
    ])
    assert.deepEqual(new Set(getNotesAtBeat(grid, 4)), new Set([before, exact, after]))
    assert.deepEqual(new Set(getNotesAtBeat(grid, before.beat)), new Set([before, exact, after]))
    const fractional = source(1 / 3)
    grid.set(0, new Set([fractional]))
    assert.deepEqual(getNotesAtBeat(grid, 1 / 3 + 1e-12), [fractional])
    assert.deepEqual(getNotesAtBeat(grid, Number.NaN), [])
    assert.deepEqual(getNotesAtBeat(grid, Infinity), [])
    assert.deepEqual(getNotesAtBeat(grid, -Infinity), [])
    assert.deepEqual(getNotesAtBeat(grid, 1e20), [])
})

test('beat grid candidates deduplicate shared bucket entries and handle negative boundaries', () => {
    const shared = source(0)
    const negative = source(-1e-9)
    const grid = new Map([
        [-1, new Set([shared, negative])],
        [0, new Set([shared])],
    ])
    assert.deepEqual(getNotesAtBeat(grid, 0), [shared, negative])
})

test('spatial elevation layout matches existing placement across dense and boundary cases', () => {
    let seed = 1729
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 2 ** 32
    }
    for (const laneScale of [0, 5, 30, 93.25]) {
        const currentAxes = { ...axes, laneScale }
        for (let sample = 0; sample < 30; sample++) {
            const notes = Array.from({ length: 80 }, (_, i) =>
                note(
                    Math.floor(random() * 9),
                    i % 13,
                    Math.round(random() * 12 - 6) + random() / 100,
                    Math.floor(random() * 4) + Math.floor(random() * 4) * 0.6e-7,
                    [0, 0.5, 1, 2, 8, 1e12][Math.floor(random() * 6)]!,
                ),
            )
            assert.deepEqual(
                layoutElevationNotes(notes, currentAxes).rows,
                legacyRows(notes, currentAxes),
            )
        }
    }
})

test('wide and extreme-coordinate notes preserve placement without unbounded bucket expansion', () => {
    const notes = [note(0, 0, 0, 0, 1e20), note(1, 0), note(2, 0, 1e20), note(3, 0, -1e20)]
    assert.deepEqual(layoutElevationNotes(notes, axes).rows, legacyRows(notes, axes))
})

test('repeated footprints preserve collision priority among intervening notes and slide ordering', () => {
    const notes = [
        note(0, 0, 0),
        note(1, 0, 1),
        note(2, 0, 0),
        note(3, 0, -1),
        note(4, 0, 0, 0, 0.5),
        note(0, 1, 0),
        note(5, 1, 1),
        note(6, 1, 0),
    ]
    assert.deepEqual(layoutElevationNotes(notes, axes).rows, legacyRows(notes, axes))
})

test('fractional elevation spacing excludes an exactly placed collision boundary', () => {
    const fractionalAxes = { ...axes, laneScale: 93.25 }
    const rows = layoutElevationNotes(
        [note(0, 0, 0, 0.00000006), note(1, 0, 0, 0.00000006)],
        fractionalAxes,
    ).rows
    assert.equal(rows[1]!.y, rows[0]!.y - (93.25 * 0.6 + 16))
})

test('a dense exact-beat layout preserves every independently selectable note and its true elevation', () => {
    const notes = Array.from({ length: 1000 }, (_, i) => note(i, 0))
    const rows = layoutElevationNotes(notes, axes).rows
    assert.equal(rows.length, notes.length)
    assert.equal(new Set(rows.map((row) => row.y)).size, notes.length)
    assert.deepEqual(
        rows.map((row) => row.note),
        notes.map((item) => item.note),
    )
    for (const row of rows) assert.equal(row.trueY, 550)
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i]!.y < rows[i - 1]!.y)
})
