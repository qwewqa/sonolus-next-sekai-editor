import type { NoteObject } from '../../../chart/note'
import type { SlideId } from '../../entities/slides'
import { toNoteEntity, type NoteEntity } from '../../entities/slides/note'
import { addToStoreGrid, removeFromStoreGrid } from '../../store/grid'
import type { Transaction } from '../../transaction'

export const addNote = ({ store }: Transaction, slideId: SlideId, object: NoteObject) => {
    const note = toNoteEntity(slideId, object)
    store.noteDrafts.add(note)
    addToStoreGrid(store.grid, note, note.beat)
    store.markDirty(slideId)

    return [note]
}

export const replaceNote = ({ store }: Transaction, note: NoteEntity, object: NoteObject) => {
    const newNote = toNoteEntity(note.slideId, object)
    store.noteDrafts.replace(note, newNote)
    removeFromStoreGrid(store.grid, note, note.beat)
    addToStoreGrid(store.grid, newNote, newNote.beat)
    store.markDirty(note.slideId)

    return [newNote]
}

export const removeNote = ({ store }: Transaction, note: NoteEntity) => {
    store.noteDrafts.remove(note)
    removeFromStoreGrid(store.grid, note, note.beat)
    store.markDirty(note.slideId)
}
