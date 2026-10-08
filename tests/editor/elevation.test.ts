import assert from 'node:assert/strict'
import test from 'node:test'
import {
    elevationGridDivision,
    layoutElevationNotes,
    sameBeat,
    snapElevation,
    type ElevationNote,
} from '../../src/editor/elevation/layout'
import { elevationViewport, fitElevationViewport } from '../../src/editor/elevation/viewport'
import type { SlideId } from '../../src/state/entities/slides'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const note = (slide: number, order: number, lane = 0, elevation = 0): ElevationNote => ({
    note: { slideId: slide as SlideId } as NoteEntity,
    lane,
    size: 1,
    elevation,
    attached: false,
    order,
})
const viewport = {
    width: 600,
    height: 600,
    laneLeft: -10,
    laneScale: 30,
    elevationCenter: 2.5,
    elevationScale: 100,
}

test('grid lines follow the elevation snap, thinned to stay readable', () => {
    // Each snap step while lines stay at least 7.5px apart.
    assert.equal(elevationGridDivision(120, 8), 8)
    assert.equal(elevationGridDivision(120, 16), 16)
    assert.equal(elevationGridDivision(120, 2), 2)
    // Too dense: halved, so lines still fall on snap points.
    assert.equal(elevationGridDivision(120, 64), 16)
    assert.equal(elevationGridDivision(40, 8), 4)
    assert.equal(elevationGridDivision(20, 8), 2)
    assert.equal(elevationGridDivision(5, 8), 1)
    assert.equal(elevationGridDivision(5, 1), 1)
    // Snap off keeps the zoom-based lines.
    assert.equal(elevationGridDivision(60, 0), 8)
    assert.equal(elevationGridDivision(30, 0), 4)
    assert.equal(elevationGridDivision(29, 0), 1)
    // The default snap matches the zoom-based lines down to 30px per unit.
    for (const scale of [30, 45, 59, 60, 90, 200]) {
        assert.equal(elevationGridDivision(scale, 8), elevationGridDivision(scale, 0), `${scale}`)
    }
})

test('overlapping notes stay at their actual elevation', () => {
    const layout = layoutElevationNotes([note(1, 0), note(2, 0), note(3, 0)], viewport)
    assert.equal(layout.rows.length, 3)
    assert.equal(new Set(layout.rows.map((row) => row.y)).size, 1)
    for (const row of layout.rows) {
        assert.equal(row.y, layout.yAt(0))
        assert.equal(row.x, layout.xAt(0))
    }
})

test('same-elevation slide notes stay level regardless of connection order', () => {
    const layout = layoutElevationNotes([note(1, 2, 5), note(1, 0, -5), note(1, 1, 0)], viewport)
    const rows = [...layout.rows].sort((a, b) => a.order - b.order)
    assert.equal(rows.length, 3)
    assert.equal(rows[0]!.y, rows[1]!.y)
    assert.equal(rows[0]!.y, rows[2]!.y)
})

test('the elevation viewport maps fixed units without shifting the axis during an edit', () => {
    const before = layoutElevationNotes([note(1, 0, 0, 2)], viewport)
    const after = layoutElevationNotes([note(1, 0, 0, 2.25)], viewport)
    assert.equal(before.yAt(0), after.yAt(0))
    assert.equal(before.yAt(0) - before.yAt(5), 500)
    assert.equal(before.rows[0]!.y - after.rows[0]!.y, 25)
    assert.equal(before.xAt(2) - before.xAt(0), 60)
})

test('beat matching includes arithmetic round trips and excludes nearby notes', () => {
    assert.ok(sameBeat(1 / 3, 1 / 3 + 1e-12))
    assert.ok(!sameBeat(4, 4.0001))
})

test('elevation snapping supports eighths, negative values, and disabling snapping', () => {
    assert.equal(snapElevation(0.18, 8), 0.125)
    assert.equal(snapElevation(-0.18, 8), -0.125)
    assert.equal(snapElevation(0.18, 0), 0.18)
})

test('initial elevation fitting adapts to height and includes elevations outside the default range', () => {
    const saved = { ...elevationViewport }
    try {
        fitElevationViewport(600, [note(1, 0)])
        const smallScale = elevationViewport.scale
        fitElevationViewport(900, [note(1, 0)])
        assert.ok(elevationViewport.scale > smallScale)
        const notes = [note(1, 0, 0, -1), note(2, 0, 0, 8)]
        fitElevationViewport(600, notes)
        const layout = layoutElevationNotes(notes, {
            ...viewport,
            elevationCenter: elevationViewport.center,
            elevationScale: elevationViewport.scale,
        })
        assert.ok(layout.yAt(8) >= 0)
        assert.ok(layout.yAt(-1) <= 600)
    } finally {
        Object.assign(elevationViewport, saved)
    }
})
