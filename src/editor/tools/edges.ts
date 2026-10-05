import type { Entity, EntityType } from '../../state/entities'
import { getNoteInteractionWidth } from '../../state/entities/slides/note'

export const isNoteResizeStart = (note: { left: number; size: number }, lane: number) => {
    const center = note.left + note.size / 2
    const moveHalfWidth = getNoteInteractionWidth(note.size) / 2 - 0.5
    return lane <= center - moveHalfWidth || lane >= center + moveHalfWidth
}

export const isRangeResizeStart = (left: number, size: number, lane: number) =>
    !(lane > left + 0.5 && lane < left + size - 0.5)

// Select resizes only when every moving object shares the focus's type.
export const isSelectResize = (onlyType: EntityType | undefined, focus: Entity, lane: number) => {
    if (focus.type !== onlyType) return false
    if (focus.type === 'note') return isNoteResizeStart(focus, lane)
    if (focus.type === 'cameraEventJoint')
        return isRangeResizeStart(focus.cameraLeft, focus.cameraSize, lane)
    if (focus.type === 'stageMaskEventJoint')
        return isRangeResizeStart(focus.maskLeft, focus.maskSize, lane)
    return false
}
