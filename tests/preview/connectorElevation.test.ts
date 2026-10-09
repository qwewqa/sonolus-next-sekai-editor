import assert from 'node:assert/strict'
import test from 'node:test'
import { elevationConnectorFracs } from '../../src/preview/engine/connectorElevation'

test('elevation sampling retains alpha density even on geometrically straight edges', () => {
    const fractions = elevationConnectorFracs(
        (fraction) => ({ edges: [{ x: fraction, y: 0 }], rotation: 0 }),
        1,
        96,
    )
    let previous = 0
    for (const fraction of fractions) {
        assert.ok((fraction - previous) * 96 <= 1)
        previous = fraction
    }
    assert.equal(previous, 1)
    assert.ok(fractions.length <= 128)
})

test('unwrapped rotation prevents quarter samples aliasing four complete turns', () => {
    const fractions = elevationConnectorFracs(
        (fraction) => ({
            edges: [
                {
                    x: 0.1 * Math.cos(8 * Math.PI * fraction),
                    y: 0.1 * Math.sin(8 * Math.PI * fraction),
                },
            ],
            rotation: 8 * Math.PI * fraction,
        }),
        1,
    )
    assert.ok(fractions.length >= 32)
    let previous = 0
    for (const fraction of fractions) {
        assert.ok((fraction - previous) * 8 * Math.PI <= Math.PI / 4)
        previous = fraction
    }
    assert.equal(previous, 1)
})

test('adaptive budget overflow switches to uniform complete-span coverage', () => {
    const fractions = elevationConnectorFracs(
        (fraction) => ({
            edges: [{ x: Math.sin(fraction * 128 * Math.PI), y: fraction }],
            rotation: fraction * 128 * Math.PI,
        }),
        1,
    )
    assert.deepEqual(
        fractions,
        Array.from({ length: 128 }, (_, index) => (index + 1) / 128),
    )
})

test('raw edges trigger refinement even when mask-clipped edges collapse', () => {
    const fractions = elevationConnectorFracs(
        (fraction) => ({
            edges: [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
                { x: fraction ** 2, y: fraction },
                { x: fraction ** 2 + 0.01, y: fraction },
            ],
            rotation: 0,
        }),
        1,
    )
    assert.ok(fractions.length > 1)
    assert.equal(fractions.at(-1), 1)
})

test('straight elevation connectors need one segment and disabled quality stays bounded', () => {
    const sample = (fraction: number) => ({ edges: [{ x: fraction, y: fraction }], rotation: 0 })
    assert.deepEqual(elevationConnectorFracs(sample, 1), [1])
    assert.deepEqual(elevationConnectorFracs(sample, 0), [1])
})
