import assert from 'node:assert/strict'
import test from 'node:test'
import { interpolateRaw } from '../../src/utils/interpolate'

test('names are inserted verbatim, whatever replacement patterns or placeholders they hold', () => {
    assert.equal(interpolateRaw('Added {0} folder', 'Price $& Co'), 'Added Price $& Co folder')
    assert.equal(
        interpolateRaw('Renamed {0} folder to {1}', 'Old {1}', 'New'),
        'Renamed Old {1} folder to New',
    )
    assert.equal(
        interpolateRaw('Renamed {0} folder to {1}', "Chorus $'", 'Bridge $`$$'),
        "Renamed Chorus $' folder to Bridge $`$$",
    )
})

test('plural forms follow the first value, and missing values leave their placeholder', () => {
    assert.equal(interpolateRaw('Added {0} note|Added {0} notes', '1'), 'Added 1 note')
    assert.equal(interpolateRaw('Added {0} note|Added {0} notes', '2'), 'Added 2 notes')
    assert.equal(interpolateRaw('Added {0} {1} event', '2'), 'Added 2 {1} event')
})
