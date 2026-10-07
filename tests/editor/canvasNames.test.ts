import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
    blendOverChart,
    CHART_BACKGROUND,
    contrast,
    nameColorOn,
} from '../../src/editor/canvas/nameColors'
import {
    clearNameWidths,
    createNameLayer,
    placeNames,
    type NameFill,
} from '../../src/editor/canvas/names'
import { createNoteRenderer } from '../../src/editor/canvas/notes'
import type { EditorDrawContext } from '../../src/editor/canvas/types'
import type { Entity } from '../../src/state/entities'
import type { NoteEntity } from '../../src/state/entities/slides/note'

// Paths name themselves; a clip-out path names the path it carves.
class TestPath {
    static count = 0
    id = `p${TestPath.count++}`
    added?: TestPath
    rect() {}
    roundRect() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    addPath(path: TestPath) {
        this.added = path
    }
}

const installGlobal = (t: TestContext, name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
        if (original) Object.defineProperty(globalThis, name, original)
        else Reflect.deleteProperty(globalThis, name)
    })
}

// Records each fillText with its colour and the clips in force.
const recordingContext = (nameContrast = true) => {
    const texts: { text: string; color: string; clips: string[] }[] = []
    const stack: string[][] = []
    let clips: string[] = []
    const target: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif' }
    const ctx = new Proxy(target, {
        get(target, property) {
            if (property in target) return Reflect.get(target, property)
            switch (property) {
                case 'save':
                    return () => stack.push([...clips])
                case 'restore':
                    return () => (clips = stack.pop() ?? [])
                case 'clip':
                    return (path: TestPath, rule?: string) =>
                        clips.push(rule === 'evenodd' ? `out:${path.added?.id}` : `in:${path.id}`)
                // Every glyph is 0.5 em wide.
                case 'measureText':
                    return (text: string) => ({
                        width: text.length * 0.5 * parseFloat(target.font as string),
                    })
                case 'fillText':
                    return (text: string) =>
                        texts.push({ text, color: target.fillStyle as string, clips: [...clips] })
                default:
                    return () => {}
            }
        },
    }) as unknown as CanvasRenderingContext2D
    const context = {
        ctx,
        scale: 10,
        pixelRatio: 1,
        fontFamily: 'sans-serif',
        fontMiddle: 0.25,
        nameContrast,
    } as unknown as EditorDrawContext
    return { context, texts }
}

const fill = (owner: Entity | undefined, l: number, r: number, b: number, color: string) => {
    const path = new TestPath()
    const fill: NameFill = {
        owner,
        box: { l, r, t: -1, b },
        path: () => path as unknown as Path2D,
        colorsAt: () => [color],
    }
    return { fill, id: path.id }
}

test('names keep their colour on the chart background and darken on light note bodies', () => {
    assert.equal(nameColorOn('#f6f', [CHART_BACKGROUND]), '#f6f')
    assert.equal(nameColorOn('#0aa', [CHART_BACKGROUND]), '#0aa')
    // The dark pair on a light note body, darker steps where it falls short.
    assert.equal(nameColorOn('#f6f', ['#dafdf1']), '#a0a')
    assert.equal(nameColorOn('#0aa', ['#dafdf1']), '#077')
    assert.equal(nameColorOn('#f6f', ['#aabfff']), '#808')
    assert.equal(nameColorOn('#f6f', ['#999999']), '#404')
    for (const fill of ['#dafdf1', '#aabfff', '#999999', '#fed983']) {
        for (const color of ['#f6f', '#0aa'])
            assert.ok(contrast(nameColorOn(color, [fill]), fill) >= 4.5, `${color} on ${fill}`)
    }
    // Dark bodies keep the name's own colour.
    assert.equal(nameColorOn('#f6f', ['#a50acc']), '#f6f')
    assert.equal(nameColorOn('#0aa', ['#555555']), '#0aa')
    assert.equal(nameColorOn('#f6f', ['#222222']), '#f6f')
})

