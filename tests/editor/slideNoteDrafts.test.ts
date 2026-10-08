import assert from 'node:assert/strict'
import test from 'node:test'
import { createSlideId } from '../../src/state/entities/slides'
import type { NoteEntity } from '../../src/state/entities/slides/note'
import { createSlideNoteDrafts } from '../../src/state/store/slideNoteDrafts'

const slideId = createSlideId()
const otherSlideId = createSlideId()
const note = (beat: number, left = 0, id = slideId) =>
    Object.freeze({ type: 'note', slideId: id, beat, left }) as NoteEntity

test('mixed edits preserve stored slots and leave source arrays intact', () => {
    const first = note(4, 1)
    const second = note(4, 2)
    const third = note(8, 3)
    const source = [first, second, third]
    Object.freeze(source)
    const unrelated = [note(1, 0, otherSlideId)]
    const map = new Map([
        [slideId, source],
        [otherSlideId, unrelated],
    ])
    const drafts = createSlideNoteDrafts(() => map)
    const replacement = note(4, 10)
    const finalReplacement = note(4, 11)
    const added = note(4, 12)
    drafts.replace(first, replacement)
    drafts.add(added)
    drafts.replace(replacement, finalReplacement)
    drafts.remove(third)
    drafts.flush()
    assert.deepEqual(map.get(slideId), [finalReplacement, second, added])
    assert.notEqual(map.get(slideId), source)
    assert.deepEqual(source, [first, second, third])
    assert.equal(map.get(otherSlideId), unrelated)
    const materialized = map.get(slideId)
    drafts.flush()
    assert.equal(map.get(slideId), materialized)
    drafts.remove(added)
    drafts.flush()
    assert.deepEqual(map.get(slideId), [finalReplacement, second])
})

test('removing all notes and recreating a slide preserves map insertion semantics', () => {
    const first = note(0)
    const second = note(1)
    const source = [first, second]
    const map = new Map([
        [slideId, source],
        [otherSlideId, [note(2, 0, otherSlideId)]],
    ])
    const drafts = createSlideNoteDrafts(() => map)
    drafts.remove(first)
    drafts.remove(second)
    assert.equal(map.has(slideId), false)
    const added = note(3)
    drafts.add(added)
    drafts.flush()
    assert.deepEqual([...map.keys()], [otherSlideId, slideId])
    assert.deepEqual(map.get(slideId), [added])
    assert.deepEqual(source, [first, second])
})

test('read materialization can be followed by more edits without mutating that array', () => {
    const first = note(0)
    const map = new Map([[slideId, [first]]])
    const drafts = createSlideNoteDrafts(() => map)
    const second = note(0, 1)
    drafts.replace(first, second)
    drafts.flush()
    const read = map.get(slideId)!
    Object.freeze(read)
    const third = note(0, 2)
    drafts.replace(second, third)
    drafts.flush()
    assert.deepEqual(read, [second])
    assert.deepEqual(map.get(slideId), [third])
})

test('reset reacquires canonical rebuilt notes and detaches the next published array', () => {
    const first = note(1)
    const source = [first]
    let map = new Map([[slideId, source]])
    const drafts = createSlideNoteDrafts(() => map)
    const replacement = note(1, 1)
    drafts.replace(first, replacement)
    drafts.prepare(slideId)
    const published = map.get(slideId)!
    const canonical = note(1, 2)
    // Attachment rebuilding can replace a staged note before publication.
    published[0] = canonical
    drafts.reset()
    Object.freeze(published)
    map = new Map(map)
    const next = note(1, 3)
    drafts.replace(canonical, next)
    drafts.prepare(slideId)
    assert.deepEqual(source, [first])
    assert.deepEqual(published, [canonical])
    assert.deepEqual(map.get(slideId), [next])
})

test('prepare detaches arrays before rebuilding a slide without explicit note edits', () => {
    const first = note(4)
    const second = note(2)
    const source = [first, second]
    Object.freeze(source)
    const map = new Map([[slideId, source]])
    const drafts = createSlideNoteDrafts(() => map)
    drafts.prepare(slideId)
    const owned = map.get(slideId)!
    owned.sort((a, b) => a.beat - b.beat)
    assert.deepEqual(source, [first, second])
    assert.deepEqual(owned, [second, first])
    drafts.prepare(slideId)
    assert.equal(map.get(slideId), owned)
    drafts.reset()
    drafts.prepare(slideId)
    assert.notEqual(map.get(slideId), owned)
})

