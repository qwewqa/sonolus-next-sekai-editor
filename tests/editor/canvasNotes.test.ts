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
    const draw = (size: number, noteStyle: NoteEntity['noteStyle'] = 'default') =>
        renderer.draw(
            context,
            note(0, {
                size,
                noteStyle,
                left: 0,
                flickDirection: 'none',
                isCritical: false,
                isFake: false,
            }),
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

test('cached note artwork distinguishes color overrides', (t) => {
    const { renderer, canvases, draw } = artworkFixture(t)
    renderer.beginFrame(1)
    draw(2, 'red')
    draw(2, 'blue')
    draw(2, 'default')
    assert.equal(canvases.length, 3)
    draw(2, 'red')
    assert.equal(canvases.length, 3)
})

test("a zero-width fake note's X spans its placeholder box", (t) => {
    // Each red stroke's points, in note units.
    const crosses: [number, number][][] = []
    const makeCanvasContext = () => {
        let path: [number, number][] = []
        const target: Record<string, unknown> = { globalAlpha: 1 }
        return new Proxy(target, {
            get(target, property) {
                if (property in target) return Reflect.get(target, property)
                if (property === 'beginPath') return () => (path = [])
                if (property === 'moveTo' || property === 'lineTo')
                    return (x: number, y: number) => path.push([x, y])
                if (property === 'stroke')
                    return () => {
                        if (target.strokeStyle === '#f44') crosses.push(path)
                    }
                return () => {}
            },
        }) as unknown as CanvasRenderingContext2D
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: () => ({ width: 0, height: 0, getContext: makeCanvasContext }),
        },
    })
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'document', original)
        else Reflect.deleteProperty(globalThis, 'document')
    })
    const renderer = createNoteRenderer()
    const context = {
        ctx: makeCanvasContext(),
        scale: 40,
        pixelRatio: 1,
        ups: -2,
        recentlyActive: false,
        state: { bpms: [{ x: 0, y: 0, s: 0.5 }], store: { slides: { info: new Map() } } },
    } as unknown as EditorDrawContext
    const extents = (noteType: NoteEntity['noteType'], size: number) => {
        crosses.length = 0
        renderer.draw(
            context,
            note(0, {
                noteType,
                size,
                left: 0,
                noteStyle: 'default',
                flickDirection: 'none',
                isCritical: false,
                isFake: true,
            }),
            false,
        )
        const points = crosses.flat()
        const xs = points.map(([x]) => x)
        const ys = points.map(([, y]) => y)
        return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    }
    // Over the 0.2-wide placeholder, at the body's own height.
    assert.deepEqual(extents('default', 0), [-0.1, 0.1, 0, 0.6])
    assert.deepEqual(extents('trace', 0), [-0.1, 0.1, 0.15, 0.45])
    // Sized notes keep their X.
    assert.deepEqual(extents('default', 2), [0, 2, 0, 0.6])
})

test("a note's stage and group names keep a gap between them", (t) => {
    const labels: { text: string; x: number; align: string; color: string }[] = []
    const makeCanvasContext = () => {
        let x = 0
        const target: Record<string, unknown> = { globalAlpha: 1 }
        return new Proxy(target, {
            get(target, property) {
                if (property in target) return Reflect.get(target, property)
                if (property === 'translate') return (dx: number) => (x = dx)
                if (property === 'fillText')
                    return (text: string) =>
                        labels.push({
                            text,
                            x,
                            align: target.textAlign as string,
                            color: target.fillStyle as string,
                        })
                if (property === 'measureText') return () => ({ width: 0 })
                return () => {}
            },
        }) as unknown as CanvasRenderingContext2D
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: () => ({ width: 0, height: 0, getContext: makeCanvasContext }),
        },
    })
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'document', original)
        else Reflect.deleteProperty(globalThis, 'document')
    })
    const context = {
        ctx: makeCanvasContext(),
        scale: 40,
        pixelRatio: 1,
        bounds: { l: -12, r: 12, t: -10, b: 10, w: 24, h: 20 },
        ups: -2,
        recentlyActive: false,
        showStageName: true,
        showGroupName: true,
        defaultGroupId: 1,
        state: {
            bpms: [{ x: 0, y: 0, s: 0.5 }],
            store: { slides: { info: new Map() } },
            isDynamicStages: true,
            stages: new Map([[2, { name: 'Side stage' }]]),
            groups: new Map([[2, { name: 'Other group' }]]),
        },
    } as unknown as EditorDrawContext
    const entity = note(0, {
        size: 2,
        left: 0,
        noteStyle: 'default',
        flickDirection: 'none',
        isCritical: false,
        isFake: false,
        stageId: 2 as never,
        groupId: 2 as never,
    })
    createNoteRenderer().draw(context, entity, true)
    // Centred on the note's middle (lane 1), 0.1 lane apart each; the stage's
    // magenta and the group's cyan both read on the chart background.
    assert.deepEqual(
        labels.map(({ text, x, align, color }) => [text, Math.round(x * 100) / 100, align, color]),
        [
            ['Side stage', 0.9, 'end', '#a0a'],
            ['Other group', 1.1, 'start', '#0aa'],
        ],
    )
})

