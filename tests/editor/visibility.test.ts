import assert from 'node:assert/strict'
import test from 'node:test'
import { effect, shallowRef, stop } from 'vue'
import { computedVisibleEntities, isHitboxInView } from '../../src/editor/entities/visibility'
import type { Entity, EntityHitbox } from '../../src/state/entities'
import { toBpmEntity } from '../../src/state/entities/bpm'

test('scrolling between entity boundaries does not invalidate the rendered entity list', () => {
    const entities = shallowRef(
        Array.from({ length: 50 }, (_, beat) => toBpmEntity({ beat, bpm: 120 })),
    )
    const range = shallowRef({ min: 10.1, max: 20.1 })
    const visible = computedVisibleEntities(
        () => entities.value,
        () => range.value,
    )
    let renders = 0
    const render = effect(() => {
        void visible.value
        renders++
    })

    try {
        const initial = visible.value
        for (let frame = 1; frame <= 60; frame++) {
            range.value = { min: 10.1 + frame / 100, max: 20.1 + frame / 100 }
        }
        assert.equal(visible.value, initial)
        assert.equal(renders, 1)

        // Rebuilding candidates after an offscreen edit should also stay stable.
        entities.value = [...entities.value, toBpmEntity({ beat: 100, bpm: 150 })]
        assert.equal(visible.value, initial)
        assert.equal(renders, 1)

        range.value = { min: 11.1, max: 21.1 }
        assert.deepEqual(
            visible.value.map(({ beat }) => beat),
            [12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        )
        assert.equal(renders, 2)

        const replacement = toBpmEntity({ beat: 12, bpm: 180 })
        entities.value = entities.value.map((entity) => (entity.beat === 12 ? replacement : entity))
        assert.equal(visible.value[0], replacement)
        assert.equal(renders, 3)
    } finally {
        stop(render)
    }
})

test('point entities and spanning connections preserve inclusive viewport boundaries', () => {
    const pointTypes = [
        'bpm',
        'timeScale',
        'note',
        'cameraEventJoint',
        'stageMaskEventJoint',
        'stagePivotEventJoint',
        'stageStyleEventJoint',
        'stageTransformEventJoint',
    ] as const
    const connectionTypes = [
        'cameraEventConnection',
        'stageMaskEventConnection',
        'stagePivotEventConnection',
        'stageStyleEventConnection',
        'stageTransformEventConnection',
    ] as const
    const points = pointTypes.flatMap((type) =>
        [9, 10, 15, 20, 21].map((beat) => ({ type, beat }) as Entity),
    )
    const connections = connectionTypes.flatMap((type) =>
        [
            [0, 9],
            [0, 10],
            [0, 30],
            [20, 30],
            [21, 30],
        ].map(
            ([min, max]) =>
                ({
                    type,
                    beat: min,
                    min: { beat: min },
                    max: { beat: max },
                }) as Entity,
        ),
    )
    const connectors = [
        [0, 9],
        [0, 10],
        [0, 30],
        [20, 30],
        [21, 30],
    ].map(
        ([head, tail]) =>
            ({
                type: 'connector',
                beat: head,
                head: { beat: head },
                tail: { beat: tail },
            }) as Entity,
    )
    const entities = [...points, ...connections, ...connectors]
    const visible = computedVisibleEntities(
        () => entities,
        () => ({ min: 10, max: 20 }),
    )

    assert.deepEqual(visible.value, [
        ...points.filter((entity) => entity.beat >= 10 && entity.beat <= 20),
        ...connections.filter((_, index) => index % 5 >= 1 && index % 5 <= 3),
        ...connectors.slice(1, 4),
    ])
})

test('selection outlines remain visible when their centers are outside the viewport', () => {
    const bounds = { l: -6, r: 6, t: -20, b: -10 }
    const hitbox: EntityHitbox = { lane: 0, beat: 0, w: 1, h: 0.4 }

    assert.equal(isHitboxInView(hitbox, -20.49, bounds), true)
    assert.equal(isHitboxInView(hitbox, -9.51, bounds), true)
    assert.equal(isHitboxInView(hitbox, -20.51, bounds), false)
    assert.equal(isHitboxInView(hitbox, -9.49, bounds), false)
    assert.equal(isHitboxInView({ ...hitbox, lane: -7.09 }, -15, bounds), true)
    assert.equal(isHitboxInView({ ...hitbox, lane: 7.09 }, -15, bounds), true)
    assert.equal(isHitboxInView({ ...hitbox, lane: -7.11 }, -15, bounds), false)
    assert.equal(isHitboxInView({ ...hitbox, lane: 7.11 }, -15, bounds), false)

    // Wide camera/mask hitboxes can span the viewport with an offscreen center.
    assert.equal(isHitboxInView({ ...hitbox, lane: 20, w: 30 }, -15, bounds), true)

    // At the viewport edge only the outer half of the non-scaling stroke may
    // remain visible. Keep it mounted at different editor zoom levels.
    for (const pixelSize of [0.01, 0.1, 0.5]) {
        assert.equal(isHitboxInView(hitbox, -20.5 - pixelSize / 2, bounds, pixelSize), true)
        assert.equal(isHitboxInView(hitbox, -9.5 + pixelSize / 2, bounds, pixelSize), true)
        assert.equal(
            isHitboxInView({ ...hitbox, lane: 7.1 + pixelSize / 2 }, -15, bounds, pixelSize),
            true,
        )
        assert.equal(isHitboxInView(hitbox, -20.5 - pixelSize * 2, bounds, pixelSize), false)
    }
})
