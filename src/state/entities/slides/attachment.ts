import type { NoteObject } from '../../../chart/note'
import { safeUnlerpClamped } from '../../../utils/math'

type ElevationPoint = Pick<NoteObject, 'beat' | 'elevation'>

/** Only authored beat equality switches attachment placement to stored elevation. */
export const sameBeatAttachmentFraction = (
    head: ElevationPoint,
    tail: ElevationPoint,
    note: ElevationPoint,
) =>
    head.beat === tail.beat
        ? safeUnlerpClamped(head.elevation ?? 0, tail.elevation ?? 0, note.elevation ?? 0)
        : undefined
