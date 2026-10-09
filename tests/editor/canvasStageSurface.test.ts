import assert from 'node:assert/strict'
import test from 'node:test'
import type { StageId } from '../../src/chart/stages'
import { createStageSurface } from '../../src/editor/canvas/stageSurface'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import { fullScope } from '../../src/editor/scopeRules'

test('stage cache is lazy, bounded and releases lost or unused backing stores', (t) => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const allocated: ReturnType<typeof canvas>[] = []
    const canvas = () => {
        const item = {
            width: 0,
            height: 0,
            lost: false,
            clears: 0,
            blits: 0,
            ctx: {
                globalAlpha: 1,
                save() {},
                restore() {},
                setTransform() {},
                fillRect() {
                    item.clears++
                },
                drawImage() {
                    item.blits++
                },
                isContextLost() {
                    return item.lost
                },
            },
            getContext() {
                return item.ctx
            },
        }
        return item
    }
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: () => {
                const item = canvas()
                allocated.push(item)
                return item
            },
        },
    })
    t.after(() => {
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
        else Reflect.deleteProperty(globalThis, 'document')
    })
    const target = canvas()
    const context = {
        ctx: target.ctx,
        pixelRatio: 1.25,
        scale: 25,
        ups: -2,
        bounds: { l: -4, r: 4, t: -4, b: 0, w: 8, h: 4 },
        state: { bpms: [] },
    } as unknown as EditorDrawContext
    const surface = createStageSurface()
    const draw = (width = 200, height = 100) =>
        surface.draw(context, width, height, { min: 0, max: 8 }, fullScope, 1)
    draw()
    assert.equal(allocated.length, 0, 'Basic never allocates or blits a stage surface')
    assert.equal(target.blits, 0)
    context.composed = {
        // A stage outside this view needs no paths, but still caches transparent
        // pixels. Its lifecycle must be identical to a visible stage bitmap.
        stages: new Map([[1 as StageId, { startBeat: 20, endBeat: 24 }]]),
    } as EditorDrawContext['composed']
    draw()
    assert.equal(allocated.length, 1)
    assert.deepEqual([allocated[0]!.width, allocated[0]!.height], [250, 125])
    const initialClears = allocated[0]!.clears
    context.state = { ...context.state, selectedEntities: [] }
    context.bounds = { ...context.bounds }
    draw()
    assert.equal(allocated[0]!.clears, initialClears, 'equal view reuses its bitmap')
    assert.equal(target.blits, 2)
    allocated[0]!.lost = true
    draw()
    assert.equal(allocated.length, 2)
    assert.deepEqual([allocated[0]!.width, allocated[0]!.height], [0, 0])
    assert.equal(target.blits, 3)
    draw(4096, 4096)
    assert.equal(allocated.length, 2, 'over-budget surfaces draw directly')
    assert.equal(target.blits, 3)
    assert.deepEqual([allocated[1]!.width, allocated[1]!.height], [0, 0])
    draw()
    assert.equal(allocated.length, 3)
    surface.clear()
    assert.deepEqual([allocated[2]!.width, allocated[2]!.height], [0, 0])
    draw()
    assert.equal(allocated.length, 4)
    Reflect.deleteProperty(allocated[3]!.ctx, 'isContextLost')
    draw()
    assert.equal(allocated.length, 4, 'older Canvas APIs still reuse the valid surface')
    context.composed = undefined
    draw()
    assert.deepEqual([allocated[3]!.width, allocated[3]!.height], [0, 0])
    assert.equal(allocated.length, 4)
})
