import type { NoteEntity } from './note'
import type { SlideNoteInfo } from './semantics'

// Transactions replace slide-info arrays, so each identity needs one index.
// Weak ownership lets discarded chart states release their indexes as well.
export const createSlideInfoLookup = () => {
    const lookups = new WeakMap<readonly SlideNoteInfo[], ReadonlyMap<NoteEntity, SlideNoteInfo>>()
    return (infos: readonly SlideNoteInfo[]) => {
        let lookup = lookups.get(infos)
        if (!lookup) {
            lookup = new Map(infos.map((info) => [info.note, info]))
            lookups.set(infos, lookup)
        }
        return lookup
    }
}
