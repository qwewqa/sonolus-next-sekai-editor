import assert from 'node:assert/strict'
import test from 'node:test'
import { createSelectionOutline } from '../../src/preview/selectionOutline'

const quad = (left: number, right: number) => ({
    bl: { x: left, y: 0 },
    br: { x: right, y: 0 },
    tr: { x: right, y: 1 },
    tl: { x: left, y: 1 },
})

test('selection outline removes interior edges of sliced connectors', () => {
    const outline = createSelectionOutline()
    const connector = {}
    outline.add(quad(0, 1), connector)
    outline.add(quad(1, 2), connector)
    const edges = outline.edges()
    assert.equal(edges.length, 6)
    assert.ok(!edges.some((edge) => edge.a.x === 1 && edge.b.x === 1))
})

test('overlaid sprites retain outlines and neighboring objects retain their own shared boundary', () => {
    const outline = createSelectionOutline()
    const note = {}
    outline.add(quad(0, 1), note)
    outline.add(quad(0, 1), note)
    assert.equal(outline.edges().length, 4)
    outline.add(quad(1, 2), {})
    assert.equal(outline.edges().length, 8)
})

test('explicit selection lines remain visible beside sliced and degenerate outlines', () => {
    const outline = createSelectionOutline()
    const a = { x: 0, y: 2 }
    const b = { x: 1, y: 2 }
    outline.add({ bl: a, br: b, tr: b, tl: a }, {})
    assert.equal(outline.edges().length, 0)
    outline.addLine(a, b)
    assert.deepEqual(outline.edges(), [{ a, b }])
    outline.add(quad(0, 1), {})
    assert.equal(outline.edges().length, 5)
})