test('direct note-map writes supersede pending drafts', () => {
    const first = note(1)
    const map = new Map([[slideId, [first]]])
    const drafts = createSlideNoteDrafts(() => map)
    drafts.replace(first, note(1, 1))
    const direct = note(1, 2)
    map.set(slideId, [direct])
    drafts.flush()
    assert.deepEqual(map.get(slideId), [direct])
    const next = note(1, 3)
    drafts.replace(direct, next)
    drafts.flush()
    assert.deepEqual(map.get(slideId), [next])
    drafts.add(note(2))
    map.delete(slideId)
    drafts.flush()
    assert.equal(map.has(slideId), false)
})

test('stale replacements and removals fail without corrupting another note', () => {
    const first = note(1)
    const map = new Map([[slideId, [first]]])
    const drafts = createSlideNoteDrafts(() => map)
    const replacement = note(1, 1)
    drafts.replace(first, replacement)
    assert.throws(() => drafts.replace(first, note(1, 2)), /Unexpected note not found/)
    assert.throws(() => drafts.remove(first), /Unexpected note not found/)
    assert.throws(
        () => drafts.replace(replacement, note(1, 0, otherSlideId)),
        /Unexpected replacement slide/,
    )
    drafts.flush()
    assert.deepEqual(map.get(slideId), [replacement])
})

test('large replacement, forward deletion and addition batches retain order', () => {
    const source = Array.from({ length: 10000 }, (_, i) => note(Math.floor(i / 2), i))
    Object.freeze(source)
    const map = new Map([[slideId, source]])
    const drafts = createSlideNoteDrafts(() => map)
    const replacements = source.map((original) => note(original.beat, original.left + 1))
    for (let i = 0; i < source.length; i++) drafts.replace(source[i]!, replacements[i]!)
    // No intermediate array has been materialized during the mutation batch.
    assert.equal(map.get(slideId), source)
    drafts.flush()
    assert.deepEqual(map.get(slideId), replacements)
    for (const replacement of replacements) drafts.remove(replacement)
    assert.equal(map.has(slideId), false)
    for (const original of source) drafts.add(original)
    drafts.flush()
    assert.deepEqual(map.get(slideId), source)
    assert.notEqual(map.get(slideId), source)
})

test('retained note-map views and live iterators observe staged edits', () => {
    const first = note(0)
    const other = note(1, 0, otherSlideId)
    const map = new Map([
        [slideId, [first]],
        [otherSlideId, [other]],
    ])
    const drafts = createSlideNoteDrafts(() => map)
    const view = drafts.readMap()
    assert.equal(drafts.readMap(), view)
    const replacement = note(0, 1)
    drafts.replace(first, replacement)
    assert.deepEqual(view.get(slideId), [replacement])
    const iterator = view.values()
    assert.deepEqual(iterator.next().value, [replacement])
    const replacedOther = note(1, 1, otherSlideId)
    drafts.replace(other, replacedOther)
    assert.deepEqual(iterator.next().value, [replacedOther])
    drafts.remove(replacement)
    assert.equal(view.has(slideId), false)
    drafts.add(note(2))
    assert.equal(view.size, 2)
})

test('note-map forEach sees mutations staged by its callback', () => {
    const first = note(0)
    const other = note(1, 0, otherSlideId)
    const map = new Map([
        [slideId, [first]],
        [otherSlideId, [other]],
    ])
    const drafts = createSlideNoteDrafts(() => map)
    const replacement = note(1, 1, otherSlideId)
    const visited: NoteEntity[][] = []
    drafts.readMap().forEach((notes, id) => {
        visited.push(notes)
        if (id === slideId) drafts.replace(other, replacement)
    })
    assert.deepEqual(visited, [[first], [replacement]])
})

