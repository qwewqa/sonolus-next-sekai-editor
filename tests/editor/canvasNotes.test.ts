import assert from 'node:assert/strict'
import test from 'node:test'
import { getNoteVisualType } from '../../src/editor/canvas/notes'
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
