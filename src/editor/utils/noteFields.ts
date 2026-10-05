import { store } from '../../history/store'
import type { NoteEntity } from '../../state/entities/slides/note'
import { getNoteFieldsIn } from '../../state/operations/properties/noteFields'

export type { NoteFields } from '../../state/operations/properties/noteFields'

export const getNoteFields = (note: NoteEntity) => getNoteFieldsIn(store.value, note)
