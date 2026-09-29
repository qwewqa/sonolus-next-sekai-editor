import type { NoteEntity } from './note'

export type SlideNoteInfo = {
    note: NoteEntity
    activeHead?: NoteEntity
    activeTail?: NoteEntity
}

export type ActiveNoteRole = 'single' | 'head' | 'tail' | 'middle'

export type NoteRole =
    'anchor' | 'damage' | 'trace' | 'headTrace' | 'tailTrace' | 'tick' | 'single' | 'head' | 'tail'

export const getActiveNoteRole = (info: SlideNoteInfo): ActiveNoteRole => {
    if (info.activeHead === info.activeTail) return 'single'
    if (info.activeHead === info.note) return 'head'
    if (info.activeTail === info.note) return 'tail'
    return 'middle'
}

export const getNoteRole = (info: SlideNoteInfo): NoteRole => {
    switch (info.note.noteType) {
        case 'anchor':
            return 'anchor'
        case 'damage':
            return 'damage'
        case 'forceTick':
            return 'tick'
        case 'trace': {
            const activeRole = getActiveNoteRole(info)
            return activeRole === 'head'
                ? 'headTrace'
                : activeRole === 'tail'
                  ? 'tailTrace'
                  : 'trace'
        }
        case 'default':
        case 'forceNonTick': {
            const activeRole = getActiveNoteRole(info)
            return activeRole === 'middle'
                ? info.note.noteType === 'default'
                    ? 'tick'
                    : 'single'
                : activeRole
        }
    }
}

export const allowsSimLine = (role: NoteRole) =>
    role !== 'anchor' && role !== 'damage' && role !== 'tick'
