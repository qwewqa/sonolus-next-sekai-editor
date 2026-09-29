import assert from 'node:assert/strict'
import test from 'node:test'
import { createSlideInfoLookup } from '../../src/state/entities/slides/lookup'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { getActiveNoteRole, type SlideNoteInfo } from '../../src/state/entities/slides/semantics'

test('repeated audio and Canvas lookups scan each immutable slide once and preserve its note roles', () => {
    const head = { beat: 0 } as NoteEntity
    const tail = { beat: 1000 } as NoteEntity
    const originals = Array.from({ length: 1001 }, (_, beat) => ({
        note: beat === 0 ? head : beat === 1000 ? tail : ({ beat } as NoteEntity),
        activeHead: head,
        activeTail: tail,
    }))
    let visits = 0
    const infos: readonly SlideNoteInfo[] = new Proxy(originals, {
        get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) visits++
            return Reflect.get(target, key, receiver)
        },
    })
    const getLookup = createSlideInfoLookup()
    const index = getLookup(infos)
    assert.equal(visits, originals.length)
    for (let pass = 0; pass < 10; pass++) {
        assert.equal(getLookup(infos), index)
        for (const original of originals) {
            const info = getLookup(infos).get(original.note)
            assert.equal(info, original)
            assert.equal(getActiveNoteRole(info!), getActiveNoteRole(original))
        }
    }
    assert.equal(visits, originals.length)
    assert.equal(index.get({ ...head }), undefined)
})

test('a replaced slide gets a new index while retained history keeps its original roles', () => {
    const head = { beat: 0 } as NoteEntity
    const tail = { beat: 1 } as NoteEntity
    const infos = [
        { note: head, activeHead: head, activeTail: tail },
        { note: tail, activeHead: head, activeTail: tail },
    ]
    const getLookup = createSlideInfoLookup()
    const original = getLookup(infos)
    const replacement = [{ note: head, activeHead: head, activeTail: head }]
    const updated = getLookup(replacement)
    assert.notEqual(updated, original)
    assert.equal(getActiveNoteRole(updated.get(head)!), 'single')
    assert.equal(updated.get(tail), undefined)
    assert.equal(getLookup(infos), original)
    assert.equal(getActiveNoteRole(original.get(head)!), 'head')
    assert.equal(getActiveNoteRole(original.get(tail)!), 'tail')
})
