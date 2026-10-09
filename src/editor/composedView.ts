import type { StageId } from '../chart/stages'
import { state } from '../history'
import type { State } from '../state'
import type { SlideId } from '../state/entities/slides'
import type { NoteEntity } from '../state/entities/slides/note'
import { createComposedLayout } from './composed'
import { view } from './view'

/** The chart remains in authoring coordinates; only this view projects it. */
export const getComposedLayout = (source: State = state.value) =>
    view.layout === 'composed' && source.isDynamicStages ? createComposedLayout(source) : undefined

export const getComposedOffset = (stageId: StageId, beat: number, source = state.value) =>
    getComposedLayout(source)?.offset(stageId, beat) ?? 0

export const getComposedGridOffset = (stageId: StageId, beat: number, source = state.value) =>
    getComposedLayout(source)?.gridOffset(stageId, beat) ?? 0

export const getComposedNoteOffset = (note: NoteEntity, beat = note.beat, source = state.value) => {
    const position = getComposedLayout(source)?.notePosition(note, beat)
    return position ? position.left - note.left : 0
}

const moveEndpoints = new WeakMap<
    ReadonlyMap<NoteEntity, number>,
    WeakMap<State, Map<SlideId, Set<NoteEntity>>>
>()

/** An attached note moved beyond its neighbors becomes an ordinary slide endpoint. */
export const getComposedMoveOffset = (
    note: NoteEntity,
    beat: number,
    source = state.value,
    destination = source,
    movingBeats?: ReadonlyMap<NoteEntity, number>,
) => {
    const layout = getComposedLayout(source)
    if (!layout) return 0
    if (!note.isAttached) return getComposedOffset(note.stageId, beat, destination)
    const notes = source.store.slides.note.get(note.slideId) ?? []
    let endpoint: boolean
    if (movingBeats) {
        let sources = moveEndpoints.get(movingBeats)
        if (!sources) moveEndpoints.set(movingBeats, (sources = new WeakMap()))
        let slides = sources.get(source)
        if (!slides) sources.set(source, (slides = new Map<SlideId, Set<NoteEntity>>()))
        let endpoints = slides.get(note.slideId)
        if (!endpoints) {
            let first = notes[0]
            let last = notes[0]
            const at = (note: NoteEntity) => movingBeats.get(note) ?? note.beat
            for (const other of notes) {
                if (!first || at(other) < at(first)) first = other
                if (!last || at(other) >= at(last)) last = other
            }
            endpoints = new Set([...(first ? [first] : []), ...(last ? [last] : [])])
            slides.set(note.slideId, endpoints)
        }
        endpoint = endpoints.has(note)
    } else {
        const first = notes[0] === note ? notes[1] : notes[0]
        const last = notes.at(-1) === note ? notes.at(-2) : notes.at(-1)
        // Equal beats retain the original stored order.
        endpoint =
            !first ||
            !last ||
            beat < first.beat ||
            beat > last.beat ||
            (notes[0] === note && beat === first.beat) ||
            (notes.at(-1) === note && beat === last.beat)
    }
    return endpoint
        ? getComposedOffset(note.stageId, beat, destination)
        : layout.notePosition(note, beat).left - note.left
}
