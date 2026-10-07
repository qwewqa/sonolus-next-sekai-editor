import type { State } from '..'
import type { Entity } from '../entities'
import type { NoteEntity } from '../entities/slides/note'
import type { EditableEntity, EditableProperties } from './editable'
import { isWithinGridBudget } from './scaleValues'

// Notes only; other selected objects stay put.
export const getMakeVerticalChanges = (selected: Entity[], source?: State) => {
    const notes = [
        ...new Set(selected.filter((entity): entity is NoteEntity => entity.type === 'note')),
    ]
    if (!notes.length) return
    let beat = Infinity
    for (const note of notes) beat = Math.min(beat, note.beat)
    if (!Number.isFinite(beat) || !Number.isSafeInteger(Math.floor(beat))) return
    if (notes.every((note) => note.beat === beat)) return
    const changes = new Map<EditableEntity, EditableProperties>()
    for (const note of notes) {
        if (!Number.isFinite(note.beat)) return
        const elevation = note.beat - beat
        if (!Number.isFinite(elevation)) return
        changes.set(note, { beat, elevation, isAttached: false })
    }
    if (source && !isWithinGridBudget(source, new Map(notes.map((note) => [note, beat])))) return
    return changes
}
export const canMakeVertical = (selected: Entity[], source?: State) =>
    getMakeVerticalChanges(selected, source) !== undefined
