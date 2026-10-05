import assert from 'node:assert/strict'
import test from 'node:test'
import type { NoteObject } from '../../src/chart/note'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { noteFieldsOf } from '../../src/state/operations/properties/noteFields'

const note = (overrides: Partial<NoteObject>) =>
    ({
        noteType: 'default',
        isAttached: false,
        isFake: false,
        isConnectorSeparator: false,
        connectorType: 'active',
        ...overrides,
    }) as NoteEntity

// Infos as rebuildSlide derives them, without the attach and segment notes.
const slide = (notes: NoteEntity[], heads: Partial<Record<string, [number, number]>>) =>
    notes.map((n) => {
        const info: Record<string, NoteEntity | undefined> = { note: n }
        for (const [kind, [head, tail]] of Object.entries(heads) as [string, [number, number]][]) {
            info[`${kind}Head`] = notes[head]
            info[`${kind}Tail`] = notes[tail]
        }
        return info as unknown as Parameters<typeof noteFieldsOf>[1]
    })

test('slide flags apply only where a slide or damage segment starts', () => {
    const notes = [
        note({}),
        note({ connectorType: 'guide', isConnectorSeparator: true }),
        note({ connectorType: 'damage', isConnectorSeparator: true }),
        note({}),
    ]
    // The active run is recorded before the guide separator resets it.
    const infos = slide(notes, { active: [0, 1], damage: [2, 3] })
    const fields = infos.map((info) => noteFieldsOf(infos, info))
    assert.deepEqual(
        fields.map((f) => [f.connectorIsFake, f.connectorActiveIsCritical]),
        [
            [true, true],
            [false, false],
            [true, false],
            [false, false],
        ],
    )
})

test('a stale separator on the last note starts nothing', () => {
    const notes = [note({}), note({ isConnectorSeparator: true })]
    const infos = slide(notes, { active: [0, 1] })
    const last = noteFieldsOf(infos, infos[1]!)
    assert.equal(last.connectorIsFake, false)
    assert.equal(last.connectorActiveIsCritical, false)
    assert.equal(last.connectorType, false)
})

test('anchors and fake notes play no sound effect', () => {
    for (const [overrides, sfx] of [
        [{}, true],
        [{ noteType: 'anchor' }, false],
        [{ isFake: true }, false],
        [{ noteType: 'damage' }, true],
    ] as const) {
        const infos = slide([note(overrides)], {})
        assert.equal(noteFieldsOf(infos, infos[0]!).sfx, sfx)
    }
})
