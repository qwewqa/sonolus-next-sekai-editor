import { clamp } from '../../utils/math'
import type { EditableObject } from './editable'

const fields = [
    ['left', 'size'],
    ['cameraLeft', 'cameraSize'],
    ['maskLeft', 'maskSize'],
    ['pivotLane'],
    ['xTranslation'],
    ['editorLane'],
] as const

export const constrainLaneObject = <T extends EditableObject>(
    object: T,
    maxLane: number,
    resizing = false,
    noteMinimum = 0,
): T => {
    if (!(maxLane > 0) || !Number.isFinite(maxLane)) return object
    for (const [positionKey, sizeKey] of fields) {
        const position = object[positionKey]
        if (position === undefined) continue
        const originalSize = sizeKey ? object[sizeKey] : undefined
        const minimum =
            positionKey === 'cameraLeft'
                ? 6
                : positionKey === 'left' && resizing
                  ? Math.min(noteMinimum, maxLane * 2)
                  : 0
        const availableSize =
            resizing && originalSize !== undefined
                ? clamp(position + originalSize, -maxLane, maxLane) -
                  clamp(position, -maxLane, maxLane)
                : originalSize
        const size =
            originalSize === undefined
                ? 0
                : Math.max(minimum, Math.min(availableSize ?? 0, Math.max(minimum, maxLane * 2)))
        const left = size > maxLane * 2 ? -size / 2 : clamp(position, -maxLane, maxLane - size)
        if (left === position && size === (originalSize ?? 0)) return object
        return {
            ...object,
            [positionKey]: left,
            ...(sizeKey && originalSize !== undefined ? { [sizeKey]: size } : {}),
        }
    }
    return object
}
