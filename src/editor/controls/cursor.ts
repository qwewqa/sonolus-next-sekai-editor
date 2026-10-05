import { shallowRef } from 'vue'

export type CanvasCursor =
    'default' | 'move' | 'ew-resize' | 'ns-resize' | 'crosshair' | 'copy' | 'pointer'

// Hover/press cursor -> cursor while the tool owns the drag.
export const dragCursor = (cursor: CanvasCursor) =>
    cursor === 'default' || cursor === 'pointer' ? 'crosshair' : cursor

export const lockedCursor = shallowRef<CanvasCursor>()

export const lockCursor = (cursor: CanvasCursor) => {
    lockedCursor.value = cursor
}

export const unlockCursor = () => {
    lockedCursor.value = undefined
}
