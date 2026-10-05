import type { NoteType } from '../chart/note'
import { settings } from '../settings'
import type { EditableObject } from '../state/operations/editable'
import { constrainLaneObject as constrain } from '../state/operations/laneLimits'
import { view } from './view'

export const minimumNoteSize = (noteType: NoteType | undefined) =>
    settings.zeroWidthNotes === 'all' ||
    (settings.zeroWidthNotes === 'anchors' && noteType === 'anchor')
        ? 0
        : 1 / view.laneDivision

export const constrainLaneObject = <T extends EditableObject>(
    object: T,
    { enabled = true, resizing = false }: { enabled?: boolean; resizing?: boolean } = {},
): T =>
    enabled
        ? constrain(
              object,
              settings.maxLane,
              resizing,
              minimumNoteSize('noteType' in object ? object.noteType : undefined),
          )
        : object