test('over connectors, names darken at most two steps and keep their hue', () => {
    const steps = { '#f6f': ['#f6f', '#a0a', '#808'], '#0aa': ['#0aa', '#077', '#055'] }
    // The first step reading as well as on the background...
    const active = blendOverChart('#7fffd3', 0.8)
    assert.equal(nameColorOn('#f6f', [active], true), '#808')
    assert.equal(nameColorOn('#0aa', [active], true), '#055')
    const critical = blendOverChart('#fbffdc', 0.8)
    assert.equal(nameColorOn('#f6f', [critical], true), '#a0a')
    // ...or the best of them, never darker or lighter.
    const guide = blendOverChart('#73d69d', 0.5)
    assert.equal(nameColorOn('#f6f', [guide], true), '#808')
    const damage = blendOverChart('#c764c7', 0.8)
    assert.equal(nameColorOn('#f6f', [damage], true), '#808')
    const black = blendOverChart('#000000', 0.5)
    assert.equal(nameColorOn('#f6f', [black], true), '#f6f')
    for (const fill of [active, critical, guide, damage, black, '#ffffff', '#6970bf']) {
        for (const [color, allowed] of Object.entries(steps))
            assert.ok(allowed.includes(nameColorOn(color, [fill], true)), `${color} on ${fill}`)
    }
})

test('a name splits only over its own note body and slide connectors, later fills on top', (t) => {
    installGlobal(t, 'Path2D', TestPath)
    const { context, texts } = recordingContext()
    const a = { type: 'note' } as Entity
    const b = { type: 'note' } as Entity
    const joint = { type: 'stagePivotEventJoint' } as Entity
    const connector = fill(undefined, -10, 10, 6, blendOverChart('#7fffd3', 0.8))
    const own = fill(a, -1, 1, 1, '#dafdf1')
    const other = fill(b, -1, 1, 1, '#dafdf1')
    const layer = createNameLayer()
    layer.fills.push(connector.fill, own.fill, other.fill)
    const name = { highlighted: false, size: 0.4, align: 'center' as const, alpha: 1, x: 0 }
    layer.names.push(
        { ...name, owner: a, text: 'Stage', y: 0, color: '#f6f' },
        // Over the connector only, then on the plain background.
        { ...name, owner: joint, text: 'Group', y: 5, color: '#0aa' },
        { ...name, owner: joint, text: 'Far', y: 20, color: '#f6f' },
    )
    placeNames(context, layer)
    assert.deepEqual(texts, [
        // Outside both fills in its own colour, never carving out another note's body.
        { text: 'Stage', color: '#f6f', clips: [`out:${connector.id}`, `out:${own.id}`] },
        { text: 'Stage', color: '#808', clips: [`in:${connector.id}`, `out:${own.id}`] },
        { text: 'Stage', color: '#a0a', clips: [`in:${own.id}`] },
        { text: 'Group', color: '#0aa', clips: [`out:${connector.id}`] },
        { text: 'Group', color: '#055', clips: [`in:${connector.id}`] },
        { text: 'Far', color: '#f6f', clips: [] },
    ])
})

const noteScene = (t: TestContext, nameContrast = true) => {
    installGlobal(t, 'Path2D', TestPath)
    const { context, texts } = recordingContext(nameContrast)
    installGlobal(t, 'document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => context.ctx }),
    })
    Object.assign(context, {
        ups: -2,
        recentlyActive: false,
        showStageName: true,
        showGroupName: false,
        state: {
            bpms: [{ x: 0, y: 0, s: 0.5 }],
            store: { slides: { info: new Map() } },
            isDynamicStages: true,
            stages: new Map([[2, { name: 'Side stage' }]]),
        },
    })
    const note = (properties: Partial<NoteEntity>) =>
        ({
            type: 'note',
            beat: 0,
            noteType: 'default',
            connectorType: 'active',
            isConnectorSeparator: false,
            size: 2,
            left: 1,
            noteStyle: 'default',
            flickDirection: 'none',
            isCritical: false,
            isFake: false,
            stageId: 2,
            ...properties,
        }) as NoteEntity
    return { context, texts, note, renderer: createNoteRenderer() }
}