test('a zero-width tick shows a flat placeholder in its colour, under any fake X', (t) => {
    // Filled boxes and red strokes, in drawing order.
    const marks: (
        { fill: [number, number, number, number]; color: string } | { cross: [number, number][] }
    )[] = []
    const makeCanvasContext = () => {
        let rect: [number, number, number, number] | undefined
        let path: [number, number][] = []
        const target: Record<string, unknown> = { globalAlpha: 1 }
        return new Proxy(target, {
            get(target, property) {
                if (property in target) return Reflect.get(target, property)
                if (property === 'beginPath') return () => ((rect = undefined), (path = []))
                if (property === 'roundRect')
                    return (x: number, y: number, w: number, h: number) => (rect = [x, y, w, h])
                if (property === 'moveTo' || property === 'lineTo')
                    return (x: number, y: number) => path.push([x, y])
                if (property === 'fill')
                    return () => {
                        if (rect) marks.push({ fill: rect, color: target.fillStyle as string })
                    }
                if (property === 'stroke')
                    return () => {
                        if (target.strokeStyle === '#f44') marks.push({ cross: path })
                    }
                return () => {}
            },
        }) as unknown as CanvasRenderingContext2D
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            createElement: () => ({ width: 0, height: 0, getContext: makeCanvasContext }),
        },
    })
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'document', original)
        else Reflect.deleteProperty(globalThis, 'document')
    })
    const renderer = createNoteRenderer()
    const context = {
        ctx: makeCanvasContext(),
        scale: 40,
        pixelRatio: 1,
        ups: -2,
        recentlyActive: false,
        state: { bpms: [{ x: 0, y: 0, s: 0.5 }], store: { slides: { info: new Map() } } },
    } as unknown as EditorDrawContext
    const draw = (properties: Partial<NoteEntity>) => {
        marks.length = 0
        renderer.draw(
            context,
            note(0, {
                noteType: 'forceTick',
                size: 0,
                left: 0,
                noteStyle: 'default',
                flickDirection: 'none',
                isCritical: false,
                isFake: false,
                ...properties,
            }),
            false,
        )
        return marks.map((mark) =>
            'fill' in mark
                ? ['fill', ...mark.fill.map((v) => Math.round(v * 100) / 100), mark.color]
                : ['cross', ...mark.cross.flat()],
        )
    }
    // The 0.2-wide flat box of trace and damage, in the diamond's colour.
    assert.deepEqual(draw({}), [['fill', -0.1, 0.15, 0.2, 0.3, '#abfbe3']])
    assert.deepEqual(draw({ isCritical: true }), [['fill', -0.1, 0.15, 0.2, 0.3, '#fff2c3']])
    // A fake one's X lies over the box.
    assert.deepEqual(draw({ isFake: true }), [
        ['fill', -0.1, 0.15, 0.2, 0.3, '#abfbe3'],
        ['cross', -0.1, 0.15, 0.1, 0.45],
        ['cross', -0.1, 0.45, 0.1, 0.15],
    ])
    // Anchors stay invisible until outlined.
    assert.deepEqual(draw({ noteType: 'anchor' }), [])
})
