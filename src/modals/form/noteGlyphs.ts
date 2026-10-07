import { h } from 'vue'
import type { NoteSfx, NoteType } from '../../chart/note'
import NoteShapeIcon from './NoteShapeIcon.vue'
import { noteTypeShapes, sfxShapes } from './noteShapes'

/** A note type's picture. */
export const noteTypeGlyph = (value: NoteType) => h(NoteShapeIcon, { shape: noteTypeShapes[value] })

/** The picture of the note whose sound an SFX plays; Default has none. */
export const sfxGlyph = (value: NoteSfx) => {
    const entry = sfxShapes[value]
    return entry ? h(NoteShapeIcon, { shape: entry[0], critical: entry[1] }) : null
}
