import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createNoteRenderer, getNoteVisualType } from '../../src/editor/canvas/notes'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import type { NoteEntity } from '../../src/state/entities/slides/note'

const note = (beat: number, properties: Partial<NoteEntity> = {}) =>
    ({
        type: 'note',
        beat,
        noteType: 'default',
        connectorType: 'active',
        isConnectorSeparator: false,
        ...properties,
    }) as NoteEntity

test('canvas notes retain the head, tick, tail and isolated roles of active slides', () => {
    const head = note(0)
    const middle = note(1)
    const nonTick = note(2, { noteType: 'forceNonTick' })
    const tail = note(3)
    const infos = [head, middle, nonTick, tail].map((note) => ({
        note,
        activeHead: head,
        activeTail: tail,
    }))
    const lookup = new Map(infos.map((info) => [info.note, info]))

    for (const index of [undefined, lookup]) {
        assert.deepEqual(
            [head, middle, nonTick, tail].map((entity) => getNoteVisualType(entity, infos, index)),
            ['head', 'tick', 'single', 'tail'],
        )
    }
    assert.equal(
        getNoteVisualType(head, [{ note: head, activeHead: head, activeTail: head }]),
        'single',
    )
    assert.equal(getNoteVisualType(head, [{ note: head }]), 'single')
    assert.equal(getNoteVisualType(head), 'single')
})

test('explicit note types retain their appearance regardless of slide position', () => {
    for (const [noteType, expected] of [
        ['anchor', 'anchor'],
        ['damage', 'damage'],
        ['trace', 'trace'],
        ['forceTick', 'tick'],
    ] as const) {
        const entity = note(0, { noteType })
        assert.equal(getNoteVisualType(entity, [{ note: entity, activeHead: entity }]), expected)
        assert.equal(getNoteVisualType(entity), expected)
    }
})

test('moving note ghosts retain the role of the original note', () => {
    const head = note(0)
    const middle = note(1)
    const tail = note(2)
    const infos = [head, middle, tail].map((note) => ({
        note,
        activeHead: head,
        activeTail: tail,
    }))

    assert.equal(getNoteVisualType(note(10, { useInfoOf: head }), infos), 'head')
    assert.equal(getNoteVisualType(note(-10, { useInfoOf: tail }), infos), 'tail')
    assert.equal(
        getNoteVisualType(note(10, { noteType: 'forceNonTick', useInfoOf: middle }), infos),
        'tick',
    )
})

test('new note ghosts infer roles before, within and after active slide segments', () => {
    const head = note(1)
    const tail = note(3)
    const infos = [head, tail].map((note) => ({ note }))

    assert.equal(getNoteVisualType(note(0), infos), 'head')
    assert.equal(getNoteVisualType(note(2), infos), 'tick')
    assert.equal(getNoteVisualType(note(4), infos), 'tail')
    assert.equal(getNoteVisualType(note(0, { connectorType: 'guide' }), infos), 'single')
    assert.equal(
        getNoteVisualType(note(2, { isConnectorSeparator: true, connectorType: 'guide' }), infos),
        'tail',
    )
})

test('new note ghosts respect inactive separators at the same beat', () => {
    const infos = [
        note(1, { connectorType: 'guide' }),
        note(3, { isConnectorSeparator: true }),
        note(5, { isConnectorSeparator: true, connectorType: 'damage' }),
        note(7),
    ].map((note) => ({ note }))

    assert.equal(getNoteVisualType(note(2), infos), 'single')
    assert.equal(getNoteVisualType(note(2, { isConnectorSeparator: true }), infos), 'head')
    assert.equal(getNoteVisualType(note(3), infos), 'tick')
    assert.equal(getNoteVisualType(note(5), infos), 'single')
    assert.equal(getNoteVisualType(note(6, { isConnectorSeparator: true }), infos), 'head')
    assert.equal(getNoteVisualType(note(8, { isConnectorSeparator: true }), infos), 'single')
})

const artworkFixture = (t: TestContext, scale = 40, pixelRatio = 1) => {
    let images = 0
    const makeCanvasContext = () =>
        new Proxy(
            { globalAlpha: 1 },
            {
                get(target, property) {
                    if (property in target) return Reflect.get(target, property)
                    if (property === 'drawImage') return () => images++
                    return () => {}
                },
            },
        ) as unknown as CanvasRenderingContext2D
    const canvases: { width: number; height: number }[] = []
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement() {
                const canvas = { width: 0, height: 0, getContext: makeCanvasContext }
                canvases.push(canvas)
                return canvas
            },
        },
    })
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'document', original)
        else Reflect.deleteProperty(globalThis, 'document')
    })
    const renderer = createNoteRenderer()
    const context = {
        ctx: makeCanvasContext(),
        scale,
        pixelRatio,
        ups: -2,
        recentlyActive: false,
        state: {
            bpms: [{ x: 0, y: 0, s: 0.5 }],
            store: { slides: { info: new Map() } },
        },
    } as unknown as EditorDrawContext
    const draw = (size: number) =>
        renderer.draw(
            context,
            note(0, { size, left: 0, flickDirection: 'none', isCritical: false, isFake: false }),
            false,
        )
    return { renderer, canvases, draw, images: () => images }
}

test('dense unique note widths reuse cached artwork instead of allocating every frame', (t) => {
    const { renderer, canvases, draw, images } = artworkFixture(t)
    for (const timestamp of [1, 2, 3]) {
        renderer.beginFrame(timestamp)
        for (let i = 0; i < 600; i++) draw(1 + i / 1000)
        assert.equal(canvases.length, 512)
        assert.equal(images(), timestamp * 512)
    }

    // New notes scrolling into view replace previously unused cached artwork.
    renderer.beginFrame(4)
    for (let i = 0; i < 600; i++) draw(2 + i / 1000)
    assert.equal(canvases.length, 1024)
    assert.equal(images(), 4 * 512)
    assert.ok(canvases.slice(0, 512).every(({ width, height }) => width === 0 && height === 0))
    renderer.clear()
    assert.ok(canvases.every(({ width, height }) => width === 0 && height === 0))
})

test('artwork pixel budget remains bounded without repeated high-DPR cache misses', (t) => {
    const { renderer, canvases, draw } = artworkFixture(t, 160, 2)
    renderer.beginFrame(1)
    for (let i = 0; i < 100; i++) draw(3 + i / 1000)
    const initialCount = canvases.length
    assert.ok(initialCount > 0 && initialCount < 100)
    assert.ok(
        canvases.reduce((sum, { width, height }) => sum + width * height, 0) <= 4 * 1024 * 1024,
    )

    renderer.beginFrame(2)
    for (let i = 0; i < 100; i++) draw(3 + i / 1000)
    assert.equal(canvases.length, initialCount)

    // A creation layer in the same RAF must not displace chart-layer artwork.
    renderer.beginFrame(2)
    for (let i = 0; i < 100; i++) draw(4 + i / 1000)
    assert.equal(canvases.length, initialCount)
})
