import type { NoteEntity } from '../../state/entities/slides/note'
import { sameBeat } from './layout'

export const getNotesAtBeat = (grid: Map<number, Set<NoteEntity>>, beat: number) => {
    if (!Number.isFinite(beat)) return []
    const notes = new Set<NoteEntity>()
    for (const key of new Set([Math.floor(beat - 1e-7), Math.floor(beat + 1e-7)])) {
        for (const note of grid.get(key) ?? []) {
            if (sameBeat(note.beat, beat)) notes.add(note)
        }
    }
    return [...notes]
}
