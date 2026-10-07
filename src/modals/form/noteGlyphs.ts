import { h } from 'vue'
import type { NoteSfx, NoteType } from '../../chart/note'
import NoteShapeIcon from './NoteShapeIcon.vue'
import { noteTypeShapes, sfxShapes } from './noteShapes'

/** A note type's picture; Default has none. */
export const noteTypeGlyph = (value: NoteType) => {
    const shape = noteTypeShapes[value]
    return shape ? h(NoteShapeIcon, { shape }) : null
}

/** The picture of the note whose sound an SFX plays; Default and None have none. */
export const sfxGlyph = (value: NoteSfx) => {
    const entry = sfxShapes[value]
    return entry ? h(NoteShapeIcon, { shape: entry[0], critical: entry[1] }) : null
}