test('a note gives its names one fill for its whole body, in the colours under them', (t) => {
    const { context, note, renderer } = noteScene(t)
    const fills = (entity: NoteEntity, highlighted = true, opacity = 1) => {
        const names = createNameLayer()
        renderer.draw({ ...context, names }, entity, highlighted, opacity)
        return names.fills.map(({ owner, box, colorsAt }) => ({
            own: owner === entity,
            box: Object.values(box).map((v) => Math.round(v * 100) / 100),
            colors: colorsAt(0),
        }))
    }
    // A single note's inner body, across its whole outline.
    assert.deepEqual(fills(note({})), [{ own: true, box: [1, 3, -0.3, 0.3], colors: ['#e6edff'] }])
    // A trace's box and diamond, and a dimmed note's colours as seen.
    assert.deepEqual(fills(note({ noteType: 'trace' })), [
        { own: true, box: [1, 3, -0.3, 0.15], colors: ['#5fefc2', '#abfbe3'] },
    ])
    assert.deepEqual(fills(note({ noteType: 'damage', size: 0 }), true, 0.5), [
        { own: true, box: [0.9, 1.1, -0.15, 0.15], colors: [blendOverChart('#a50acc', 0.5)] },
    ])
    // Anchors have no body, and notes without names add nothing.
    assert.deepEqual(fills(note({ noteType: 'anchor' })), [])
    assert.deepEqual(fills(note({}), false), [])
})

test('without name contrast, names draw once in their own colours', (t) => {
    const { context, texts, note, renderer } = noteScene(t, false)
    // Notes mark no fills, whether names are collected or drawn at once.
    const names = createNameLayer()
    renderer.draw({ ...context, names }, note({}), true, 1)
    assert.deepEqual(names.fills, [])
    placeNames(context, names)
    renderer.draw(context, note({ noteType: 'trace', beat: 4 }), true, 1)
    // Fills already collected are ignored.
    const layer = createNameLayer()
    const owner = { type: 'note' } as Entity
    layer.fills.push(
        fill(undefined, -10, 10, 6, blendOverChart('#7fffd3', 0.8)).fill,
        fill(owner, -1, 1, 1, '#dafdf1').fill,
    )
    layer.names.push({
        owner,
        highlighted: false,
        text: 'Group',
        x: 0,
        y: 0,
        color: '#0aa',
        size: 0.4,
        align: 'center',
        alpha: 1,
    })
    placeNames(context, layer)
    assert.deepEqual(texts, [
        { text: 'Side stage', color: '#a0a', clips: [] },
        { text: 'Side stage', color: '#a0a', clips: [] },
        { text: 'Group', color: '#0aa', clips: [] },
    ])
})

for (const nameContrast of [true, false])
    test(`names are measured once per font and zoom, and again after a font loads (contrast ${nameContrast ? 'on' : 'off'})`, () => {
        const { context } = recordingContext(nameContrast)
        let measured = 0
        const measureText = context.ctx.measureText.bind(context.ctx)
        Object.defineProperty(context.ctx, 'measureText', {
            value: (text: string) => {
                measured++
                return measureText(text)
            },
        })
        const owner = { type: 'note' } as Entity
        const frame = (scale: number) => {
            const layer = createNameLayer()
            for (const [index, text] of ['Stage', 'Group', 'Stage'].entries())
                layer.names.push({
                    owner,
                    highlighted: false,
                    text,
                    x: index * 10,
                    y: 0,
                    color: '#f6f',
                    size: 0.4,
                    align: 'center',
                    alpha: 1,
                })
            placeNames({ ...context, scale }, layer)
        }
        clearNameWidths()
        frame(10)
        frame(10)
        assert.equal(measured, 2)
        frame(20)
        assert.equal(measured, 4)
        clearNameWidths()
        frame(20)
        assert.equal(measured, 6)
    })
