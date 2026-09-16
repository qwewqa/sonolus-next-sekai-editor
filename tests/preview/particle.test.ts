import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { Quad } from '../../src/preview/engine/math'
import { drawParticleEffect } from '../../src/preview/engine/particleDraw'
import type { PreviewRenderer, ZKey } from '../../src/preview/gl'
import type {
    ParticleEffect,
    ParticleExpression,
    ParticleProperty,
    ResolvedParticle,
} from '../../src/preview/particle'
import type { Sprite } from '../../src/preview/skin'

const sprite: Sprite = { u0: 0.1, v0: 0.2, u1: 0.7, v1: 0.9, texture: 1 }
const layout: Quad = {
    bl: { x: -2, y: -1 },
    tl: { x: -1, y: 2 },
    tr: { x: 3, y: 1.5 },
    br: { x: 2, y: -0.5 },
}
const alternateLayout: Quad = {
    bl: { x: 1, y: -4 },
    tl: { x: 2, y: -1 },
    tr: { x: 6, y: 2 },
    br: { x: 4, y: -3 },
}
const z: ZKey = [100, 17]
const property = (from: ParticleExpression, to = from, ease = 'linear'): ParticleProperty => ({
    from,
    to,
    ease,
})
const constant = (value: number) => property({ c: value })
const particle = (overrides: Partial<ResolvedParticle> = {}): ResolvedParticle => ({
    sprite,
    tint: { r: 0.3, g: 0.5, b: 0.7 },
    start: 0,
    duration: 1,
    x: constant(0),
    y: constant(0),
    w: constant(0.25),
    h: constant(0.5),
    r: constant(0),
    a: constant(1),
    ...overrides,
})
const effect: ParticleEffect = {
    transform: {
        x1: { x1: 1, r1: 0.2, sinr8: 0.1 },
        y1: { y1: 1, cosr2: 0.15 },
        x2: { x2: 1, cosr3: 0.2 },
        y2: { y2: 1, r4: 0.3 },
        x3: { x3: 1, sinr5: 0.25 },
        y3: { y3: 1, r6: 0.1 },
        x4: { x4: 1, cosr7: 0.2 },
        y4: { y4: 1, r8: 0.2 },
    },
    groups: [
        {
            count: 2,
            particles: [
                particle({
                    x: property(
                        { c: -0.2, r1: 0.4, sinr2: 0.08, missing: 7, r8: 0 },
                        { r3: 0.6, cosr4: 0.15 },
                        'inOutQuad',
                    ),
                    y: property({ r2: -0.3, sinr5: 0.2 }, { cosr6: 0.4 }, 'outSine'),
                    w: property({ c: 0.3, r3: 0.1 }, { c: 0.5, cosr7: 0.1 }, 'none'),
                    h: property({ c: 0.2, r4: 0.1 }, { c: 0.4, sinr8: 0.1 }, 'outBack'),
                    r: property(
                        { sinr3: 0.2, r5: 0.1, r6: -0.3 },
                        { cosr2: 0.5, r7: 0.2 },
                        'inCubic',
                    ),
                    a: property({ c: 0.4, r8: 0.1 }, { c: 0.9, r1: 0.1 }),
                }),
                particle({ sprite: undefined }),
                particle({ a: constant(-0.5) }),
            ],
        },
        {
            count: 1,
            particles: [
                particle({
                    tint: { r: 1, g: 0.2, b: 0.4 },
                    x: property({}, { c: 0.5, r1: -0.25 }, 'unknown'),
                    y: property({ cosr8: 0.2 }, { sinr1: -0.3 }),
                    a: constant(2),
                }),
            ],
        },
    ],
}

const capture = (
    targetEffect: ParticleEffect,
    progress: number,
    seed: number,
    targetLayout = layout,
    loop = false,
) => {
    const draws: Parameters<PreviewRenderer['draw']>[] = []
    drawParticleEffect(
        (...args) => draws.push(args),
        targetEffect,
        targetLayout,
        progress,
        loop,
        seed,
        z,
    )
    return draws
}
const digest = (draws: ReturnType<typeof capture>) =>
    createHash('sha256').update(JSON.stringify(draws)).digest('hex')

