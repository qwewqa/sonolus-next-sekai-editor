import type { SlideId } from '../entities/slides'
import type { NoteEntity } from '../entities/slides/note'
import { createFlushingMap } from './flushingMap'
import type { StoreSlides } from './slides'

type Draft = {
    observed: NoteEntity[]
    slots: Map<NoteEntity, NoteEntity>
    lookup: Map<NoteEntity, NoteEntity>
    detached: boolean
}

// A replacement keeps its slot, including among equal-beat notes. Deleting a
// slot does not shift the others, so forward deletion and replacement batches
// both stay linear. Arrays are materialized only for reads and slide rebuilding.
export const createSlideNoteDrafts = (getMap: () => StoreSlides['note']) => {
    const drafts = new Map<SlideId, Draft>()
    const pending = new Set<SlideId>()
    const views = new WeakMap<StoreSlides['note'], StoreSlides['note']>()
    let ownedArrays = new WeakSet<NoteEntity[]>()
    let arraysExposed = false

    const getDraft = (slideId: SlideId, create = false) => {
        const map = getMap()
        let notes = map.get(slideId)
        let detached = !arraysExposed
        let draft = drafts.get(slideId)
        // Direct writes to the public note map supersede a previously staged edit.
        if (draft && draft.observed !== notes) {
            drafts.delete(slideId)
            pending.delete(slideId)
            draft = undefined
        }
        // A rejected edit can leave an undetached draft while its exposed array
        // is still mutable. Reacquire that array instead of reusing stale slots.
        if (draft?.detached) return draft
        if (!notes) {
            if (!create) throw new Error('Unexpected notes not found')
            notes = []
            map.set(slideId, notes)
            ownedArrays.add(notes)
            detached = true
        }
        const slots = new Map(notes.map((note) => [note, note]))
        draft = { observed: notes, slots, lookup: new Map(slots), detached }
        drafts.set(slideId, draft)
        return draft
    }

    const detach = (slideId: SlideId, draft: Draft) => {
        if (draft.detached) return
        // A caller may retain and mutate an array returned by the transaction
        // view. After its next edit, that reference must remain an old snapshot,
        // just as it did when each mutation eagerly replaced the note array.
        const notes = [...draft.observed]
        getMap().set(slideId, notes)
        ownedArrays.add(notes)
        draft.observed = notes
        draft.detached = true
    }

    const flush = (slideId: SlideId, draft: Draft) => {
        if (!pending.delete(slideId)) return
        const map = getMap()
        if (map.get(slideId) !== draft.observed) {
            drafts.delete(slideId)
            return
        }
        const notes = [...draft.slots.values()]
        map.set(slideId, notes)
        ownedArrays.add(notes)
        draft.observed = notes
    }

    const flushAll = () => {
        for (const slideId of pending) {
            const draft = drafts.get(slideId)
            if (draft) flush(slideId, draft)
        }
    }

    const flushForRead = () => {
        flushAll()
        // Public values are mutable arrays. Reacquire their actual contents on
        // the next edit instead of trusting indexes built before an exposure.
        drafts.clear()
        arraysExposed = true
    }

    return {
        add(note: NoteEntity) {
            const draft = getDraft(note.slideId, true)
            detach(note.slideId, draft)
            draft.slots.set(note, note)
            draft.lookup.set(note, note)
            pending.add(note.slideId)
        },

        replace(note: NoteEntity, replacement: NoteEntity) {
            const draft = getDraft(note.slideId)
            const slot = draft.lookup.get(note)
            if (!slot) throw new Error('Unexpected note not found')
            if (replacement.slideId !== note.slideId)
                throw new Error('Unexpected replacement slide')
            detach(note.slideId, draft)
            draft.slots.set(slot, replacement)
            draft.lookup.delete(note)
            draft.lookup.set(replacement, slot)
            pending.add(note.slideId)
        },

        remove(note: NoteEntity) {
            const draft = getDraft(note.slideId)
            const slot = draft.lookup.get(note)
            if (!slot) throw new Error('Unexpected note not found')
            detach(note.slideId, draft)
            draft.slots.delete(slot)
            draft.lookup.delete(note)
            pending.add(note.slideId)
            if (draft.slots.size) return
            // Delete immediately: removing and recreating a slide must move its
            // map entry to the end, just as the unbatched mutations did.
            getMap().delete(note.slideId)
            drafts.delete(note.slideId)
            pending.delete(note.slideId)
        },

        flush: flushAll,

        readMap() {
            const map = getMap()
            let view = views.get(map)
            if (!view) {
                view = createFlushingMap(map, flushForRead)
                views.set(map, view)
            }
            return view
        },

        prepare(slideId: SlideId) {
            const draft = drafts.get(slideId)
            if (draft) flush(slideId, draft)
            const map = getMap()
            const notes = map.get(slideId)
            if (!notes || ownedArrays.has(notes)) return
            // Rebuilding sorts and may replace attached notes in place, even
            // when a slide was dirtied without an explicit note mutation.
            const owned = [...notes]
            map.set(slideId, owned)
            ownedArrays.add(owned)
        },

        reset() {
            // Published arrays and rebuilt note identities are now canonical.
            // A reused transaction must acquire fresh drafts from those arrays.
            drafts.clear()
            pending.clear()
            ownedArrays = new WeakSet()
            arraysExposed = false
        },
    }
}
