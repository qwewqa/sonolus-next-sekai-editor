import assert from 'node:assert/strict'
import test from 'node:test'
import { getGuideFill } from '../../src/editor/entities/connector/guideFill'
import { isConnectorVisible } from '../../src/editor/entities/visibility'
import type { ConnectorEntity } from '../../src/state/entities/slides/connector'

test('constant guide alpha uses the original color and exact opacity without a gradient', () => {
    for (const alpha of [0, 0.125, 0.25, 0.5, 1]) {
        assert.deepEqual(getGuideFill('guide', '#abcdef', alpha, alpha), {
            fill: { fill: '#abcdef', 'fill-opacity': alpha },
        })
    }
})

test('changing alpha preserves the full gradient, including tiny differences', () => {
    for (const [headAlpha, tailAlpha] of [
        [0, 0.5],
        [0.5, 0],
        [0.25, 0.250000000001],
    ]) {
        assert.deepEqual(getGuideFill('guide', '#abcdef', headAlpha, tailAlpha), {
            fill: { fill: 'url(#guide)', 'fill-opacity': 1 },
            gradient: { id: 'guide', color: '#abcdef', headAlpha, tailAlpha },
        })
    }
})

test('only fully transparent guides and empty connectors omit their SVG subtree', () => {
    const connector = {
        type: 'connector',
        beat: 1,
        head: { beat: 1 },
        tail: { beat: 2 },
        segmentHead: { connectorType: 'guide', connectorGuideAlpha: 0, connectorIsFake: true },
        segmentTail: { connectorGuideAlpha: 0 },
    } as ConnectorEntity

    // Guide connectors never display fake markers, so no independent graphic is lost.
    assert.equal(isConnectorVisible(connector), false)
    assert.equal(
        isConnectorVisible({
            ...connector,
            segmentTail: { ...connector.segmentTail, connectorGuideAlpha: 0.001 },
        }),
        true,
    )
    assert.equal(
        isConnectorVisible({
            ...connector,
            segmentHead: { ...connector.segmentHead, connectorGuideAlpha: 0.001 },
        }),
        true,
    )

    for (const connectorType of ['active', 'damage'] as const) {
        assert.equal(
            isConnectorVisible({
                ...connector,
                segmentHead: { ...connector.segmentHead, connectorType },
            }),
            true,
        )
    }

    assert.equal(isConnectorVisible({ ...connector, tail: connector.head }), false)
})
