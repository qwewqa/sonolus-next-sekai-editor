import assert from 'node:assert/strict'
import test from 'node:test'
import { ease, easeOvershoot, eases, isStepEase } from '../../src/ease'
import { easeGlyphPathD, easeGlyphPoints } from '../../src/easeGlyph'

test('ease glyphs run up through time inside the unit square', () => {
    for (const type of eases) {
        const points = easeGlyphPoints(type)
        assert.deepEqual(points[0]?.[1], 1, type)
        assert.deepEqual(points.at(-1)?.[1], 0, type)
        for (const [index, [x, y]] of points.entries()) {
            assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${type} ${x} ${y}`)
            assert.ok(index === 0 || y <= (points[index - 1]?.[1] ?? 1), type)
        }
    }
})

test('ease glyphs follow the ease from one value to the other', () => {
    for (const type of eases) {
        if (isStepEase(type)) continue
        const overshoot = easeOvershoot(type)
        for (const [x, y] of easeGlyphPoints(type)) {
            const value = ease(type, 1 - y)
            assert.ok(Math.abs(x - (value + overshoot) / (1 + 2 * overshoot)) < 1e-9, type)
        }
    }
    assert.deepEqual(easeGlyphPoints('linear'), [
        [0, 1],
        [1, 0],
    ])
    assert.ok(easeGlyphPoints('inQuad').length > 4)
})

test('step glyphs jump where their values change', () => {
    assert.deepEqual(easeGlyphPoints('inStep'), [
        [0, 1],
        [0, 0],
        [1, 0],
    ])
    assert.deepEqual(easeGlyphPoints('outStep'), [
        [0, 1],
        [1, 1],
        [1, 0],
    ])
    assert.deepEqual(easeGlyphPoints('inOutStep'), [
        [0, 1],
        [0, 0.5],
        [1, 0.5],
        [1, 0],
    ])
    assert.deepEqual(easeGlyphPoints('outInStep'), [
        [0, 1],
        [0.5, 1],
        [0.5, 0],
        [1, 0],
    ])
})

test('decreasing ease glyphs mirror the increasing ones', () => {
    for (const type of eases) {
        assert.deepEqual(
            easeGlyphPoints(type, true),
            easeGlyphPoints(type).map(([x, y]) => [1 - x, y]),
            type,
        )
    }
})

test('overshooting ease glyphs shrink to keep their overshoot inside', () => {
    const inXs = easeGlyphPoints('inElastic').map(([x]) => x)
    assert.ok(Math.min(...inXs) < 0.01)
    assert.ok(inXs[0]! > 0.2)
    const outXs = easeGlyphPoints('outElastic').map(([x]) => x)
    assert.ok(Math.max(...outXs) > 0.99)
    assert.ok(outXs.at(-1)! < 0.8)
})

test('ease glyph path data fits its box', () => {
    assert.equal(easeGlyphPathD('linear', false, 2, 2, 12, 12), 'M 2 14 L 14 2')
    assert.equal(easeGlyphPathD('linear', true, 2, 2, 12, 12), 'M 14 14 L 2 2')
    assert.equal(easeGlyphPathD('outStep', false, 0, 0, 10, 20), 'M 0 20 L 10 20 L 10 0')
})