test('retained views stay on their published map after a transaction checkpoint', () => {
    const first = note(0)
    let map = new Map([[slideId, [first]]])
    const drafts = createSlideNoteDrafts(() => map)
    const replacement = note(0, 1)
    drafts.replace(first, replacement)
    drafts.prepare(slideId)
    const previousView = drafts.readMap()
    const published = map.get(slideId)!
    drafts.reset()
    Object.freeze(published)
    map = new Map(map)
    const next = note(0, 2)
    drafts.replace(replacement, next)
    assert.deepEqual(previousView.get(slideId), [replacement])
    assert.deepEqual(drafts.readMap().get(slideId), [next])
    assert.deepEqual(published, [replacement])
})

test('clean reads do not revisit every slide draft in a many-slide transaction', () => {
    const map = new Map<ReturnType<typeof createSlideId>, NoteEntity[]>()
    let mapReads = 0
    const drafts = createSlideNoteDrafts(() => {
        mapReads++
        return map
    })
    for (let i = 0; i < 1000; i++) drafts.add(note(i, 0, createSlideId()))
    const view = drafts.readMap()
    assert.equal(view.size, 1000)
    const afterMaterializing = mapReads
    for (const id of map.keys()) {
        drafts.flush()
        assert.equal(view.get(id)!.length, 1)
    }
    // Repeated public reads during rebuilding must not turn S slide edits into
    // S squared backing-map lookups after the pending batch has been flushed.
    assert.equal(mapReads, afterMaterializing)
})

test('in-place changes to exposed note arrays survive subsequent staged edits', () => {
    const first = note(4, 1)
    const second = note(4, 2)
    const third = note(8, 3)
    const map = new Map([[slideId, [first, second, third]]])
    const drafts = createSlideNoteDrafts(() => map)
    const view = drafts.readMap()
    const replacement = note(4, 10)
    drafts.replace(first, replacement)
    const exposed = view.get(slideId)!
    const added = note(4, 20)
    exposed.push(added)
    exposed.reverse()
    drafts.remove(second)
    const final = note(4, 30)
    drafts.replace(added, final)
    assert.deepEqual(view.get(slideId), [final, third, replacement])
    assert.deepEqual(exposed, [added, third, second, replacement])
})

test('old exposed array references become snapshots after another staged edit', () => {
    const first = note(0)
    const second = note(1)
    const map = new Map([[slideId, [first, second]]])
    const drafts = createSlideNoteDrafts(() => map)
    const view = drafts.readMap()
    const exposed = view.get(slideId)!
    const replacement = note(0, 1)
    drafts.replace(first, replacement)
    exposed.push(note(2))
    drafts.remove(second)
    assert.deepEqual(view.get(slideId), [replacement])
    assert.deepEqual(exposed.slice(0, 2), [first, second])
})

test('array edits during live iteration are incorporated before later mutations', () => {
    const first = note(0)
    const second = note(1)
    const map = new Map([
        [slideId, [first]],
        [otherSlideId, [note(2, 0, otherSlideId)]],
    ])
    const drafts = createSlideNoteDrafts(() => map)
    const view = drafts.readMap()
    view.forEach((notes, id) => {
        if (id !== slideId) return
        notes.push(second)
        drafts.remove(first)
        notes.push(note(3))
    })
    assert.deepEqual(view.get(slideId), [second])
    const iterator = view.values()
    const exposed = iterator.next().value!
    const replacement = note(1, 1)
    exposed[0] = replacement
    drafts.remove(replacement)
    assert.equal(view.has(slideId), false)
})

for (const rejected of ['replace missing', 'remove missing', 'replace slide mismatch'])
    test(`exposed arrays remain live after a rejected ${rejected} edit`, () => {
        const first = note(0)
        const second = note(1)
        const map = new Map([[slideId, [first, second]]])
        const drafts = createSlideNoteDrafts(() => map)
        const view = drafts.readMap()
        const exposed = view.get(slideId)!
        if (rejected === 'replace missing')
            assert.throws(() => drafts.replace(note(2), note(2, 1)), /Unexpected note not found/)
        else if (rejected === 'remove missing')
            assert.throws(() => drafts.remove(note(2)), /Unexpected note not found/)
        else
            assert.throws(
                () => drafts.replace(first, note(0, 1, otherSlideId)),
                /Unexpected replacement slide/,
            )
        assert.equal(map.get(slideId), exposed)
        const added = note(2)
        exposed.push(added)
        exposed.reverse()
        drafts.remove(second)
        assert.deepEqual(view.get(slideId), [added, first])
        assert.deepEqual(exposed, [added, second, first])
    })
