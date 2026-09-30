import type { NoteObject } from '../../chart/note'

// Properties owned by the start of a connector segment, rather than a note or
// an attachment interval. Used when reconnecting or reversing existing slides.
export const connectorProperties = (note: NoteObject) => ({
    connectorType: note.connectorType,
    connectorStyle: note.connectorStyle,
    connectorIsFake: note.connectorIsFake,
    connectorActiveIsCritical: note.connectorActiveIsCritical,
    connectorLayer: note.connectorLayer,
    connectorIsPassThrough: note.connectorIsPassThrough,
    connectorPresentation: note.connectorPresentation,
})