// Complete draw-output fingerprints recorded from the uncached particle renderer.
const goldenCases = [
    {
        seed: -1,
        progress: 0,
        layout,
        expected: 'f73bcd3bb1d78a9c2a235fbe20ddbd97ebebcd3f750153c6f6cedd19e2bb8c90',
    },
    {
        seed: -1,
        progress: 0.375,
        layout,
        expected: '5878f3c2d7abb32074dd3693b2bb8acab977ff6c18ce57de5a8d0a5958667d65',
    },
    {
        seed: 0,
        progress: 1,
        layout,
        expected: 'f70e362a401d08354dba732e1fe33b82e4969ee6fa2bdffeca4251799b18a9f9',
    },
    {
        seed: 4294967303,
        progress: 0.625,
        layout: alternateLayout,
        expected: 'ec13c0f3b4958157ff2e7a101be5b69f3ff2fd15fc6e65e3d8596bc84b2a769c',
    },
    {
        seed: -4294967303,
        progress: 0.375,
        layout: alternateLayout,
        expected: 'fa629c9dcd565b42db3b599fe08fe4870fcbe742bf17323c02e8e4df2a59e334',
    },
    {
        seed: 7.125,
        progress: 0.625,
        layout,
        expected: 'd71b82437679793c866d5cb3f3dd6d276159115d13ff7fd761691222e78f5dab',
    },
]

test('particle draw output preserves random expressions, transforms, easing, tint and ordering', () => {
    for (const entry of goldenCases) {
        const draws = capture(effect, entry.progress, entry.seed, entry.layout)
        assert.equal(draws.length, 3)
        assert.equal(digest(draws), entry.expected, JSON.stringify(entry))
    }
})

test('revisiting particle frames stays deterministic after changes and many other seeds', () => {
    const first = capture(effect, 0.375, -1)
    const frozenFirst = structuredClone(first)
    assert.deepEqual(capture(effect, 0.375, -1), first)
    assert.notDeepEqual(capture(effect, 0.625, -1), first)
    assert.notDeepEqual(capture(effect, 0.375, -1, alternateLayout), first)

    for (let seed = 100; seed < 2200; seed++) capture(effect, 0.5, seed)

    assert.deepEqual(capture(effect, 0.375, -1), frozenFirst)
    assert.deepEqual(first, frozenFirst, 'later frames must not mutate previous draws')
    assert.equal(digest(first), goldenCases[1]?.expected)
})

test('particle windows wrap only when looping and include both endpoints', () => {
    const targetEffect: ParticleEffect = {
        groups: [{ count: 1, particles: [particle({ start: 0.75, duration: 0.5 })] }],
    }
    assert.equal(capture(targetEffect, 0.125, 1).length, 0)
    assert.deepEqual(capture(targetEffect, 0.125, 1, layout, true), capture(targetEffect, 1.125, 1))
    assert.equal(capture(targetEffect, 0.25, 1, layout, true).length, 1)
    assert.equal(capture(targetEffect, 0.250001, 1, layout, true).length, 0)
    assert.equal(capture(targetEffect, 0.749999, 1).length, 0)
    assert.equal(capture(targetEffect, 0.75, 1).length, 1)
    assert.equal(capture(targetEffect, 1.25, 1).length, 1)
    assert.equal(capture(targetEffect, 1.250001, 1).length, 0)
})

test('zero-duration particles draw their final properties only at their start time', () => {
    const targetEffect: ParticleEffect = {
        groups: [
            {
                count: 1,
                particles: [
                    particle({
                        start: 0.5,
                        duration: 0,
                        x: property({ c: -1 }, { c: 0.75 }, 'none'),
                        a: property({ c: -1 }, { c: 2 }, 'none'),
                    }),
                ],
            },
        ],
    }
    assert.equal(capture(targetEffect, 0.499999, 123).length, 0)
    assert.equal(capture(targetEffect, 0.500001, 123).length, 0)
    assert.deepEqual(
        capture(targetEffect, 0.5, 123),
        capture(
            {
                groups: [{ count: 1, particles: [particle({ x: constant(0.75) })] }],
            },
            0.5,
            123,
        ),
    )
})

test('missing sprites and nonpositive alpha emit no draws while alpha above one is clamped', () => {
    const targetEffect: ParticleEffect = {
        groups: [
            {
                count: 1,
                particles: [
                    particle({ sprite: undefined }),
                    particle({ a: constant(-1) }),
                    particle({ a: constant(0) }),
                    particle({ a: constant(2) }),
                ],
            },
        ],
    }
    assert.deepEqual(
        capture(targetEffect, 0.5, 0),
        capture(
            {
                groups: [{ count: 1, particles: [particle()] }],
            },
            0.5,
            0,
        ),
    )
})
