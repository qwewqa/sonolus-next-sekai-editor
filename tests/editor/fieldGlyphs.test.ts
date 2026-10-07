import assert from 'node:assert/strict'
import test from 'node:test'
import type { NoteSfx, NoteType } from '../../src/chart/note'
import { connectorColors } from '../../src/editor/utils/connectorColors'
import { flickArrowPoints, flickGlyphPoints } from '../../src/flickArrow'
import { noteTypeShapes, sfxShapes } from '../../src/modals/form/noteShapes'
import { connectorStyleColor, guideColors } from '../../src/utils/colors'

const parse = (points: string) => points.split(' ').map((point) => point.split(',').map(Number))

test('flick glyphs are the canvas arrows, centered and scaled', () => {
    for (const direction of Object.keys(flickArrowPoints) as (keyof typeof flickArrowPoints)[]) {
        const glyph = parse(flickGlyphPoints(direction, 8, 6.5))
        const canvas = flickArrowPoints[direction]
        assert.equal(glyph.length, canvas.length)
        const xs = glyph.map(([x]) => x!)
        const ys = glyph.map(([, y]) => y!)
        // Centered in the 16-unit box and inside it.
        assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs) - 16) < 0.02, direction)
        assert.ok(Math.abs(Math.min(...ys) + Math.max(...ys) - 16) < 0.02, direction)
        assert.ok(Math.min(...xs, ...ys) >= 0 && Math.max(...xs, ...ys) <= 16, direction)
        // Same shape: each edge is the canvas edge scaled.
        for (let i = 1; i < canvas.length; i++) {
            const dx = glyph[i]![0]! - glyph[0]![0]!
            const expected = (canvas[i]![0] - canvas[0]![0]) * 6.5
            assert.ok(Math.abs(dx - expected) < 0.02, direction)
        }
    }
    // Up points up: its tip is the topmost point.
    const up = parse(flickGlyphPoints('up', 8, 6.5))
    assert.equal(Math.min(...up.map(([, y]) => y!)), up[2]![1])
})

test('connector swatches use the styled connector base color', () => {
    assert.equal(connectorStyleColor('black'), '#555555')
    assert.equal(connectorStyleColor('red'), guideColors.red)
    // The canvas draws styled active connectors from the same base.
    assert.equal(
        connectorColors({ connectorType: 'active', connectorStyle: 'black', isCritical: false })
            .body,
        connectorStyleColor('black'),
    )
})

test('every note type and SFX has a note pictogram or an empty slot', () => {
    const typeShapes: Record<string, unknown> = noteTypeShapes
    const soundShapes: Record<string, unknown> = sfxShapes
    for (const value of [
        'default',
        'trace',
        'anchor',
        'damage',
        'forceTick',
        'forceNonTick',
    ] satisfies NoteType[])
        assert.notEqual(typeShapes[value], undefined, value)
    for (const value of [
        'default',
        'none',
        'normalTap',
        'criticalTap',
        'normalFlick',
        'criticalFlick',
        'normalTrace',
        'criticalTrace',
        'normalTick',
        'criticalTick',
        'damage',
    ] satisfies NoteSfx[])
        assert.notEqual(soundShapes[value], undefined, value)
    // Only the values with nothing to picture take the empty slot.
    assert.equal(noteTypeShapes.default, null)
    assert.equal(sfxShapes.default, null)
    assert.equal(sfxShapes.none, null)
    // A note type and the sound of the same note share one picture.
    assert.equal(noteTypeShapes.trace, sfxShapes.normalTrace[0])
    assert.equal(noteTypeShapes.forceTick, sfxShapes.normalTick[0])
    assert.equal(noteTypeShapes.damage, sfxShapes.damage[0])
    // Critical sounds are the same notes in the critical colours.
    assert.deepEqual(sfxShapes.criticalFlick, [sfxShapes.normalFlick[0], true])
})
