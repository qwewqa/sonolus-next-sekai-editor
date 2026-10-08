import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameCache } from '../../src/preview/engine/frameCache'

test('dense frame working sets are reused beyond the former 1024-seed limit', () => {
    let builds = 0
    const cache = createFrameCache(4096, (key) => ({ key, generation: builds++ }))
    const first = Array.from({ length: 3000 }, (_, key) => cache.get(key))

    for (let frame = 0; frame < 20; frame++) {
        cache.beginFrame()
        for (const [key, value] of first.entries()) assert.equal(cache.get(key), value)
        assert.equal(cache.size, first.length)
    }
    assert.equal(builds, first.length)
})

test('overflow does not evict the retained current-frame working set', () => {
    let builds = 0
    const cache = createFrameCache(4, (key) => ({ key, generation: builds++ }))
    const first = Array.from({ length: 12 }, (_, key) => cache.get(key))
    assert.equal(cache.size, 4)

    for (let frame = 0; frame < 5; frame++) {
        cache.beginFrame()
        for (const [key, value] of first.entries()) {
            const next = cache.get(key)
            assert.equal(next.key, value.key)
            if (key < 4) assert.equal(next, value)
            else assert.notEqual(next, value)
            assert.ok(cache.size <= 4)
        }
    }
    assert.equal(builds, 12 + 5 * 8)
})

test('a 25000-seed frame keeps the shared 16384-entry bound without total thrashing', () => {
    let builds = 0
    const capacity = 16384
    const count = 25000
    const cache = createFrameCache(capacity, (key) => ({ key, generation: builds++ }))
    const first = Array.from({ length: count }, (_, key) => cache.get(key))
    assert.equal(cache.size, capacity)

    for (let frame = 0; frame < 3; frame++) {
        cache.beginFrame()
        for (let key = 0; key < count; key++) {
            const value = cache.get(key)
            if (key < capacity) assert.equal(value, first[key])
            assert.ok(cache.size <= capacity)
        }
    }
    assert.equal(builds, count + 3 * (count - capacity))
})

test('new seeds at capacity cannot cascade eviction of previous-frame seeds', () => {
    let builds = 0
    const cache = createFrameCache(4, (key) => ({ key, generation: builds++ }))
    const first = Array.from({ length: 4 }, (_, key) => cache.get(key))
    cache.beginFrame()
    cache.get(4)
    for (let key = 0; key < 3; key++) assert.equal(cache.get(key), first[key])
    assert.equal(builds, 5)
    assert.equal(cache.size, 4)

    // The unused fourth seed is released at the next boundary, admitting the
    // replacement without sacrificing the three seeds still in use.
    cache.beginFrame()
    const replacement = cache.get(4)
    assert.equal(cache.get(4), replacement)
    assert.equal(builds, 6)
    for (let key = 0; key < 3; key++) assert.equal(cache.get(key), first[key])
    assert.equal(cache.size, 4)
})

test('pressure preserves both promoted and not-yet-visited previous entries', () => {
    const cache = createFrameCache(4, (key) => ({ key }))
    const first = Array.from({ length: 4 }, (_, key) => cache.get(key))
    cache.beginFrame()
    assert.equal(cache.get(0), first[0])
    assert.equal(cache.get(2), first[2])
    cache.get(4)
    assert.equal(cache.size, 4)
    assert.equal(cache.get(3), first[3])
    cache.get(1)
    assert.equal(cache.size, 4)
    assert.equal(cache.get(0), first[0])
    assert.equal(cache.get(2), first[2])
    assert.equal(cache.get(3), first[3])
})

test('seeks remain bounded and inactive generations release their entries', () => {
    const cache = createFrameCache(16, (key) => ({ key }))
    for (let frame = 0; frame < 100; frame++) {
        cache.beginFrame()
        const base = frame % 2 ? frame * 100 : -frame * 100
        for (let key = base; key < base + 25; key++) {
            assert.equal(cache.get(key).key, key)
            assert.ok(cache.size <= 16)
        }
    }
    cache.beginFrame()
    assert.ok(cache.size <= 16)
    cache.beginFrame()
    assert.equal(cache.size, 0)
})

test('a sparse frame releases a preceding dense working set on the next frame', () => {
    const cache = createFrameCache(4096, (key) => ({ key }))
    for (let key = 0; key < 3000; key++) cache.get(key)
    cache.beginFrame()
    const retained = cache.get(17)
    cache.beginFrame()
    assert.equal(cache.size, 1)
    assert.equal(cache.get(17), retained)
})
