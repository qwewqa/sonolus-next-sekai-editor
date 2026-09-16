import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSvgText } from '../../src/editor/canvas/text'

test('Canvas labels preserve the default SVG whitespace layout', () => {
    assert.equal(normalizeSvgText(' \t Stage  A\r\n '), 'Stage A')
    assert.equal(normalizeSvgText('Stage\t\tA'), 'Stage A')
    assert.equal(normalizeSvgText(' \r\n\t '), '')
    // Nonbreaking and em spaces are intentional glyph spacing, not collapsible
    // ASCII whitespace. In particular, do not use String.trim() here.
    assert.equal(
        normalizeSvgText('\u00a0Stage\u00a0\u00a0A\u2003'),
        '\u00a0Stage\u00a0\u00a0A\u2003',
    )
})
